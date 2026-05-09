/**
 * Sales Automation — Railway用バックエンド v2
 *   PDCA拡張 + 多次元実験 + Thompson Sampling + 不達対策 + 学習ループ
 *
 * セットアップ:
 *   npm install express cors uuid googleapis
 */

const express = require("express");
const cors = require("cors");
const { randomUUID: uuidv4 } = require("crypto");
const { google } = require("googleapis");

const CONFIG = {
  APOLLO_KEY:         process.env.APOLLO_KEY         || "",
  ANTHROPIC_API_KEY:  process.env.ANTHROPIC_API_KEY  || "",
  TUNNEL_URL:         process.env.TUNNEL_URL         || "https://sales-automation-server-production.up.railway.app",
  CLICK_REDIRECT_URL: process.env.CLICK_REDIRECT_URL || "https://dollar-biz.com",
  GA4_PROPERTY_ID:    process.env.GA4_PROPERTY_ID    || "516454623",
  CV_PAGE_PATH:       process.env.CV_PAGE_PATH       || "/dashboard",
  PLAN_THANKS_PATH:   "/plan-thanks",
  BOUNCE_ALERT_RATE:  parseFloat(process.env.BOUNCE_ALERT_RATE || "0.03"),
  BOUNCE_HALT_RATE:   parseFloat(process.env.BOUNCE_HALT_RATE  || "0.05"),
  // dollar-biz 本番Supabase(profiles.plan 同期用)
  DOLLARBIZ_SUPABASE_URL: process.env.DOLLARBIZ_SUPABASE_URL || "",
  DOLLARBIZ_SUPABASE_KEY: process.env.DOLLARBIZ_SUPABASE_KEY || "",
  EMAILVERIFY_API_KEY: process.env.EMAILVERIFY_API_KEY || "",
  GEMINI_API_KEY:     process.env.GEMINI_API_KEY      || "",
  // ── Unipile (LinkedIn 送信) ──
  UNIPILE_API_KEY:    process.env.UNIPILE_API_KEY    || "",
  UNIPILE_ACCOUNT_ID: process.env.UNIPILE_ACCOUNT_ID || "",
  UNIPILE_URL:        process.env.UNIPILE_URL        || "api36.unipile.com:16693",
};

// dollar-biz.com の実プラン (Sandbox, Professional, Corporate, Enterprise)
// スコアはSandbox=10(入口CV)、上位ほど高い
const PLAN_CONFIG = {
  "Sandbox":      { status: "Sandbox",      score: 10 },
  "Professional": { status: "Professional", score: 100 },
  "Corporate":    { status: "Corporate",    score: 200 },
  "Enterprise":   { status: "Enterprise",   score: 400 },
  "Lifetime":     { status: "Lifetime",     score: 800 },
};

// Node 18+ はグローバル fetch 組み込み済み。古い環境向けに let で宣言しておく
let fetch = globalThis.fetch || undefined;
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ══════════════════════════════════════════════
// ストア
// ══════════════════════════════════════════════
const trackingStore    = {};
const messageIdStore   = {};
const repliedSet       = new Set();
const campaignStore    = {};
const variantToTracking= {};

const suppressionSet   = new Set();
const suppressionMeta  = {};
const domainQuality    = {};
const bounceStream     = [];

let scoreWeights = {
  phase:    { cold: 0, warm: 5, engaged: 15, replied: 20, negotiating: 40, customer: 100, churned: 0 },
  click:    15,
  industry: {},
  title:    {},
  country:  {},
};
let scoreWeightsUpdatedAt = null;

const PIXEL_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PIXEL_BUF    = Buffer.from(PIXEL_BASE64, "base64");

// ══════════════════════════════════════════════
// ヘルパー
// ══════════════════════════════════════════════
function getDomain(email) {
  if (!email || typeof email !== "string") return "";
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

function inferPhase(record, replied) {
  if (record.planStatus && ["Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(record.planStatus))
    return "customer";
  if (record.planStatus === "Sandbox") return "sandbox";
  if (replied) return record.convertedAt ? "negotiating" : "replied";
  if (record.clickedAt || (record.pageViews || 0) >= 2) return "engaged";
  if (record.openedAt || (record.opens || 0) > 0) return "warm";
  if (record.sentAt) return "cold";
  return "cold";
}

function normalizeTitle(t) {
  if (!t) return "";
  const s = t.toLowerCase();
  if (/\b(ceo|founder|president|owner|chairman|managing director|executive director|principal)\b/.test(s)) return "Executive";
  if (/\b(cto|cmo|coo|cfo|cpo|cro|ciso|cdo|clo|cso)\b/.test(s)) return "CxO";
  if (/\bvp\b|vice president|svp|evp/.test(s)) return "VP";
  if (/\bdirector\b|head of/.test(s)) return "Director";
  if (/\bmanager\b/.test(s)) return "Manager";
  if (/\bengineer\b|developer/.test(s)) return "Engineer";
  if (/\bsales\b/.test(s)) return "Sales";
  if (/marketing/.test(s)) return "Marketing";
  return "Other";
}

function recomputeDomainScore(dom) {
  const q = domainQuality[dom];
  if (!q || q.sent === 0) { if (q) q.badScore = 0; return; }
  q.badScore = (q.bounced / q.sent) + (q.complaint / q.sent) * 3;
}

// ══════════════════════════════════════════════
// Apollo 検索 — verified + bad domain 自動除外
// ══════════════════════════════════════════════
app.post("/apollo/search", async (req, res) => {
  const apolloKey = CONFIG.APOLLO_KEY;
  if (!apolloKey) return res.status(500).json({ error: "APOLLO_KEY を設定してください" });
  try {
    const { verifiedOnly = true, excludeBadDomains = true, ...userBody } = req.body;
    const body = { ...userBody, api_key: apolloKey };
    if (verifiedOnly) body.contact_email_status = ["verified"];
    const response = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { return res.status(500).json({ error: text.slice(0, 200) }); }
    if (!response.ok) return res.status(response.status).json({ error: data.message || data.error || text.slice(0, 200) });

    let filtered = data.people || [];
    let excludedBad = 0, excludedSuppressed = 0;
    if (excludeBadDomains) {
      filtered = filtered.filter(p => {
        if (!p.email) return true;
        const e = p.email.toLowerCase();
        if (suppressionSet.has(e)) { excludedSuppressed++; return false; }
        const dom = getDomain(e);
        const dq  = domainQuality[dom];
        if (dq && dq.sent >= 5 && dq.badScore >= 0.5) { excludedBad++; return false; }
        return true;
      });
    }
    data.people = filtered;
    data._filtered = { excludedBad, excludedSuppressed, verifiedOnly };
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// Claude API プロキシ(CORS 回避 + APIキー保護)
// ══════════════════════════════════════════════
app.post("/claude/messages", async (req, res) => {
  if (!CONFIG.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "サーバーに ANTHROPIC_API_KEY が未設定です。Railway の環境変数に設定してください。" });
  }
  const { stream } = req.body || {};
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CONFIG.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      let errBody;
      try { errBody = JSON.parse(errText); } catch { errBody = { error: errText.slice(0, 500) }; }
      return res.status(upstream.status).json(errBody);
    }

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      upstream.body.on("data", (chunk) => res.write(chunk));
      upstream.body.on("end", () => res.end());
      upstream.body.on("error", (e) => { console.error("Claude proxy stream error:", e.message); res.end(); });
    } else {
      const data = await upstream.json();
      res.json(data);
    }
  } catch (e) {
    console.error("Claude proxy error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════
// 送信前ヒューリスティック検証(API不要)
// ══════════════════════════════════════════════
app.post("/email/prevalidate", (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails)) return res.status(400).json({ error: "emails 配列が必要です" });
  const SYNTAX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const DISPOSABLE = new Set([
    "mailinator.com","guerrillamail.com","10minutemail.com","tempmail.com","throwaway.email",
    "trashmail.com","yopmail.com","fakeinbox.com","temp-mail.org","maildrop.cc","mintemail.com",
    "sharklasers.com","spam4.me","getnada.com","mailnesia.com","dispostable.com",
  ]);
  const ROLE_PREFIX = /^(info|admin|contact|support|sales|marketing|noreply|no-reply|postmaster|webmaster|abuse|help|hello|hi|root|office)@/i;

  const results = emails.map(email => {
    const e = (email || "").trim();
    const lower = e.toLowerCase();
    const reasons = [];
    if (!e) reasons.push("empty");
    else if (!SYNTAX.test(e)) reasons.push("syntax");
    if (lower) {
      const dom = getDomain(lower);
      if (DISPOSABLE.has(dom)) reasons.push("disposable");
      if (ROLE_PREFIX.test(lower)) reasons.push("role");
      if (suppressionSet.has(lower)) reasons.push("suppressed");
      const dq = domainQuality[dom];
      if (dq && dq.sent >= 5 && dq.badScore >= 0.5) reasons.push("bad_domain");
    }
    return { email: e, ok: reasons.length === 0, reasons };
  });
  res.json({
    results,
    stats: {
      total: results.length,
      pass: results.filter(r => r.ok).length,
      fail: results.filter(r => !r.ok).length,
    },
  });
});

// ── 検索条件キュー（Chrome拡張がポーリングで取得）──
let pendingSearchQuery = null;
let scraperDone = false;

// Sales-MasterからChrome拡張への検索条件プッシュ
app.post("/leads/push-search", (req, res) => {
  const { titles = [], industries = [], countries = [], keywords = "", maxPages = 5 } = req.body;
  pendingSearchQuery = { titles, industries, countries, keywords, maxPages, pushedAt: new Date().toISOString() };
  scraperDone = false;
  console.log(`🔍 検索条件をキューにセット:`, pendingSearchQuery);
  res.json({ ok: true, query: pendingSearchQuery });
});

// Chrome拡張が検索条件を取得するエンドポイント
app.get("/leads/pop-search", (req, res) => {
  if (!pendingSearchQuery) return res.json({ query: null });
  const q = pendingSearchQuery;
  pendingSearchQuery = null; // 取得したらクリア
  res.json({ query: q });
});

// Chrome拡張がスクレイプ完了を通知するエンドポイント
app.post("/leads/scraper-done", (req, res) => {
  scraperDone = true;
  console.log("✅ Chrome拡張がスクレイプ完了を通知");
  res.json({ ok: true });
});

// App.jsxがスクレイパー完了状態をポーリングするエンドポイント
app.get("/leads/scraper-status", (req, res) => {
  res.json({ done: scraperDone });
});

// ══════════════════════════════════════════════
// Chrome拡張からのリード一括インポート
// POST /leads/import
// Body: { leads: Array<{ name, title, company, email, linkedinUrl, domain, country, industry }> }
// ══════════════════════════════════════════════

// インメモリの pending リード（フロントエンドがポーリングで取得）
const pendingLeads = [];

app.post("/leads/import", (req, res) => {
  const { leads } = req.body;
  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ error: "leads 配列が必要です" });
  }

  const imported = leads.map(l => ({
    id:          "ext_" + uuidv4(),
    name:        (l.name || "（名前未設定）").trim(),
    title:       (l.title       || "").trim(),
    company:     (l.company     || "").trim(),
    email:       (l.email       || "").toLowerCase().trim(),
    linkedinUrl: (l.linkedinUrl || "").trim(),
    domain:      (l.domain      || "").trim(),
    country:     (l.country     || "不明").trim(),
    industry:    (l.industry    || "指定なし").trim(),
    status:      "unverified",
    addedAt:     new Date().toISOString(),
  }));

  pendingLeads.push(...imported);

  console.log(`📥 Chrome拡張からリードインポート: ${imported.length}件 (pending合計: ${pendingLeads.length}件)`);

  res.json({
    ok: true,
    imported: imported.length,
    pending: pendingLeads.length,
  });
});

// フロントエンドが定期ポーリングで新着リードを取得するエンドポイント
// GET /leads/pending
app.get("/leads/pending", (req, res) => {
  const leads = pendingLeads.splice(0, pendingLeads.length); // 全件取り出してクリア
  res.json({ leads, count: leads.length });
});

// ══════════════════════════════════════════════
// メアド検証ヘルパー — VERIFY_PROVIDER で切替
//   VERIFY_PROVIDER=millionverifier (default) | reoon
//   VERIFY_API_KEY=...
// 戻り値: { valid: boolean, status: string, reason: string, raw?: any, mock?: boolean }
// ══════════════════════════════════════════════
async function verifyEmailViaProvider(email) {
  const verifyKey = process.env.VERIFY_API_KEY || CONFIG.EMAILVERIFY_API_KEY || "";
  const provider = (process.env.VERIFY_PROVIDER || "millionverifier").toLowerCase().trim();

  if (!verifyKey) {
    // 危険: モックで全件 valid 扱いはしない。unknown で返し、呼び出し側で unverified のまま留める
    return {
      valid: false,
      status: "unknown",
      reason: "no_api_key",
      mock: true,
    };
  }

  try {
    if (provider === "reoon") {
      // Reoon Email Verifier — https://emailverifier.reoon.com/
      // mode=power が SMTP 検証あり、quick はキャッシュベース
      const mode = (process.env.REOON_MODE || "power").toLowerCase();
      const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${encodeURIComponent(verifyKey)}&mode=${encodeURIComponent(mode)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) {
        const errText = await r.text();
        console.error(`Reoon HTTP ${r.status}:`, errText.slice(0, 200));
        return { valid: false, status: "unknown", reason: `api_error_${r.status}` };
      }
      const data = await r.json();
      // Reoon レスポンス: { status: "safe"|"valid"|"invalid"|"risky"|"unknown"|"disposable"|... }
      const raw = String(data.status || data.result || "unknown").toLowerCase().trim();
      const isValid = raw === "safe" || raw === "valid" || raw === "deliverable";
      return {
        valid: isValid,
        status: raw,
        reason: isValid ? "valid" :
                raw === "risky" ? "risky" :
                raw === "disposable" ? "disposable" :
                raw === "role_account" || raw === "role" ? "role_based" :
                raw === "catch_all" || raw === "catch-all" ? "catch_all" :
                raw === "unknown" ? "unknown" :
                "invalid",
        raw: data,
      };
    }

    // 既定: MillionVerifier
    const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(verifyKey)}&email=${encodeURIComponent(email)}&timeout=10`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) {
      const errText = await r.text();
      console.error(`MillionVerifier HTTP ${r.status}:`, errText.slice(0, 200));
      return { valid: false, status: "unknown", reason: `api_error_${r.status}` };
    }
    const data = await r.json();
    const raw = String(data.result || data.status || "unknown").toLowerCase().trim();
    const isValid = raw === "ok" || raw === "valid" || raw === "deliverable";
    return {
      valid: isValid,
      status: raw,
      reason: isValid ? "valid" :
              raw === "unknown" || raw === "unknown_email" ? "unknown" :
              raw === "catch_all" ? "catch_all" :
              raw === "disposable" ? "disposable" :
              "invalid",
      raw: data,
    };
  } catch (err) {
    console.error("verifyEmailViaProvider エラー:", err.message);
    return { valid: false, status: "error", reason: err.message };
  }
}

// ══════════════════════════════════════════════
// 単一メアド検証 — VERIFY_PROVIDER で切替
// POST /email/verify-single  { email: string }
// ══════════════════════════════════════════════
app.post("/email/verify-single", async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email が必要です" });
  }

  const result = await verifyEmailViaProvider(email);
  console.log(`✓ verify-single [${process.env.VERIFY_PROVIDER || "millionverifier"}]: ${email} → ${result.status} (valid=${result.valid})`);

  if (result.mock) {
    console.warn(`⚠️  VERIFY_API_KEY 未設定 — ${email} は検証されず unknown 扱い`);
  }

  res.json({ email, ...result });
});

app.post("/email/verify-emailverify", async (req, res) => {
  const evKey = CONFIG.EMAILVERIFY_API_KEY;
  if (!evKey) {
    return res.status(503).json({
      error: "EMAILVERIFY_API_KEY が未設定です。Railway 環境変数に設定してください。",
      hint: "EmailVerify.io に無料登録すると100件まで検証可能: https://www.emailverify.io/",
    });
  }
  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: "emails 配列が必要です" });
  }
 
  const allResults = [];
  let creditsUsed = 0;
  let stopped = false;
 
  try {
    for (let i = 0; i < emails.length; i++) {
      if (stopped) {
        allResults.push({ email: emails[i], status: "skipped", valid: false, reason: "no_credits_remaining" });
        continue;
      }
 
      const email = emails[i];
      try {
        const url = `https://app.emailverify.io/api/v1/validate/?key=${encodeURIComponent(evKey)}&email=${encodeURIComponent(email)}`;
        const response = await fetch(url);
 
        if (!response.ok) {
          const errText = await response.text();
          if (response.status === 402 || /0 credits/i.test(errText) || /no.*credits/i.test(errText)) {
            console.error("EmailVerify.io: クレジット切れ — 残りをスキップ");
            allResults.push({ email, status: "error", valid: false, reason: "no_credits" });
            stopped = true;
            continue;
          }
          allResults.push({ email, status: "error", valid: false, reason: `api_${response.status}` });
          continue;
        }
 
        const data = await response.json();
        const rawStatus = data.status || data.result || data.verdict || data.email_status || "unknown";
        const status = String(rawStatus).toLowerCase().trim();
        const isValid = (status === "valid" || status === "deliverable" || status === "ok");
        creditsUsed++;
 
        allResults.push({
          email,
          status,
          valid: isValid,
          reason: isValid ? "valid" :
                  status === "catch_all" || status === "catch-all" || status === "accept_all" ? "catch_all_domain" :
                  status === "disposable" || status === "temporary" ? "disposable" :
                  status === "role_based" || status === "role-based" || status === "role" ? "role_based" :
                  status === "spamtrap" || status === "spam_trap" ? "spamtrap" :
                  status === "invalid" || status === "undeliverable" ? "invalid_email" :
                  status === "unknown" || status === "timeout" ? "unknown" :
                  `rejected_${status}`,
          raw: data,
        });
      } catch (fetchErr) {
        allResults.push({ email, status: "error", valid: false, reason: fetchErr.message });
      }
 
      if (i < emails.length - 1) {
        await new Promise(r => setTimeout(r, 120));
      }
    }
 
    const valid = allResults.filter(r => r.valid);
    const invalid = allResults.filter(r => !r.valid && r.status !== "skipped");
    const skipped = allResults.filter(r => r.status === "skipped");
 
    console.log(`✓ EmailVerify.io: ${emails.length}件 → valid ${valid.length} / invalid ${invalid.length} / skipped ${skipped.length} / credits ~${creditsUsed}`);
 
    res.json({
      results: allResults,
      stats: {
        total: allResults.length,
        valid: valid.length,
        invalid: invalid.length,
        skipped: skipped.length,
        creditsUsed,
        byStatus: allResults.reduce((acc, r) => {
          acc[r.status] = (acc[r.status] || 0) + 1;
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    console.error("EmailVerify.io error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
 
app.get("/email/verify-emailverify/credits", async (_req, res) => {
  const evKey = CONFIG.EMAILVERIFY_API_KEY;
  if (!evKey) return res.status(503).json({ error: "EMAILVERIFY_API_KEY 未設定" });
  try {
    const r = await fetch(`https://app.emailverify.io/api/v1/check-account-balance/?key=${encodeURIComponent(evKey)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    res.json({
      remaining_credits: data.remaining_credits || 0,
      daily_credits_limit: data.daily_credits_limit || 0,
      api_status: data.api_status || "unknown",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
// Suppression / 不達対策
// ══════════════════════════════════════════════
app.post("/email/suppress", (req, res) => {
  const { email, reason = "manual", source = "manual" } = req.body;
  if (!email) return res.status(400).json({ error: "email が必要です" });
  const e = email.toLowerCase();
  suppressionSet.add(e);
  suppressionMeta[e] = { reason, source, at: new Date().toISOString() };
  const dom = getDomain(e);
  if (dom) {
    if (!domainQuality[dom]) domainQuality[dom] = { sent: 0, bounced: 0, complaint: 0, badScore: 0 };
    if (reason === "bounce" || reason === "hard_bounce") domainQuality[dom].bounced++;
    else if (reason === "complaint" || reason === "spam") domainQuality[dom].complaint++;
    recomputeDomainScore(dom);
  }
  if (reason === "bounce" || reason === "hard_bounce") {
    bounceStream.push({ at: Date.now(), email: e });
    const cutoff = Date.now() - 24 * 3600 * 1000;
    while (bounceStream.length && bounceStream[0].at < cutoff) bounceStream.shift();
  }
  console.log(`🚫 suppressed: ${e} (${reason}, ${source})`);
  res.json({ ok: true, suppressed: suppressionSet.size });
});

app.post("/email/sent", (req, res) => {
  const { emails = [] } = req.body;
  emails.forEach(e => {
    const dom = getDomain(e);
    if (!dom) return;
    if (!domainQuality[dom]) domainQuality[dom] = { sent: 0, bounced: 0, complaint: 0, badScore: 0 };
    domainQuality[dom].sent++;
    recomputeDomainScore(dom);
  });
  res.json({ ok: true });
});

// ══════════════════════════════════════════════
// Apify Actor 起動 — Sales-Masterから直接Actorを起動
// POST /apify/launch
// 検索条件を受け取り → Apollo URLを組み立て → Apify APIでActorを起動
// ══════════════════════════════════════════════
app.post("/apify/launch", async (req, res) => {
  const apifyToken = process.env.APIFY_API_TOKEN || "";
  if (!apifyToken) {
    return res.status(503).json({ error: "APIFY_API_TOKEN が未設定です" });
  }

  const { titles = [], industries = [], countries = [], keywords = "", maxPages = 5 } = req.body;
  const fetchCount = Math.min(maxPages * 25, 100); // 無料枠100件/runまで

  // leads-finder の enum は全部小文字
  const lc = arr => (Array.isArray(arr) ? arr : []).map(s => String(s || "").toLowerCase().trim()).filter(Boolean);
  const countriesLc  = lc(countries);
  const industriesLc = lc(industries);

  console.log(`🚀 Apify Actor起動: titles=${titles.length} industries=${industriesLc.length} countries=${countriesLc.length} fetchCount=${fetchCount}`);

  // Webhookエンドポイント（Actor完了時に呼ばれる）
  const webhookUrl = `https://sales-automation-server-production.up.railway.app/webhook/apify-import`;

  try {
    // code_crafter/leads-finder を起動（無料枠1run100件まで、$1.5/1000件 PPR）
    const actorId = "code_crafter~leads-finder";
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_job_title:  titles,
          company_industry:   industriesLc,
          contact_location:   countriesLc,
          company_keywords:   keywords ? [keywords] : [],
          fetch_count:        fetchCount,
          // Webhook設定: 完了時に自動でimportエンドポイントを呼ぶ
          webhooks: [{
            eventTypes: ["ACTOR.RUN.SUCCEEDED"],
            requestUrl: webhookUrl,
          }],
        }),
      }
    );

    if (!runRes.ok) {
      const errText = await runRes.text();
      console.error("Apify起動エラー:", runRes.status, errText.slice(0, 300));
      return res.status(runRes.status).json({ error: `Apify エラー: ${errText.slice(0, 200)}` });
    }

    const runData = await runRes.json();
    const runId   = runData?.data?.id || runData?.id;
    console.log(`✅ Apify Actor起動成功: runId=${runId}`);

    res.json({
      ok:        true,
      runId,
      actorId,
      message:   "Apify Actorを起動しました。完了後に自動でインポートされます。",
    });

  } catch (err) {
    console.error("Apify launch エラー:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Apify Runのステータスを確認 ──
app.get("/apify/status/:runId", async (req, res) => {
  const apifyToken = process.env.APIFY_API_TOKEN || "";
  const { runId }  = req.params;
  try {
    const r = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return res.status(r.status).json({ error: `Apify API ${r.status}` });
    const data = await r.json();
    const run  = data?.data || data;
    res.json({
      status:       run.status,           // RUNNING / SUCCEEDED / FAILED
      startedAt:    run.startedAt,
      finishedAt:   run.finishedAt,
      datasetId:    run.defaultDatasetId,
      itemCount:    run.stats?.itemCount || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════
// Apify Webhook — リード自動インポート & バックグラウンド検証
// POST /webhook/apify-import
//
// Apify Actor 完了時に呼ばれる。
// ボディ形式は2通りに対応:
//   A) { leads: [...] }  — 直接JSONを受け取る
//   B) { resource: { defaultDatasetId: "..." } } — ApifyのデータセットIDを受け取ってAPIから取得
// ══════════════════════════════════════════════

// 検証ワーカーの二重起動を防ぐフラグ
let verifyWorkerRunning = false;

app.post("/webhook/apify-import", async (req, res) => {
  console.log("📥 Apify webhook 受信");

  const supaUrl = CONFIG.DOLLARBIZ_SUPABASE_URL;
  const supaKey = CONFIG.DOLLARBIZ_SUPABASE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(503).json({ error: "SUPABASE 未設定" });
  }

  try {
    // ── データ取得 ──
    let rawLeads = [];

    // パターンA: ボディに leads 配列が直接含まれる
    if (Array.isArray(req.body?.leads)) {
      rawLeads = req.body.leads;
      console.log(`📦 直接受信: ${rawLeads.length}件`);
    }
    // パターンB: Apify標準形式 — datasetId からAPIで取得
    else if (req.body?.resource?.defaultDatasetId) {
      const datasetId = req.body.resource.defaultDatasetId;
      const apifyKey  = process.env.APIFY_API_KEY || CONFIG.APIFY_API_KEY || "";
      const apiUrl    = `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&clean=true${apifyKey ? `&token=${apifyKey}` : ""}`;
      console.log(`📡 Apify Dataset取得: ${datasetId}`);
      const r = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`Apify API エラー: ${r.status}`);
      rawLeads = await r.json();
      console.log(`📦 Dataset取得完了: ${rawLeads.length}件`);
    }
    // パターンC: ボディ自体が配列
    else if (Array.isArray(req.body)) {
      rawLeads = req.body;
    }
    else {
      return res.status(400).json({ error: "leads 配列 または resource.defaultDatasetId が必要です", body: req.body });
    }

    // ── フィールドマッピング（Apollo/Apify/スクレイパー各種に対応）──
    const mapped = rawLeads.map(r => {
      const firstName  = r["First Name"]  || r.firstName  || r.first_name  || "";
      const lastName   = r["Last Name"]   || r.lastName   || r.last_name   || "";
      const name       = (r.name || r.Name || `${firstName} ${lastName}`).trim() || "（名前未設定）";
      const email      = (r.email || r.Email || r["Work Email"] || r["Email Address"] || r.personal_email || "").toLowerCase().trim();
      const linkedin   = r["LinkedIn Url"] || r["Person Linkedin Url"] || r.linkedin || r.linkedinUrl || r.linkedin_url || "";
      const company    = r.company || r.Company || r["Company Name"] || r.company_name || r.organization || "";
      const title      = r.title || r.Title || r["Job Title"] || r.jobTitle || r.job_title || "";
      const country    = r.country || r.Country || r.location || r.Location || "";
      const industry   = r.industry || r.Industry || "";
      const domain     = r.domain || r.website || r.Website || r["Company Website"] || "";

      return { name, email, linkedin, company, title, country, industry, domain };
    }).filter(r => r.email || r.linkedin); // どちらかが必要

    // ── 既存レコードとの重複チェック ──
    // 既存のemail/linkedinを取得
    const existingRes = await fetch(
      `${supaUrl}/rest/v1/crm_contacts?select=email,linkedin&limit=10000`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
    );
    const existing = existingRes.ok ? await existingRes.json() : [];
    const existingEmails  = new Set(existing.map(r => (r.email   || "").toLowerCase()).filter(Boolean));
    const existingLinkedIn = new Set(existing.map(r => (r.linkedin || "").toLowerCase()).filter(Boolean));

    const toInsert = [];
    for (const r of mapped) {
      const emailKey = r.email.toLowerCase();
      const liKey    = (r.linkedin || "").toLowerCase();
      if ((emailKey && existingEmails.has(emailKey)) ||
          (liKey    && existingLinkedIn.has(liKey))) continue;
      toInsert.push({
        id:         uuidv4(),
        name:       r.name,
        title:      r.title      || "",
        company:    r.company    || "",
        email:      r.email      || "",
        linkedin:   r.linkedin   || "",
        country:    r.country    || "",
        industry:   r.industry   || "",
        status:     "unverified",
        score:      0,
        clicked:    false,
        opens:      0,
        added_at:   new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (emailKey) existingEmails.add(emailKey);
      if (liKey)    existingLinkedIn.add(liKey);
    }

    console.log(`📊 インポート: 合計${rawLeads.length}件 → 新規${toInsert.length}件 / スキップ${rawLeads.length - toInsert.length - (rawLeads.length - mapped.length)}件`);

    // ── Supabaseに一括挿入（100件ずつチャンク）──
    let inserted = 0;
    const CHUNK = 100;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      const insRes = await fetch(`${supaUrl}/rest/v1/crm_contacts`, {
        method: "POST",
        headers: {
          apikey: supaKey,
          Authorization: `Bearer ${supaKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(chunk),
      });
      if (!insRes.ok) {
        const errText = await insRes.text();
        console.error(`Supabase挿入エラー: ${insRes.status} ${errText.slice(0, 200)}`);
      } else {
        inserted += chunk.length;
      }
    }

    // ── 即座に200を返す ──
    res.json({ ok: true, received: rawLeads.length, inserted, skipped: rawLeads.length - inserted });

    // ── バックグラウンドで検証ワーカーを起動 ──
    if (inserted > 0 && !verifyWorkerRunning) {
      console.log("🔍 バックグラウンド検証ワーカー起動");
      runVerifyWorker(supaUrl, supaKey).catch(err =>
        console.error("検証ワーカーエラー:", err.message)
      );
    }

  } catch (err) {
    console.error("webhook/apify-import エラー:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── バックグラウンド検証ワーカー ──
async function runVerifyWorker(supaUrl, supaKey) {
  if (verifyWorkerRunning) return;
  verifyWorkerRunning = true;

  const verifyKey = process.env.VERIFY_API_KEY || CONFIG.EMAILVERIFY_API_KEY || "";
  const provider = (process.env.VERIFY_PROVIDER || "millionverifier").toLowerCase().trim();

  if (!verifyKey) {
    console.warn(`⚠️  VERIFY_API_KEY 未設定 — 検証ワーカーをスキップ。レコードは unverified のまま留まります`);
    verifyWorkerRunning = false;
    return;
  }

  try {
    // unverified かつ email ありのレコードを取得
    const res = await fetch(
      `${supaUrl}/rest/v1/crm_contacts?select=id,email&status=eq.unverified&email=neq.&limit=500`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
    );
    if (!res.ok) throw new Error(`Supabase取得エラー: ${res.status}`);
    const targets = await res.json();

    console.log(`🔍 検証ワーカー開始 [${provider}]: ${targets.length}件`);

    let validCount = 0, invalidCount = 0, errorCount = 0;

    for (let i = 0; i < targets.length; i++) {
      const { id, email } = targets[i];

      const result = await verifyEmailViaProvider(email);
      // valid → ready / invalid 系 → invalid / unknown 系 → unverified のまま留める
      let newStatus;
      if (result.valid) {
        newStatus = "ready";
        validCount++;
      } else if (result.status === "unknown" || result.status === "error") {
        // 不確定なら unverified を維持して次回再試行可能に
        errorCount++;
        await new Promise(r => setTimeout(r, 150));
        continue;
      } else {
        newStatus = "invalid";
        invalidCount++;
      }

      // Supabaseを更新
      const patchRes = await fetch(`${supaUrl}/rest/v1/crm_contacts?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          apikey: supaKey,
          Authorization: `Bearer ${supaKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() }),
      });
      if (!patchRes.ok) {
        console.warn(`Supabase PATCH 失敗 (${id}): ${patchRes.status}`);
      }

      if ((i + 1) % 10 === 0) {
        console.log(`🔍 検証進捗: ${i + 1}/${targets.length}件 (ready=${validCount}, invalid=${invalidCount}, skipped=${errorCount})`);
      }

      // レート制限対策: 150ms待機
      await new Promise(r => setTimeout(r, 150));
    }

    console.log(`✅ 検証ワーカー完了: ${targets.length}件中 ready=${validCount}, invalid=${invalidCount}, skipped=${errorCount}`);
  } catch (err) {
    console.error("検証ワーカー失敗:", err.message);
  } finally {
    verifyWorkerRunning = false;
  }
}

// ── 検証ワーカーを手動トリガーするエンドポイント ──
//   CSV インポートで Supabase に直接書き込んだ後、ワーカー起動を促す用
app.post("/webhook/verify-trigger", async (req, res) => {
  const supaUrl = CONFIG.DOLLARBIZ_SUPABASE_URL;
  const supaKey = CONFIG.DOLLARBIZ_SUPABASE_KEY;
  if (verifyWorkerRunning) {
    return res.json({ started: false, reason: "already_running" });
  }
  // バックグラウンド実行（即レスポンス）
  runVerifyWorker(supaUrl, supaKey).catch(err => console.error("verify-trigger error:", err));
  res.json({ started: true });
});

// ── 検証ワーカーの状態確認エンドポイント ──
app.get("/webhook/verify-status", async (req, res) => {
  const supaUrl = CONFIG.DOLLARBIZ_SUPABASE_URL;
  const supaKey = CONFIG.DOLLARBIZ_SUPABASE_KEY;
  try {
    const r = await fetch(
      `${supaUrl}/rest/v1/crm_contacts?select=status&status=eq.unverified`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, Prefer: "count=exact" } }
    );
    const count = parseInt(r.headers.get("content-range")?.split("/")[1] || "0");
    res.json({ workerRunning: verifyWorkerRunning, unverifiedCount: count });
  } catch (err) {
    res.json({ workerRunning: verifyWorkerRunning, unverifiedCount: 0, error: err.message });
  }
});

// ══════════════════════════════════════════════
// Amazon SES SNS Webhook (Bounce / Complaint 通知)
//   SES → SNS Topic → HTTPS Subscription → このエンドポイント
//   SNS の Subscription 確認も自動処理する
// ══════════════════════════════════════════════
app.post("/webhook/ses", async (req, res) => {
  let payload = req.body;

  // SNS は Content-Type: text/plain で JSON を送ることがあるため、文字列ならパース
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch {
      return res.status(400).json({ error: "invalid JSON" });
    }
  }

  // ── SNS Subscription 確認 ──
  // 初回サブスクリプション時に SNS が SubscribeURL を送ってくるので自動確認
  if (payload.Type === "SubscriptionConfirmation" && payload.SubscribeURL) {
    console.log("📩 SNS SubscriptionConfirmation — 自動確認中…");
    try {
      await fetch(payload.SubscribeURL);
      console.log("✓ SNS Subscription 確認完了");
    } catch (e) {
      console.error("✗ SNS Subscription 確認失敗:", e.message);
    }
    return res.status(200).json({ ok: true, action: "subscription_confirmed" });
  }

  // ── 通知メッセージ ──
  // SNS Notification の場合、Message フィールドに SES イベント JSON が入っている
  let sesMessage = payload;
  if (payload.Type === "Notification" && payload.Message) {
    try {
      sesMessage = typeof payload.Message === "string" ? JSON.parse(payload.Message) : payload.Message;
    } catch {
      return res.status(400).json({ error: "failed to parse SNS Message" });
    }
  }

  let suppressed = 0;
  const notificationType = sesMessage.notificationType || sesMessage.eventType || "";

  // ── Bounce 処理 ──
  if (notificationType === "Bounce" && sesMessage.bounce) {
    const bounce = sesMessage.bounce;
    const bounceType = bounce.bounceType; // "Permanent" | "Transient" | "Undetermined"
    const recipients = bounce.bouncedRecipients || [];

    for (const rcpt of recipients) {
      if (!rcpt.emailAddress) continue;
      const e = rcpt.emailAddress.toLowerCase();
      // Permanent = ハードバウンス → 即 suppress
      // Transient = ソフトバウンス → 記録のみ(suppress はしない)
      const reason = bounceType === "Permanent" ? "hard_bounce" : "soft_bounce";

      if (bounceType === "Permanent") {
        suppressionSet.add(e);
        suppressionMeta[e] = {
          reason,
          source: "ses",
          at: new Date().toISOString(),
          code: rcpt.diagnosticCode || "",
          bounceSubType: bounce.bounceSubType || "",
        };
        const dom = getDomain(e);
        if (dom) {
          if (!domainQuality[dom]) domainQuality[dom] = { sent: 0, bounced: 0, complaint: 0, badScore: 0 };
          domainQuality[dom].bounced++;
          recomputeDomainScore(dom);
        }
        bounceStream.push({ at: Date.now(), email: e });
        suppressed++;
      }
      console.log(`📬 SES ${reason}: ${e} (${bounce.bounceSubType || bounceType})`);
    }
  }

  // ── Complaint 処理 ──
  if (notificationType === "Complaint" && sesMessage.complaint) {
    const complaint = sesMessage.complaint;
    const recipients = complaint.complainedRecipients || [];

    for (const rcpt of recipients) {
      if (!rcpt.emailAddress) continue;
      const e = rcpt.emailAddress.toLowerCase();
      suppressionSet.add(e);
      suppressionMeta[e] = {
        reason: "complaint",
        source: "ses",
        at: new Date().toISOString(),
        feedbackType: complaint.complaintFeedbackType || "",
      };
      const dom = getDomain(e);
      if (dom) {
        if (!domainQuality[dom]) domainQuality[dom] = { sent: 0, bounced: 0, complaint: 0, badScore: 0 };
        domainQuality[dom].complaint++;
        recomputeDomainScore(dom);
      }
      suppressed++;
      console.log(`📬 SES complaint: ${e}`);
    }
  }

  const cutoff = Date.now() - 24 * 3600 * 1000;
  while (bounceStream.length && bounceStream[0].at < cutoff) bounceStream.shift();
  if (suppressed > 0) console.log(`📥 SES webhook: ${suppressed}件を suppress`);
  res.status(200).json({ ok: true, suppressed });
});

// ── 旧 SendGrid webhook も残す(移行期間中の互換性) ──
app.post("/webhook/sendgrid", (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [];
  let suppressed = 0;
  for (const ev of events) {
    if (!ev.email) continue;
    const event = ev.event;
    if (event === "bounce" || event === "dropped" || event === "blocked") {
      const reason = ev.type === "bounce" ? "hard_bounce" : "bounce";
      const e = ev.email.toLowerCase();
      suppressionSet.add(e);
      suppressionMeta[e] = { reason, source: "sendgrid", at: new Date().toISOString(), code: ev.reason || "" };
      const dom = getDomain(e);
      if (dom) {
        if (!domainQuality[dom]) domainQuality[dom] = { sent: 0, bounced: 0, complaint: 0, badScore: 0 };
        domainQuality[dom].bounced++;
        recomputeDomainScore(dom);
      }
      bounceStream.push({ at: Date.now(), email: e });
      suppressed++;
    } else if (event === "spamreport" || event === "unsubscribe") {
      const e = ev.email.toLowerCase();
      suppressionSet.add(e);
      suppressionMeta[e] = { reason: event, source: "sendgrid", at: new Date().toISOString() };
      const dom = getDomain(e);
      if (dom) {
        if (!domainQuality[dom]) domainQuality[dom] = { sent: 0, bounced: 0, complaint: 0, badScore: 0 };
        if (event === "spamreport") domainQuality[dom].complaint++;
        recomputeDomainScore(dom);
      }
      suppressed++;
    }
  }
  const cutoff = Date.now() - 24 * 3600 * 1000;
  while (bounceStream.length && bounceStream[0].at < cutoff) bounceStream.shift();
  if (suppressed > 0) console.log(`📥 SendGrid webhook: ${suppressed}件を suppress`);
  res.status(204).end();
});

app.get("/suppressions", (_req, res) => {
  const list = Array.from(suppressionSet).map(e => ({ email: e, ...suppressionMeta[e] }));
  res.json({ count: list.length, list: list.slice(-500) });
});

app.get("/domain-quality", (_req, res) => {
  const list = Object.entries(domainQuality)
    .map(([dom, q]) => ({
      domain: dom, ...q,
      bounceRate: q.sent ? +(q.bounced / q.sent * 100).toFixed(1) : 0,
      complaintRate: q.sent ? +(q.complaint / q.sent * 100).toFixed(2) : 0,
    }))
    .sort((a, b) => b.badScore - a.badScore);
  res.json({ domains: list, totalDomains: list.length });
});

app.get("/send-safety", (_req, res) => {
  const totalSent = Object.values(domainQuality).reduce((s, q) => s + q.sent, 0);
  const recentBounce24h = bounceStream.length;
  const bounceRate = totalSent > 0 ? recentBounce24h / totalSent : 0;
  let safety = "ok";
  if (bounceRate >= CONFIG.BOUNCE_HALT_RATE)  safety = "halt";
  else if (bounceRate >= CONFIG.BOUNCE_ALERT_RATE) safety = "warn";
  res.json({
    safety, bounceRate: +(bounceRate * 100).toFixed(2),
    recentBounce24h, totalSent,
    thresholds: { warn: CONFIG.BOUNCE_ALERT_RATE, halt: CONFIG.BOUNCE_HALT_RATE },
  });
});

// ══════════════════════════════════════════════
// Campaign / Variant
// ══════════════════════════════════════════════
app.post("/campaign/create", (req, res) => {
  const { name, segment, segmentKey, variants, mode = "even" } = req.body;
  if (!name || !Array.isArray(variants) || variants.length === 0)
    return res.status(400).json({ error: "name と variants[] が必要です" });
  const campaignId = uuidv4();
  campaignStore[campaignId] = {
    id: campaignId, name,
    segment: segment || "",
    segmentKey: segmentKey || "",
    mode,
    createdAt: new Date().toISOString(),
    status: "running",
    variants: variants.map(v => ({
      id: v.id || uuidv4(),
      label: v.label || v.angle || "variant",
      angle: v.angle || "",
      subject: v.subject || "",
      bodyPreview: (v.body || "").slice(0, 200),
      predOpen: v.predOpen || 0,
      predCtr: v.predCtr || 0,
      sentCount: 0,
      status: "active",
    })),
  };
  campaignStore[campaignId].variants.forEach(v => {
    variantToTracking[v.id] = variantToTracking[v.id] || [];
  });
  console.log(`✓ Campaign: ${name} (${campaignId}) / ${variants.length}var / mode=${mode}`);
  res.json({ ok: true, campaignId, variants: campaignStore[campaignId].variants });
});

app.get("/campaign/list", (_req, res) => {
  const list = Object.values(campaignStore).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ campaigns: list });
});

app.post("/campaign/variant/status", (req, res) => {
  const { campaignId, variantId, status } = req.body;
  const cam = campaignStore[campaignId];
  if (!cam) return res.status(404).json({ error: "campaign not found" });
  const v = cam.variants.find(x => x.id === variantId);
  if (!v) return res.status(404).json({ error: "variant not found" });
  v.status = status;
  res.json({ ok: true });
});

// ══════════════════════════════════════════════
// Thompson Sampling
// ══════════════════════════════════════════════
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleGamma(k) {
  if (k < 1) {
    return sampleGamma(k + 1) * Math.pow(Math.random(), 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      x = gaussian();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function sampleBeta(a, b) {
  const x = sampleGamma(a);
  const y = sampleGamma(b);
  return x / (x + y);
}

function getVariantPosterior(variantId, metric = "opened") {
  let successes = 1, failures = 1;
  const tids = variantToTracking[variantId] || [];
  for (const tid of tids) {
    const r = trackingStore[tid];
    if (!r) continue;
    let success = false;
    if (metric === "opened") success = !!r.openedAt;
    else if (metric === "clicked") success = !!r.clickedAt;
    else if (metric === "replied") success = repliedSet.has(r.recipientId);
    else if (metric === "converted") success = !!r.convertedAt || !!r.planConvertedAt;
    else if (metric === "plan") success = !!r.planConvertedAt;
    if (success) successes++;
    else failures++;
  }
  return { alpha: successes, beta: failures };
}

app.post("/assign/variant", (req, res) => {
  const { campaignId, metric = "opened" } = req.body;
  const cam = campaignStore[campaignId];
  if (!cam) return res.status(404).json({ error: "campaign not found" });
  const active = cam.variants.filter(v => v.status === "active" || v.status === "winner");
  if (active.length === 0) return res.status(400).json({ error: "no active variants" });

  if (cam.mode === "thompson" && active.length > 1) {
    let best = null;
    let bestSample = -1;
    const samples = [];
    for (const v of active) {
      const { alpha, beta } = getVariantPosterior(v.id, metric);
      const s = sampleBeta(alpha, beta);
      samples.push({ variantId: v.id, label: v.label, sample: +s.toFixed(3), alpha, beta });
      if (s > bestSample) { bestSample = s; best = v; }
    }
    return res.json({ variantId: best.id, label: best.label, mode: "thompson", sample: bestSample, allSamples: samples });
  }
  const counts = active.map(v => (variantToTracking[v.id] || []).length);
  const minIdx = counts.indexOf(Math.min(...counts));
  return res.json({ variantId: active[minIdx].id, label: active[minIdx].label, mode: "even" });
});

// ══════════════════════════════════════════════
// 統計検定
// ══════════════════════════════════════════════
function normCdf(z) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * z);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}
function proportionTest(a1, n1, a2, n2) {
  if (n1 === 0 || n2 === 0) return { p: 1, z: 0 };
  const p1 = a1 / n1, p2 = a2 / n2;
  const p = (a1 + a2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return { p: 1, z: 0 };
  const z = (p1 - p2) / se;
  const pv = 2 * (1 - normCdf(Math.abs(z)));
  return { p: +pv.toFixed(4), z: +z.toFixed(3), p1: +p1.toFixed(3), p2: +p2.toFixed(3) };
}

// ══════════════════════════════════════════════
// Tracking registration
// ══════════════════════════════════════════════
app.post("/register-tracking", (req, res) => {
  const { trackingId, recipientId, email, name, messageId, campaignId, variantId, subject, industry, country, title, segmentKey, channel } = req.body;
  if (!trackingId || !recipientId) return res.status(400).json({ error: "trackingId と recipientId が必要です" });
  trackingStore[trackingId] = {
    recipientId, email, name,
    campaignId: campaignId || null,
    variantId: variantId || null,
    subject: subject || "",
    industry: industry || "",
    country: country || "",
    title: title || "",
    segmentKey: segmentKey || "",
    channel: channel || "email",  // "email" | "linkedin"
    sentAt: new Date().toISOString(),
    openedAt: null, clickedAt: null, opens: 0, clicks: 0,
    pageViews: 0, scrolledPages: [], convertedAt: null, lastPagePath: null,
    sessions: 0, ga4Conversions: 0,
    planStatus: null, planScore: 0, planConvertedAt: null,
  };
  if (messageId) messageIdStore[messageId] = recipientId;
  if (variantId) {
    variantToTracking[variantId] = variantToTracking[variantId] || [];
    variantToTracking[variantId].push(trackingId);
    if (campaignId && campaignStore[campaignId]) {
      const v = campaignStore[campaignId].variants.find(x => x.id === variantId);
      if (v) v.sentCount++;
    }
  }
  res.json({ ok: true });
});

// ══════════════════════════════════════════════
// Tracking endpoints
// ══════════════════════════════════════════════
app.post("/track/reply", (req, res) => {
  const { recipientId } = req.body;
  if (!recipientId) return res.status(400).json({ error: "recipientId が必要です" });
  repliedSet.add(recipientId);
  res.json({ ok: true });
});

app.post("/track/page-view", (req, res) => {
  const { trackingId, pagePath, queryString } = req.body;
  if (!trackingId || !pagePath) return res.status(400).json({ error: "trackingId と pagePath が必要です" });
  const record = trackingStore[trackingId];
  if (!record) return res.status(404).json({ error: "trackingId が見つかりません" });
  record.pageViews = (record.pageViews || 0) + 1;
  record.lastPagePath = pagePath;
  if (pagePath === CONFIG.CV_PAGE_PATH && !record.convertedAt) {
    record.convertedAt = new Date().toISOString();
  }
  let planDetected = null;
  if (pagePath === CONFIG.PLAN_THANKS_PATH && !record.planConvertedAt) {
    const qs = new URLSearchParams(queryString || "");
    let planName = qs.get("plan");
    if (planName) {
      const PLAN_ALIASES = {
        "lifetime plan": "Lifetime",
        "lifetime":      "Lifetime",
        "professional":  "Professional",
        "corporate":     "Corporate",
        "enterprise":    "Enterprise",
        "sandbox":       "Sandbox",
        "free":          "Sandbox",
      };
      const normalized = PLAN_ALIASES[planName.toLowerCase()] || planName;
      const planConf = PLAN_CONFIG[normalized] || PLAN_CONFIG[planName] || null;
      if (planConf) {
        record.planStatus = planConf.status;
        record.planScore = planConf.score;
        record.planConvertedAt = new Date().toISOString();
        planDetected = planConf;
        console.log(`💰 プラン契約検知: ${record.email || record.recipientId} → ${planConf.status}`);
      }
    }
  }
  res.json({ ok: true, pageViews: record.pageViews, converted: !!record.convertedAt, planDetected });
});

app.post("/track/scroll", (req, res) => {
  const { trackingId, pagePath } = req.body;
  if (!trackingId || !pagePath) return res.status(400).json({ error: "trackingId と pagePath が必要です" });
  const record = trackingStore[trackingId];
  if (!record) return res.status(404).json({ error: "trackingId が見つかりません" });
  if (!record.scrolledPages) record.scrolledPages = [];
  if (!record.scrolledPages.includes(pagePath)) record.scrolledPages.push(pagePath);
  res.json({ ok: true, scrolledPages: record.scrolledPages.length });
});

app.get("/track/open/:trackingId", (req, res) => {
  const record = trackingStore[req.params.trackingId];
  if (record) {
    record.opens++;
    if (!record.openedAt) record.openedAt = new Date().toISOString();
  }
  res.set("Content-Type", "image/gif");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.send(PIXEL_BUF);
});

app.get("/track/click/:trackingId", (req, res) => {
  const record = trackingStore[req.params.trackingId];
  const redirectUrl = req.query.redirect || CONFIG.CLICK_REDIRECT_URL;
  if (record) {
    record.clicks++;
    if (!record.clickedAt) record.clickedAt = new Date().toISOString();
  }
  res.redirect(redirectUrl);
});

app.get("/track/status", (_req, res) => {
  const statusMap = {};
  for (const [, record] of Object.entries(trackingStore)) {
    if (!record.recipientId) continue;
    const rid = record.recipientId;
    if (!statusMap[rid]) {
      statusMap[rid] = {
        opened: false, clicked: false, replied: false,
        opens: 0, clicks: 0, openedAt: null, clickedAt: null,
        sessions: 0, pageViews: 0, scrolledUsers: 0,
        conversions: 0, convertedAt: null, lastPagePath: null,
        planStatus: null, planScore: 0, planConvertedAt: null,
      };
    }
    const agg = statusMap[rid];
    if (record.openedAt) agg.opened = true;
    if (record.clickedAt) agg.clicked = true;
    if (repliedSet.has(rid)) agg.replied = true;
    agg.opens += record.opens || 0;
    agg.clicks += record.clicks || 0;
    agg.sessions += record.sessions || (record.pageViews > 0 ? 1 : 0);
    agg.pageViews += record.pageViews || 0;
    agg.scrolledUsers += record.scrolledPages ? record.scrolledPages.length : 0;
    agg.conversions += record.ga4Conversions || (record.convertedAt ? 1 : 0);
    if (record.openedAt && (!agg.openedAt || record.openedAt > agg.openedAt)) agg.openedAt = record.openedAt;
    if (record.clickedAt && (!agg.clickedAt || record.clickedAt > agg.clickedAt)) agg.clickedAt = record.clickedAt;
    if (record.convertedAt && (!agg.convertedAt || record.convertedAt > agg.convertedAt)) {
      agg.convertedAt = record.convertedAt;
      agg.lastPagePath = record.lastPagePath;
    }
    if (record.planConvertedAt && record.planScore > (agg.planScore || 0)) {
      agg.planStatus = record.planStatus;
      agg.planScore = record.planScore;
      agg.planConvertedAt = record.planConvertedAt;
    }
  }
  res.json(statusMap);
});

app.post("/track/multiple-page-view", (req, res) => {
  const { trackingId } = req.body;
  if (!trackingId) return res.status(400).json({ error: "trackingId が必要です" });
  if (!trackingStore[trackingId]) return res.status(404).json({ error: "trackingId が見つかりません" });
  res.json({ ok: true });
});

// ══════════════════════════════════════════════
// Experiments: 集計と自動昇格/停止
// ══════════════════════════════════════════════
app.get("/experiments/summary", (req, res) => {
  const { campaignId, days } = req.query;
  const sinceMs = days ? Date.now() - parseInt(days) * 86400000 : 0;

  const variantStats = {};
  for (const [, record] of Object.entries(trackingStore)) {
    const vid = record.variantId;
    if (!vid) continue;
    if (campaignId && record.campaignId !== campaignId) continue;
    if (sinceMs && record.sentAt && new Date(record.sentAt).getTime() < sinceMs) continue;
    if (!variantStats[vid]) {
      variantStats[vid] = {
        variantId: vid, campaignId: record.campaignId,
        sent: 0, opened: 0, clicked: 0, replied: 0,
        converted: 0, planConverted: 0, planScore: 0,
        pageViews: 0, scrollUsers: 0,
        byIndustry: {}, byCountry: {}, byTitle: {}, byPhase: {},
      };
    }
    const s = variantStats[vid];
    s.sent++;
    if (record.openedAt)  s.opened++;
    if (record.clickedAt) s.clicked++;
    if (repliedSet.has(record.recipientId)) s.replied++;
    if (record.convertedAt) s.converted++;
    if (record.planConvertedAt) { s.planConverted++; s.planScore += record.planScore || 0; }
    s.pageViews += record.pageViews || 0;
    if (record.scrolledPages?.length) s.scrollUsers++;
    const inc = (obj, key) => { if (!key) return; obj[key] = (obj[key] || 0) + 1; };
    inc(s.byIndustry, record.industry);
    inc(s.byCountry,  record.country);
    inc(s.byTitle,    record.title);
    inc(s.byPhase,    inferPhase(record, repliedSet.has(record.recipientId)));
  }

  const rows = Object.values(variantStats).map(s => {
    const cam = campaignStore[s.campaignId];
    const variant = cam?.variants.find(v => v.id === s.variantId);
    return {
      ...s,
      campaignName: cam?.name || "(unknown)",
      campaignCreatedAt: cam?.createdAt || null,
      mode: cam?.mode || "even",
      label: variant?.label || "",
      angle: variant?.angle || "",
      subject: variant?.subject || "",
      bodyPreview: variant?.bodyPreview || "",
      predOpen: variant?.predOpen || 0,
      predCtr: variant?.predCtr || 0,
      status: variant?.status || "active",
      openRate:    s.sent ? +(s.opened / s.sent * 100).toFixed(1) : 0,
      ctr:         s.sent ? +(s.clicked / s.sent * 100).toFixed(1) : 0,
      replyRate:   s.sent ? +(s.replied / s.sent * 100).toFixed(1) : 0,
      cvRate:      s.sent ? +(s.converted / s.sent * 100).toFixed(1) : 0,
      planCvRate:  s.sent ? +(s.planConverted / s.sent * 100).toFixed(1) : 0,
    };
  }).sort((a, b) => (b.planScore - a.planScore) || (b.cvRate - a.cvRate) || (b.openRate - a.openRate));

  const byCampaign = {};
  for (const r of rows) {
    if (!byCampaign[r.campaignId]) byCampaign[r.campaignId] = [];
    byCampaign[r.campaignId].push(r);
  }
  for (const cid of Object.keys(byCampaign)) {
    const vars = byCampaign[cid].filter(v => v.sent >= 30);
    if (vars.length < 2) continue;
    const primaryMetric = vars.some(v => v.converted > 0) ? "converted" : "opened";
    const sorted = [...vars].sort((a, b) => (b[primaryMetric] / b.sent) - (a[primaryMetric] / a.sent));
    const leader = sorted[0];
    for (const v of byCampaign[cid]) {
      if (v.variantId === leader.variantId || v.sent < 30) { v.significance = null; continue; }
      v.significance = proportionTest(leader[primaryMetric], leader.sent, v[primaryMetric], v.sent);
      v.significance.metric = primaryMetric;
      v.significance.vsLeader = leader.label;
    }
    for (const v of byCampaign[cid]) {
      if (!v.significance || v.variantId === leader.variantId) continue;
      if (v.significance.p < 0.05 && leader[primaryMetric] / leader.sent > v[primaryMetric] / v.sent) {
        const cam = campaignStore[cid];
        const cvar = cam?.variants.find(x => x.id === v.variantId);
        if (cvar && cvar.status === "active") {
          cvar.status = "stopped_loser";
          console.log(`⛔ 敗者自動停止: ${cam.name} / ${cvar.label}`);
        }
      }
    }
    const leaderVar = campaignStore[cid]?.variants.find(x => x.id === leader.variantId);
    if (leaderVar && leaderVar.status === "active" && byCampaign[cid].some(v => v.significance?.p < 0.05)) {
      leaderVar.status = "winner";
      console.log(`🏆 勝者自動昇格: ${campaignStore[cid].name} / ${leaderVar.label}`);
    }
  }

  const campaignAgg = {};
  for (const r of rows) {
    const cid = r.campaignId;
    if (!campaignAgg[cid]) {
      campaignAgg[cid] = {
        campaignId: cid, name: r.campaignName, createdAt: r.campaignCreatedAt, mode: r.mode,
        sent: 0, opened: 0, clicked: 0, replied: 0, converted: 0,
        planConverted: 0, planScore: 0, variants: 0,
      };
    }
    const a = campaignAgg[cid];
    a.sent += r.sent; a.opened += r.opened; a.clicked += r.clicked;
    a.replied += r.replied; a.converted += r.converted;
    a.planConverted += r.planConverted; a.planScore += r.planScore;
    a.variants++;
  }
  const campaigns = Object.values(campaignAgg).map(c => ({
    ...c,
    openRate: c.sent ? +(c.opened / c.sent * 100).toFixed(1) : 0,
    ctr:      c.sent ? +(c.clicked / c.sent * 100).toFixed(1) : 0,
    replyRate: c.sent ? +(c.replied / c.sent * 100).toFixed(1) : 0,
    cvRate:   c.sent ? +(c.converted / c.sent * 100).toFixed(1) : 0,
    planCvRate: c.sent ? +(c.planConverted / c.sent * 100).toFixed(1) : 0,
  })).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  res.json({ variants: rows, campaigns });
});

app.get("/experiments/matrix", (req, res) => {
  const { groupBy = "industry", days, minSent = 10 } = req.query;
  const sinceMs = days ? Date.now() - parseInt(days) * 86400000 : 0;
  const matrix = {};
  const segmentTotals = {};
  const variantLabels = {};

  for (const [, r] of Object.entries(trackingStore)) {
    if (!r.variantId) continue;
    if (sinceMs && r.sentAt && new Date(r.sentAt).getTime() < sinceMs) continue;
    let segVal;
    if (groupBy === "phase") segVal = inferPhase(r, repliedSet.has(r.recipientId));
    else if (groupBy === "titleGroup") segVal = normalizeTitle(r.title);
    else if (groupBy === "segmentKey") segVal = r.segmentKey || `${r.industry || "?"}×${normalizeTitle(r.title) || "?"}`;
    else segVal = r[groupBy] || "(unknown)";
    if (!segVal) continue;

    if (!matrix[segVal]) matrix[segVal] = {};
    if (!matrix[segVal][r.variantId]) {
      matrix[segVal][r.variantId] = { sent: 0, opened: 0, clicked: 0, replied: 0, converted: 0, planConverted: 0, planScore: 0 };
    }
    const s = matrix[segVal][r.variantId];
    s.sent++;
    if (r.openedAt)  s.opened++;
    if (r.clickedAt) s.clicked++;
    if (repliedSet.has(r.recipientId)) s.replied++;
    if (r.convertedAt) s.converted++;
    if (r.planConvertedAt) { s.planConverted++; s.planScore += r.planScore || 0; }

    if (!segmentTotals[segVal]) segmentTotals[segVal] = { sent: 0, opened: 0, clicked: 0, replied: 0, converted: 0, planScore: 0 };
    const st = segmentTotals[segVal];
    st.sent++;
    if (r.openedAt)  st.opened++;
    if (r.clickedAt) st.clicked++;
    if (repliedSet.has(r.recipientId)) st.replied++;
    if (r.convertedAt) st.converted++;
    if (r.planConvertedAt) st.planScore += r.planScore || 0;

    if (!variantLabels[r.variantId]) {
      const cam = campaignStore[r.campaignId];
      const vv = cam?.variants.find(x => x.id === r.variantId);
      variantLabels[r.variantId] = {
        label: vv?.label || "",
        subject: vv?.subject || r.subject || "",
        campaignName: cam?.name || "",
        status: vv?.status || "active",
      };
    }
  }

  const output = Object.entries(matrix)
    .filter(([, vs]) => Object.values(vs).reduce((s, v) => s + v.sent, 0) >= minSent)
    .map(([seg, vs]) => {
      const variants = Object.entries(vs).map(([vid, s]) => ({
        variantId: vid, ...variantLabels[vid], ...s,
        openRate:   s.sent ? +(s.opened / s.sent * 100).toFixed(1) : 0,
        ctr:        s.sent ? +(s.clicked / s.sent * 100).toFixed(1) : 0,
        replyRate:  s.sent ? +(s.replied / s.sent * 100).toFixed(1) : 0,
        cvRate:     s.sent ? +(s.converted / s.sent * 100).toFixed(1) : 0,
        planCvRate: s.sent ? +(s.planConverted / s.sent * 100).toFixed(1) : 0,
      }));
      const useMetric = variants.some(v => v.converted > 0) ? "cvRate" : "openRate";
      const winner = [...variants].sort((a, b) => b[useMetric] - a[useMetric])[0];
      const totals = segmentTotals[seg];
      return {
        segment: seg,
        totalSent: totals.sent,
        totalOpened: totals.opened,
        totalClicked: totals.clicked,
        totalReplied: totals.replied,
        totalConverted: totals.converted,
        totalPlanScore: totals.planScore,
        openRate: totals.sent ? +(totals.opened / totals.sent * 100).toFixed(1) : 0,
        cvRate:   totals.sent ? +(totals.converted / totals.sent * 100).toFixed(1) : 0,
        winningMetric: useMetric, winner, variants,
      };
    }).sort((a, b) => b.totalPlanScore - a.totalPlanScore || b.totalSent - a.totalSent);

  res.json({ groupBy, matrix: output });
});

// ══════════════════════════════════════════════
// 学習ループ: 週次スコア重み更新
// ══════════════════════════════════════════════
app.post("/learning/update-weights", (_req, res) => {
  const winContacts = [], loseContacts = [];
  for (const [, r] of Object.entries(trackingStore)) {
    if (!r.sentAt) continue;
    const isWin = !!r.planConvertedAt || !!r.convertedAt;
    if (isWin) winContacts.push(r); else loseContacts.push(r);
  }
  if (winContacts.length < 3) {
    return res.json({
      ok: false,
      reason: `勝ち事例(CV)が少なすぎます(${winContacts.length}件)。最低3件必要です。`,
      weights: scoreWeights,
    });
  }
  const tally = (arr, key, normalizer) => {
    const m = {};
    for (const r of arr) {
      let v = normalizer ? normalizer(r[key]) : (r[key] || "");
      if (!v) continue;
      m[v] = (m[v] || 0) + 1;
    }
    return m;
  };
  const winCount = winContacts.length;
  const allCount = winContacts.length + loseContacts.length;
  const all = [...winContacts, ...loseContacts];

  const liftWeight = (win, all) => {
    const out = {};
    for (const [k, allN] of Object.entries(all)) {
      if (allN < 3) continue;
      const winN = win[k] || 0;
      const winRate = winN / winCount;
      const baseRate = allN / allCount;
      if (baseRate === 0) continue;
      const lift = winRate / baseRate;
      out[k] = +Math.max(0.2, Math.min(5, lift)).toFixed(2);
    }
    return out;
  };

  // ── チャンネル別エンゲージメント統計（学習参考値）──
  const channelStats = {};
  for (const r of all) {
    const ch = r.channel || "email";
    if (!channelStats[ch]) channelStats[ch] = { sent: 0, clicked: 0, converted: 0 };
    channelStats[ch].sent++;
    if (r.clickedAt) channelStats[ch].clicked++;
    if (r.planConvertedAt || r.convertedAt) channelStats[ch].converted++;
  }
  for (const ch of Object.keys(channelStats)) {
    const s = channelStats[ch];
    s.ctr = s.sent ? +(s.clicked / s.sent * 100).toFixed(1) : 0;
    s.cvRate = s.sent ? +(s.converted / s.sent * 100).toFixed(1) : 0;
  }

  scoreWeights = {
    ...scoreWeights,
    industry: liftWeight(tally(winContacts, "industry"), tally(all, "industry")),
    title:    liftWeight(tally(winContacts, "title", normalizeTitle), tally(all, "title", normalizeTitle)),
    country:  liftWeight(tally(winContacts, "country"), tally(all, "country")),
  };
  scoreWeightsUpdatedAt = new Date().toISOString();

  res.json({
    ok: true,
    updatedAt: scoreWeightsUpdatedAt,
    weights: scoreWeights,
    channelStats,  // LinkedIn vs Email の比較を PDCA タブで表示できる
    stats: {
      winners: winCount, total: allCount,
      winnerExamples: winContacts.slice(0, 10).map(r => ({
        industry: r.industry, title: r.title, titleGroup: normalizeTitle(r.title),
        country: r.country, planStatus: r.planStatus, channel: r.channel || "email",
      })),
    },
  });
});

app.get("/learning/weights", (_req, res) => {
  res.json({ weights: scoreWeights, updatedAt: scoreWeightsUpdatedAt });
});

// ══════════════════════════════════════════════
// tracker.js
// ══════════════════════════════════════════════
app.get("/tracker.js", (_req, res) => {
  const RAILWAY_URL = CONFIG.TUNNEL_URL;
  res.set("Content-Type", "application/javascript; charset=utf-8");
  res.set("Cache-Control", "no-cache");
  res.set("Access-Control-Allow-Origin", "*");
  res.send(`
(function() {
  var RAILWAY = "${RAILWAY_URL}";
  var params = new URLSearchParams(window.location.search);
  var tid = params.get("utm_campaign");
  if (tid) { try { sessionStorage.setItem("sa_tracking_id", tid); } catch(e) {} }
  else { try { tid = sessionStorage.getItem("sa_tracking_id"); } catch(e) {} }
  if (!tid) return;
  var sentPaths = {};
  function sendPageView() {
    var currentTid = tid;
    try { var stored = sessionStorage.getItem("sa_tracking_id"); if (stored) currentTid = stored; } catch(e) {}
    if (!currentTid) return;
    var pagePath = window.location.pathname;
    var queryString = window.location.search.slice(1);
    var pageKey = pagePath + "?" + queryString;
    if (sentPaths[pageKey]) return;
    sentPaths[pageKey] = true;
    fetch(RAILWAY + "/track/page-view", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingId: currentTid, pagePath: pagePath, pageTitle: document.title, queryString: queryString })
    }).catch(function() {});
    try {
      var key = "sa_pages_" + currentTid;
      var visited = JSON.parse(sessionStorage.getItem(key) || "[]");
      if (!visited.includes(pagePath)) { visited.push(pagePath); sessionStorage.setItem(key, JSON.stringify(visited)); }
      if (visited.length >= 2) {
        fetch(RAILWAY + "/track/multiple-page-view", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackingId: currentTid, pagesVisited: visited.length, currentPage: pagePath })
        }).catch(function() {});
      }
    } catch(e) {}
    setupScroll(currentTid, pagePath);
  }
  var currentScrollHandler = null;
  function setupScroll(currentTid, pagePath) {
    if (currentScrollHandler) window.removeEventListener("scroll", currentScrollHandler);
    var fired = false;
    currentScrollHandler = function() {
      if (fired) return;
      var el = document.documentElement;
      var pct = (el.scrollTop + el.clientHeight) / el.scrollHeight * 100;
      if (pct >= 90) {
        fired = true;
        fetch(RAILWAY + "/track/scroll", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackingId: currentTid, pagePath: pagePath, percentScrolled: 90 })
        }).catch(function() {});
      }
    };
    window.addEventListener("scroll", currentScrollHandler, { passive: true });
  }
  sendPageView();
  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function() { origPush.apply(this, arguments); onRouteChange(); };
  history.replaceState = function() { origReplace.apply(this, arguments); onRouteChange(); };
  window.addEventListener("popstate", function() { onRouteChange(); });
  function onRouteChange() { setTimeout(function() { sendPageView(); }, 100); }
})();
  `);
});

// ══════════════════════════════════════════════
// GA4
// ══════════════════════════════════════════════
let ga4Client = null;
async function setupGA4() {
  const privateKey = process.env.GA_PRIVATE_KEY;
  const clientEmail = process.env.GA_CLIENT_EMAIL;
  if (!privateKey || !clientEmail) { console.log("⚠️  GA4トラッキングは無効です。"); return; }
  if (!CONFIG.GA4_PROPERTY_ID) { console.log("⚠️  GA4_PROPERTY_ID が未設定です。"); return; }
  try {
    const credentials = {
      type: "service_account",
      private_key: privateKey.replace(/\\n/g, "\n").replace(/\r\n/g, "\n"),
      client_email: clientEmail,
    };
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/analytics.readonly"] });
    ga4Client = await auth.getClient();
    console.log("✓ GA4 認証済み");
  } catch (e) { console.error("GA4認証エラー:", e.message); }
}
async function fetchGA4ByTrackingIds(days = 1) {
  if (!ga4Client || !CONFIG.GA4_PROPERTY_ID) return null;
  try {
    const analyticsData = google.analyticsdata({ version: "v1beta", auth: ga4Client });
    const response = await analyticsData.properties.runReport({
      property: `properties/${CONFIG.GA4_PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
        dimensions: [{ name: "sessionCampaignName" }, { name: "pagePath" }],
        metrics: [{ name: "sessions" }, { name: "screenPageViews" }, { name: "scrolledUsers" }, { name: "conversions" }],
        dimensionFilter: { filter: { fieldName: "sessionCampaignName", stringFilter: { matchType: "FULL_REGEXP", value: "^[0-9a-f-]{36}$" } } },
        limit: 1000,
      },
    });
    return response.data.rows || [];
  } catch (e) { console.error("GA4 fetch エラー:", e.message); return null; }
}
async function syncGA4ToTrackingStore() {
  const rows = await fetchGA4ByTrackingIds(2);
  if (!rows) return;
  const byTrackingId = {};
  for (const row of rows) {
    const tid = row.dimensionValues[0]?.value;
    const pagePath = row.dimensionValues[1]?.value || "";
    if (!tid || tid === "(not set)") continue;
    if (!byTrackingId[tid]) byTrackingId[tid] = { sessions: 0, pageViews: 0, scrolledUsers: 0, conversions: 0, visitedPaths: [] };
    const g = byTrackingId[tid];
    g.sessions += parseInt(row.metricValues[0]?.value || "0");
    g.pageViews += parseInt(row.metricValues[1]?.value || "0");
    g.scrolledUsers += parseInt(row.metricValues[2]?.value || "0");
    g.conversions += parseInt(row.metricValues[3]?.value || "0");
    if (pagePath && !g.visitedPaths.includes(pagePath)) g.visitedPaths.push(pagePath);
  }
  let updated = 0;
  for (const [tid, gaData] of Object.entries(byTrackingId)) {
    const record = trackingStore[tid];
    if (!record) continue;
    record.pageViews = gaData.pageViews;
    record.scrolledPages = gaData.visitedPaths;
    record.sessions = gaData.sessions;
    record.ga4Conversions = gaData.conversions;
    if (!record.convertedAt && gaData.visitedPaths.includes(CONFIG.CV_PAGE_PATH)) {
      record.convertedAt = new Date().toISOString();
    }
    updated++;
  }
  if (updated > 0) console.log(`✓ GA4同期: ${updated}件`);
}
app.get("/ga/report", async (req, res) => {
  if (!ga4Client) return res.status(503).json({ error: "GA4が設定されていません" });
  const days = parseInt(req.query.days || "30");
  try {
    const analyticsData = google.analyticsdata({ version: "v1beta", auth: ga4Client });
    const response = await analyticsData.properties.runReport({
      property: `properties/${CONFIG.GA4_PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
        dimensions: [{ name: "sessionCampaignName" }, { name: "sessionSourceMedium" }, { name: "pagePath" }],
        metrics: [{ name: "sessions" }, { name: "screenPageViews" }, { name: "scrolledUsers" }, { name: "conversions" }, { name: "averageSessionDuration" }],
        dimensionFilter: { filter: { fieldName: "sessionSourceMedium", stringFilter: { matchType: "CONTAINS", value: "email" } } },
        limit: 100,
      },
    });
    const rows = (response.data.rows || []).map(row => ({
      campaign: row.dimensionValues[0]?.value || "(not set)",
      sourceMedium: row.dimensionValues[1]?.value || "",
      pagePath: row.dimensionValues[2]?.value || "",
      sessions: parseInt(row.metricValues[0]?.value || "0"),
      pageViews: parseInt(row.metricValues[1]?.value || "0"),
      scrolledUsers: parseInt(row.metricValues[2]?.value || "0"),
      conversions: parseInt(row.metricValues[3]?.value || "0"),
      avgDuration: parseFloat(row.metricValues[4]?.value || "0"),
    }));
    res.json({ rows, days });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/ga/sync", async (_req, res) => {
  if (!ga4Client) return res.status(503).json({ error: "GA4が設定されていません" });
  await syncGA4ToTrackingStore();
  res.json({ ok: true, tracked: Object.keys(trackingStore).length });
});

// ══════════════════════════════════════════════
// dollar-biz Supabase プラン同期
// ══════════════════════════════════════════════
app.post("/plan-sync", async (req, res) => {
  const supaUrl = CONFIG.DOLLARBIZ_SUPABASE_URL;
  const supaKey = CONFIG.DOLLARBIZ_SUPABASE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(503).json({ error: "DOLLARBIZ_SUPABASE_URL / DOLLARBIZ_SUPABASE_KEY が未設定です" });
  }

  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: "emails 配列が必要です" });
  }

  try {
    const CHUNK = 200;
    const allProfiles = [];
    for (let i = 0; i < emails.length; i += CHUNK) {
      const chunk = emails.slice(i, i + CHUNK);
      const inList = chunk.map(e => `"${e}"`).join(",");
      const url = `${supaUrl}/rest/v1/profiles?select=email,plan&email=in.(${inList})`;
      const r = await fetch(url, {
        headers: {
          "apikey": supaKey,
          "Authorization": `Bearer ${supaKey}`,
          "Content-Type": "application/json",
        },
      });
      if (!r.ok) {
        const errText = await r.text();
        console.error(`plan-sync Supabase error: ${r.status} ${errText.slice(0, 200)}`);
        continue;
      }
      const rows = await r.json();
      allProfiles.push(...rows);
    }

    const PLAN_MAP = {
      "sandbox":      "Sandbox",
      "free":         "Sandbox",
      "professional": "Professional",
      "corporate":    "Corporate",
      "enterprise":   "Enterprise",
      "lifetime":     "Lifetime",
      "lifetime plan":"Lifetime",
    };

    const results = {};
    for (const profile of allProfiles) {
      if (!profile.email || !profile.plan) continue;
      const email = profile.email.toLowerCase();
      const rawPlan = (profile.plan || "").toLowerCase().trim();
      const mappedStatus = PLAN_MAP[rawPlan] || null;
      if (mappedStatus) {
        const cfg = PLAN_CONFIG[mappedStatus];
        results[email] = {
          plan: profile.plan,
          status: mappedStatus,
          score: cfg?.score || 0,
        };
      }
    }

    console.log(`📊 plan-sync: ${emails.length}件中 ${Object.keys(results).length}件がプラン確認済み`);
    res.json({ ok: true, matched: Object.keys(results).length, total: emails.length, results });
  } catch (e) {
    console.error("plan-sync error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════
// Health
// ══════════════════════════════════════════════
app.get("/health", (_req, res) => {
  const totalSent = Object.values(domainQuality).reduce((s, q) => s + q.sent, 0);
  res.json({
    status: "ok",
    mode: "v2: tracking + experiments + learning + deliverability",
    tracked: Object.keys(trackingStore).length,
    campaigns: Object.keys(campaignStore).length,
    ga4Connected: !!ga4Client,
    repliedCount: repliedSet.size,
    suppressions: suppressionSet.size,
    domainsTracked: Object.keys(domainQuality).length,
    totalSent,
    recentBounce24h: bounceStream.length,
    scoreWeightsUpdatedAt,
  });
});

/**
 * server.js パッチ — インテントベース検索エンドポイント追加
 *
 * 既存の server.js の末尾（app.listen の直前）に追記してください。
 *
 * 追加される環境変数:
 *   SERPER_API_KEY  — https://serper.dev で無料取得 (2,500回/月)
 *
 * 追加エンドポイント:
 *   POST /search/intent-xray       — Google X-Ray検索 → 候補者パース
 *   POST /email/guess-and-verify   — 氏名+ドメインからメアド推測 → EmailVerify.io検証
 */

// ══════════════════════════════════════════════════════════════
// 設定追加（CONFIG オブジェクトに追記するか、ここで参照）
// ══════════════════════════════════════════════════════════════
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "BSAa57ptg3zN_mpPrzv-C3IW1Vlt8VC";

// ── X-Ray 検索クエリのパターン ──
const LINKEDIN_SITE_QUERY = "site:linkedin.com/in";

// ── SMTP 検証ヘルパー ──
const dns = require('dns').promises;
const net = require('net');

const SMTP_HELO = process.env.SMTP_HELO_DOMAIN || 'verifier.invalid';
const SMTP_FROM = process.env.SMTP_MAIL_FROM   || `probe@${SMTP_HELO}`;

function smtpSession(host, recipients) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: 25 });
    socket.setEncoding('utf8');
    socket.setTimeout(12000);
    const results = recipients.map(r => ({ rcpt: r, code: null, message: '' }));
    let buf = '', phase = 'greet', idx = 0;
    const send = l => socket.write(l + '\r\n');
    const finish = reason => { try { socket.destroy(); } catch (_) {} resolve({ results, reason }); };
    socket.on('timeout', () => finish('timeout'));
    socket.on('error',   e  => finish(e.code || 'error'));
    socket.on('close',   ()  => finish('closed'));
    socket.on('data', chunk => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const raw = buf.slice(0, nl).replace(/\r$/, ''); buf = buf.slice(nl + 1);
        if (!raw || /^\d{3}-/.test(raw)) continue;
        const code = parseInt(raw.slice(0, 3), 10), msg = raw.slice(4);
        switch (phase) {
          case 'greet': if (code !== 220) { finish(`bad_greet_${code}`); return; } phase = 'ehlo'; send(`EHLO ${SMTP_HELO}`); break;
          case 'ehlo':  if (code !== 250) { phase = 'helo'; send(`HELO ${SMTP_HELO}`); break; } phase = 'mail'; send(`MAIL FROM:<${SMTP_FROM}>`); break;
          case 'helo':  if (code !== 250) { finish(`helo_failed_${code}`); return; } phase = 'mail'; send(`MAIL FROM:<${SMTP_FROM}>`); break;
          case 'mail':  if (code !== 250) { finish(`mail_from_failed_${code}`); return; } phase = 'rcpt'; send(`RCPT TO:<${recipients[idx]}>`); break;
          case 'rcpt':
            results[idx].code = code; results[idx].message = msg; idx++;
            if (idx < recipients.length) { send(`RCPT TO:<${recipients[idx]}>`); }
            else { phase = 'quit'; send('QUIT'); }
            break;
          case 'quit': finish('done'); break;
        }
      }
    });
  });
}

function smtpClassifyProvider(mxHost) {
  const h = (mxHost || '').toLowerCase();
  if (h.endsWith('.protection.outlook.com')) return 'microsoft365';
  if (h.endsWith('.google.com') || h.includes('googlemail')) return 'google';
  if (h.includes('mimecast') || h.includes('proofpoint') || h.includes('barracuda')) return 'security_gateway';
  return 'self_hosted';
}

async function smtpVerifyBatch(domain, candidateEmails) {
  let mx;
  try { mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority); }
  catch { return { domain, provider: 'no_mx', results: candidateEmails.map(e => ({ email: e, status: 'unknown', reason: 'no_mx' })) }; }
  const mxHost = mx[0].exchange;
  const provider = smtpClassifyProvider(mxHost);
  if (provider !== 'self_hosted') {
    return { domain, mxHost, provider, results: candidateEmails.map(e => ({ email: e, status: 'unverifiable', reason: `provider_${provider}` })) };
  }
  const probe = `xq8z9k${Date.now().toString(36)}-noexist@${domain}`;
  const session = await smtpSession(mxHost, [probe, ...candidateEmails]);
  const isCatchAll = session.results[0]?.code >= 200 && session.results[0]?.code < 300;
  const results = session.results.slice(1).map(r => {
    if (r.code === null) return { email: r.rcpt, status: 'unknown', reason: session.reason };
    if (r.code >= 200 && r.code < 300) return { email: r.rcpt, status: isCatchAll ? 'catch_all' : 'valid', code: r.code };
    if (r.code >= 400 && r.code < 500) return { email: r.rcpt, status: 'risky', code: r.code };
    return { email: r.rcpt, status: 'invalid', code: r.code, reason: r.message };
  });
  return { domain, mxHost, provider, isCatchAll, results };
}

// 推測メアドパターン生成
// 入力: firstName="Taro", lastName="Yamada", domain="example.com"
// 出力: ["taro@example.com", "yamada.taro@example.com", ...]
function generateEmailGuesses(firstName, lastName, domain) {
  const f = (firstName || "").toLowerCase().trim().replace(/[^a-z]/g, "");
  const l = (lastName  || "").toLowerCase().trim().replace(/[^a-z]/g, "");
  const d = (domain    || "").toLowerCase().trim();
  if (!d) return [];
  if (!f && !l) return [];

  const fi = f ? f[0] : "";  // first initial
  const li = l ? l[0] : "";  // last initial

  const raw = [];

  // --- フルネーム系 ---
  if (f && l) {
    raw.push(`${f}.${l}@${d}`);       // john.smith@
    raw.push(`${f}_${l}@${d}`);       // john_smith@
    raw.push(`${f}${l}@${d}`);        // johnsmith@
    raw.push(`${l}.${f}@${d}`);       // smith.john@
    raw.push(`${l}_${f}@${d}`);       // smith_john@
    raw.push(`${l}${f}@${d}`);        // smithjohn@
    raw.push(`${f}-${l}@${d}`);       // john-smith@
    raw.push(`${l}-${f}@${d}`);       // smith-john@
  }

  // --- イニシャル系 ---
  if (fi && l) {
    raw.push(`${fi}${l}@${d}`);       // jsmith@
    raw.push(`${fi}.${l}@${d}`);      // j.smith@
    raw.push(`${fi}_${l}@${d}`);      // j_smith@
    raw.push(`${fi}-${l}@${d}`);      // j-smith@
  }
  if (f && li) {
    raw.push(`${f}${li}@${d}`);       // johns@
    raw.push(`${f}.${li}@${d}`);      // john.s@
    raw.push(`${f}_${li}@${d}`);      // john_s@
  }
  if (li && f) {
    raw.push(`${l}.${fi}@${d}`);      // smith.j@
    raw.push(`${l}${fi}@${d}`);       // smithj@
  }
  if (fi && li) {
    raw.push(`${fi}${li}@${d}`);      // js@
  }

  // --- 単体系 ---
  if (f) raw.push(`${f}@${d}`);       // john@
  if (l) raw.push(`${l}@${d}`);       // smith@

  // 重複除去 & 不正アドレスをフィルタ
  const VALID = /^[a-z][a-z0-9._-]*[a-z0-9]?@[a-z0-9.-]+\.[a-z]{2,}$/;
  const patterns = [...new Set(raw)].filter(e => VALID.test(e));

  return patterns;
}

// snippet / title からリンクトイン候補をパース
// LinkedIn のスニペット例:
//   "Taro Yamada · CFO at Acme Corp · Tokyo, Japan"
//   "Jane Doe - VP of Engineering | LinkedIn"
//   Brave例: "CFO at Acme Corp · Experience: CTO at OldCo, Analyst at BigBank"
//
// 重要: LinkedInでは「最初に出てくる役職・会社」が現職。
//   スニペットに "Experience:" "Previously:" "Former" 以降は過去職。
function parseLinkedInCandidate(item) {
  const rawTitle   = (item.title   || "").trim();
  const rawSnippet = (item.snippet || "").trim();
  const link       = item.link     || "";

  // --- 氏名の抽出 ---
  let name = "";
  const nameSep = rawTitle.match(/^([A-Za-zÀ-ÿ\u3000-\u9FFF\uFF00-\uFFEF\u30A0-\u30FF\u3040-\u309F\u4E00-\u9FFF\s\-\.]+?)[\-\|·]/);
  if (nameSep) {
    name = nameSep[1].trim();
  } else {
    const words = rawTitle.split(/\s+/);
    name = words.slice(0, 3).join(" ");
  }
  name = name.replace(/\bLinkedIn\b/i, "").trim();

  // --- 現職部分のみ抽出 ---
  // "Experience:" や "Previously:" 以降を切り捨て、先頭の役職・会社を現職とみなす
  const currentSnippet = rawSnippet
    .split(/(?:Experience|Previously|Past|Former|Education|Skills|Connections)\s*[:·|]/i)[0]
    .trim();

  // --- 役職の抽出（現職のみ） ---
  let title = "";
  const titleMatch =
    currentSnippet.match(/^([^·\n|]{3,50}?)\s+(?:at|@)\s/i) ||
    currentSnippet.match(/^([^·\n|]{3,50}?)\s*[·|]\s/) ||
    rawTitle.match(/(?:[\-|]\s*)([A-Za-z][^|\-·]{3,50}?)(?:\s+at\s|\s*\|)/i);
  if (titleMatch) {
    title = titleMatch[1].trim().replace(/^[\-|·]\s*/, "");
    // "Former" "Ex-" で始まる場合は過去職 → 除外
    if (/^(Former|Ex-|Past|Previous)/i.test(title)) title = "";
  }

  // 役職キーワード（これだけのときは会社名ではない）
  const JOB_TITLE_RE = /^(CEO|CFO|CTO|COO|CMO|CPO|CRO|CDO|CISO|CSO|CLO|MD|VP|SVP|EVP|GM|Director|Manager|Head|Chief|Founder|Co-Founder|President|Owner|Partner|Principal|Consultant|Advisor|Engineer|Developer|Designer|Analyst|Associate|Specialist|Lead|Senior|Junior|Intern)/i;

  // --- 会社名の抽出（現職のみ） ---
  let company = "";

  // 1. スニペット・タイトルの "at Company" 形式を最優先（ファクトベース）
  const atMatch =
    currentSnippet.match(/(?:^|\s)(?:at|@)\s+([A-Za-z0-9][A-Za-z0-9\s\.,&\-']{1,50?})(?:\s*[·|\n·]|$)/i) ||
    rawTitle.match(/\bat\s+([A-Za-z0-9][A-Za-z0-9\s\.,&\-']{1,50?})(?:\s*[·|\-|\|]|$)/i);
  if (atMatch) company = atMatch[1].trim();

  // 2. "Name - X | LinkedIn" の X が役職でなければ会社名
  if (!company) {
    const dashMatch = rawTitle.match(/^.+?\s+-\s+(.+?)\s*(?:\||·|$)/);
    if (dashMatch) {
      const candidate = dashMatch[1].replace(/\bLinkedIn\b/i, "").trim();
      // 役職キーワードだけ or "at"を含む場合はスキップ（atMatchで拾うべき）
      if (candidate && !JOB_TITLE_RE.test(candidate) && !candidate.toLowerCase().includes(" at ")) {
        company = candidate;
      }
    }
  }

  company = company.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, "").trim();

  // --- ドメイン推測 ---
  let guessedDomain = "";
  if (company) {
    const cleaned = company
      .toLowerCase()
      .replace(/\b(inc|corp|ltd|llc|co|group|company|holdings|グループ|株式会社|有限会社)\b/g, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();
    if (cleaned.length >= 2) guessedDomain = `${cleaned}.com`;
  }

  return {
    id:            `xray_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name:          name || "不明",
    title:         title || "",
    company:       company || "",
    linkedinUrl:   link,
    guessedDomain: guessedDomain,
    rawTitle,
    rawSnippet,
    status:        "未送信",
    email:         "",
    _verifyStatus: null,
  };
}

// ══════════════════════════════════════════════════════════════
// POST /search/intent-xray  v6 — Brave Search API + Gemini 2.5 Flash
//   body: { intentQuery: string, targetingContext?: string, limit?: number }
//
//   処理フロー:
//     Stage 1: Gemini がクエリ生成
//     Stage 2: Brave Search API で検索 → Gemini が結果精査・JSON構造化
// ══════════════════════════════════════════════════════════════
app.post("/search/intent-xray", async (req, res) => {
  if (!BRAVE_API_KEY) {
    return res.status(503).json({
      error: "BRAVE_API_KEY が未設定です。https://brave.com/search/api/ で取得して Railway 環境変数に設定してください。",
    });
  }

  const geminiKey = CONFIG.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(503).json({
      error: "GEMINI_API_KEY が未設定です。Google AI Studio で取得して Railway 環境変数に設定してください。",
    });
  }

  const { intentQuery, targetingContext, limit = 10, settings: clientSettings } = req.body;

  // 後方互換: 旧API (query フィールド) もサポート
  const rawIntent = intentQuery || req.body.query;
  if (!rawIntent || typeof rawIntent !== "string") {
    return res.status(400).json({ error: "intentQuery (string) が必要です" });
  }

  // 自社サービス情報をクエリ生成コンテキストに注入
  const bizCtx = clientSettings ? `
【自社サービス概要（ターゲット選定の参考）】
会社名: ${clientSettings.myCompany || "(未設定)"}
サービス: ${clientSettings.myService || "(未設定)"}
主なターゲット: Web3企業・オンラインカジノ・OTCデスク・暗号資産を扱うB2B決済事業者
プラン別想定顧客: Sandbox=Pre-seed, Professional=Seed〜early-stage Web3, Corporate=Series A/B, Enterprise=オンラインカジノ/OTCデスク
` : "";

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

  // ── Gemini リトライヘルパー (503/429 対策) ──
  const callGeminiWithRetry = async (bodyObj, label, maxRetries = 3) => {
    const bodyStr = JSON.stringify(bodyObj);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const r = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyStr,
      });
      if (r.ok) return r;
      if ((r.status === 503 || r.status === 429) && attempt < maxRetries) {
        const wait = attempt * 2000;
        console.warn(`⏳ ${label}: ${r.status} — ${wait}ms 後にリトライ (${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      const errText = await r.text();
      throw new Error(`${label} Gemini API ${r.status}: ${errText.slice(0, 300)}`);
    }
  };

  try {
    // ────────────────────────────────────────
    // Stage 1: Gemini でクエリ生成
    // ────────────────────────────────────────
    const queryGenPrompt = `あなたは Google X-Ray 検索の専門家です。
以下のユーザーの「検索意図」と「ターゲティングの背景・条件」をもとに、
LinkedIn の人物プロフィールを探すための Google X-Ray 検索クエリを1行で生成してください。

【検索意図（誰を探しているか）】
${rawIntent}

${targetingContext ? `【ターゲティングの背景・条件】\n${targetingContext}\n` : "（背景・条件の入力なし）"}

${bizCtx}

【ルール】
- 必ず "site:linkedin.com/in" で始める
- 役職は英語で記載 (例: CFO, VP of Engineering, Head of Sales)
- 業界・地域・会社規模などの条件をキーワードとして自然に含める
- 「Web3」「web3」「crypto」「blockchain」「DeFi」「stablecoin」「NFT」「GameFi」「P2E」などは検索意図に応じてOR展開する
- 背景条件に記載された条件は必ず全てクエリに反映すること（省略禁止）
- 引用符は必要な場合のみ使う
- 日本語のキーワードは英語に翻訳する
- クエリのみを返す (説明文は不要)
- ヒット率を最大化するために、OR演算子を活用して幅広くカバーする

出力例:
site:linkedin.com/in (CFO OR "Head of Finance") (FinTech OR "crypto" OR "web3" OR "stablecoin") (Singapore OR Vietnam OR USA)`;

    const stage1Res = await callGeminiWithRetry({
      contents: [{ parts: [{ text: queryGenPrompt }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.2 },
    }, "Stage1");

    const stage1Data = await stage1Res.json();
    const stage1Raw = (stage1Data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();

    let generatedQuery = rawIntent;
    if (stage1Raw) {
      const cleaned = stage1Raw
        .replace(/```[a-z]*\n?/gi, "")
        .replace(/```/g, "")
        .replace(/^["'`\n]|["'`\n]$/g, "")
        .trim();
      if (cleaned) generatedQuery = cleaned;
    }

    // site: が含まれていなければ prefix 付与
    const finalQuery = generatedQuery.includes("site:")
      ? generatedQuery
      : `${LINKEDIN_SITE_QUERY} ${generatedQuery}`;

    // ────────────────────────────────────────
    // Brave Search API で検索（最大20件）
    // ────────────────────────────────────────
    const searchCount = Math.min(limit || 10, 20);
    const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(finalQuery)}&count=${searchCount}`;

    console.log(`🔍 Brave送信クエリ: "${finalQuery}" (count=${searchCount})`);

    const response = await fetch(braveUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_API_KEY,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ Brave API ${response.status}: ${errText.slice(0, 500)}`);
      return res.status(response.status).json({
        error: `Brave Search API エラー: ${response.status} — ${errText.slice(0, 300)}`,
        _query: finalQuery,
      });
    }

    const data = await response.json();
    const webResults = (data.web && data.web.results) || [];

    if (webResults.length === 0) {
      return res.json({
        query: finalQuery,
        total: 0,
        _rawTotal: 0,
        candidates: [],
        _search: "brave",
        _llm: "gemini",
      });
    }

    // Brave のレスポンスを parseLinkedInCandidate 互換の形式に変換
    const linkedinItems = webResults
      .filter(item => (item.url || "").includes("linkedin.com/in/"))
      .map(item => ({
        title:   item.title || "",
        snippet: item.description || "",
        link:    item.url || "",
      }));

    // パース
    let candidates = linkedinItems.map(parseLinkedInCandidate).filter(c => c.name && c.name !== "不明");
    const rawTotal = candidates.length;

    // ────────────────────────────────────────
    // Stage 2: Gemini で結果精査（コンテキストがある場合のみ）
    // ────────────────────────────────────────
    if (targetingContext && targetingContext.trim() && candidates.length > 0) {
      const candidateSummaries = candidates.map((c, i) =>
        `[${i}] ${c.name} | ${c.title || "役職不明"} | ${c.company || "企業不明"} | snippet: ${(c.rawSnippet || "").slice(0, 120)}`
      ).join("\n");

      const refinePrompt = `あなたはB2B営業のターゲティング専門家です。
以下の検索結果を精査し、ユーザーのターゲティング条件に合致するかを判定してください。

【ユーザーの検索意図】
${rawIntent}

【ターゲティングの背景・条件】
${targetingContext}

${bizCtx}

【検索結果候補】
${candidateSummaries}

【タスク】
各候補について以下をJSON配列で返してください。条件に合致しない候補は含めないでください。
上位 ${limit} 件まで、関連度が高い順に並べてください。

「Web3」「crypto」「blockchain」「DeFi」「stablecoin」「NFT」「GameFi」「online casino」「OTC」「fintech」などの
キーワードが検索意図に含まれる場合、それに明確に合致しない候補は低スコアまたは除外してください。

出力フォーマット（純粋なJSON配列のみ。Markdownのコードブロックや説明文は絶対に付けないこと）:
[
  {
    "index": 0,
    "relevanceScore": 9,
    "contextSummary": "FinTech企業のCFO。仮想通貨決済の経験あり。条件にマッチ。"
  }
]

ルール:
- relevanceScore は 1〜10 (10が最も関連度が高い)
- contextSummary は日本語で1〜2文、なぜこの候補が条件に合うか簡潔に
- 条件に全く合致しない候補は除外してOK
- 純粋なJSON配列のみ出力すること`;

      const stage2Res = await callGeminiWithRetry({
        contents: [{ parts: [{ text: refinePrompt }] }],
        generationConfig: {
          maxOutputTokens: 4000,
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }, "Stage2");

      const stage2Data = await stage2Res.json();
      let refineText = (stage2Data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();

      refineText = refineText
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      const jsonMatch = refineText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const refined = JSON.parse(jsonMatch[0]);
        if (Array.isArray(refined) && refined.length > 0) {
          const refinedCandidates = refined
            .filter(r => typeof r.index === "number" && r.index >= 0 && r.index < candidates.length)
            .map(r => ({
              ...candidates[r.index],
              relevanceScore: r.relevanceScore || null,
              contextSummary: r.contextSummary || "",
            }));
          candidates = refinedCandidates;
        }
      }
    }

    // limit 件に制限
    candidates = candidates.slice(0, limit);

    console.log(`🎯 Intent X-Ray v6: "${finalQuery}" → raw ${rawTotal}件 → 精査後 ${candidates.length}件 [Search: Brave, LLM: Gemini]`);

    res.json({
      query: finalQuery,
      total: candidates.length,
      _rawTotal: rawTotal,
      candidates,
      _search: "brave",
      _llm: "gemini",
    });
  } catch (err) {
    console.error("Intent X-Ray v6 エラー:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /search/guess-domains — Gemini 2.5 Flash でドメイン推測
//   body: { candidates: [{ id, name, title, company, linkedinUrl, rawSnippet }] }
//   response: { domainMap: { [id]: "domain.com" } }
// ══════════════════════════════════════════════════════════════
app.post("/search/guess-domains", async (req, res) => {
  const geminiKey = CONFIG.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(503).json({ error: "GEMINI_API_KEY が未設定です。" });
  }

  const { candidates: candidateList } = req.body;
  if (!Array.isArray(candidateList) || candidateList.length === 0) {
    return res.status(400).json({ error: "candidates 配列が必要です" });
  }

  try {
    const lines = candidateList.map((c, i) =>
      `${i}. ${c.name} | ${c.title || "?"} | ${c.company || "?"} | LinkedIn: ${c.linkedinUrl || "?"} | title: ${(c.rawTitle || "").slice(0, 120)} | snippet: ${(c.rawSnippet || "").slice(0, 120)}`
    ).join("\n");

    const prompt = `以下のLinkedInプロフィールの人物について、**現在の所属企業のメールドメイン**を特定・推測してください。

【ドメイン特定のアプローチ】
1. 企業名が明確な場合 → 公式ドメインを回答（例: "Stripe" → "stripe.com"）
2. 企業名からドメインが推測できる場合 → 最も可能性の高いドメインを回答（例: "Dollar-biz" → "dollar-biz.com"）
3. スニペットやLinkedIn URLにヒントがある場合 → そこから推測
4. 全く手がかりがない場合のみ domain を空文字 "" にする

【現職の判定ルール】
- スニペットの最初に出てくる "役職 at 会社名" が現職
- "Experience:" "Previously:" "Former" "Past" "Ex-" の後に出てくる会社は過去職 → 無視
- 複数の会社が列挙されている場合、最初の1社が現職

${lines}

純粋なJSON配列のみ返してください（説明文やMarkdownは不要）:
[{"index":0,"domain":"dollar-biz.com","company":"Dollar-biz","confidence":"high"}]

ルール:
- 全候補について必ず回答を返すこと（空のまま飛ばさない）
- 有名企業 → 公式ドメインを正確に回答（confidence: "high"）
- 中小企業・スタートアップ → 企業名/サービス名からドメインを推測（confidence: "medium"）
- 手がかりが少ない場合も最善の推測をする（confidence: "low"）
- 本当に何も分からない場合のみ domain を "" にする
- gmail.com, yahoo.com 等の個人用ドメインは使わない`;

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

    const geminiRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("guess-domains Gemini error:", errText.slice(0, 300));
      return res.status(500).json({ error: `Gemini API ${geminiRes.status}`, domainMap: {} });
    }

    const geminiData = await geminiRes.json();
    let rawText = (geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    rawText = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    const rawDomainMap = {};
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const arr = JSON.parse(jsonMatch[0]);
      arr.forEach(item => {
        if (typeof item.index === "number" && item.domain && candidateList[item.index]) {
          rawDomainMap[candidateList[item.index].id] = item.domain;
        }
      });
    }

    // DNS 解決確認: 実在しないドメインを除外
    const domainMap = {};
    await Promise.all(
      Object.entries(rawDomainMap).map(async ([id, domain]) => {
        try {
          await dns.resolve(domain);
          domainMap[id] = domain;
        } catch {
          console.log(`⚠️ guess-domains: ${domain} はDNS未解決 → スキップ`);
        }
      })
    );

    console.log(`🌐 guess-domains: ${candidateList.length}件 → ${Object.keys(rawDomainMap).length}件推測 → ${Object.keys(domainMap).length}件DNS確認済`);
    res.json({ domainMap });
  } catch (err) {
    console.error("guess-domains エラー:", err.message);
    res.status(500).json({ error: err.message, domainMap: {} });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /email/guess-and-verify
//   body: { firstName, lastName, domain, candidateId? }
//   または { name, domain }  ← name を "FirstName LastName" 形式で渡してもよい
//
//   処理フロー:
//     1. generateEmailGuesses でパターン生成
//     2. EmailVerify.io で個別検証
//     3. valid なものを返す
// ══════════════════════════════════════════════════════════════
app.post("/email/guess-and-verify", async (req, res) => {
  let { firstName, lastName, domain, name, candidateId } = req.body;

  // "name" として姓名まとめて渡された場合は分割
  if (!firstName && name) {
    const parts = name.trim().split(/\s+/);
    firstName = parts[0] || "";
    lastName  = parts.slice(1).join(" ") || parts[0] || "";  // ★ 姓が取れない場合は名をフォールバック
  }

  // lastName が空の場合、name全体をlastNameとして扱う（単一名の場合など）
  if (firstName && !lastName && name) {
    lastName = name.trim().split(/\s+/).slice(-1)[0] || firstName;
  }

  if (!firstName || !domain) {
    return res.status(400).json({
      error: "firstName (または name) と domain が必要です",
    });
  }

  // ── 日本語名→ローマ字変換フォールバック ──
  // generateEmailGuesses は [^a-z] を除去するため、日本語名だとパターンが0件になる
  const hasAlpha = (s) => /[a-zA-Z]/.test(s);
  if (!hasAlpha(firstName) || !hasAlpha(lastName)) {
    const geminiKey = CONFIG.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const romanizePrompt = `以下の日本語の人名をローマ字（ヘボン式）に変換してください。
名前: ${firstName} ${lastName}

JSON のみ返してください（説明文不要）:
{"firstName":"taro","lastName":"yamada"}

ルール:
- ローマ字は小文字
- 姓と名を正しく判定する（日本語の場合、最初が姓の場合が多い）
- 入力が既にローマ字の場合はそのまま返す`;

        const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
        const gRes = await fetch(GEMINI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: romanizePrompt }] }],
            generationConfig: { maxOutputTokens: 200, temperature: 0.1, responseMimeType: "application/json" },
          }),
        });
        if (gRes.ok) {
          const gData = await gRes.json();
          let rawText = (gData.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
          rawText = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
          const objMatch = rawText.match(/\{[\s\S]*\}/);
          if (objMatch) {
            const parsed = JSON.parse(objMatch[0]);
            if (parsed.firstName && parsed.lastName) {
              console.log(`🔤 ローマ字変換: ${firstName} ${lastName} → ${parsed.firstName} ${parsed.lastName}`);
              firstName = parsed.firstName;
              lastName = parsed.lastName;
            }
          }
        }
      } catch (e) {
        console.warn("ローマ字変換失敗:", e.message);
      }
    }
  }

  // lastNameが依然空なら firstName を両方に使う（単名の場合: john@, john.john@は除外されるのでfirstnameのみパターンが出る）
  if (!lastName) lastName = firstName;

  const guesses = generateEmailGuesses(firstName, lastName, domain);
  if (guesses.length === 0) {
    // 最終フォールバック: firstName のみでパターン生成
    const fallbackGuesses = [`${firstName.toLowerCase().replace(/[^a-z]/g, "")}@${domain}`];
    if (fallbackGuesses[0].length > domain.length + 2) {
      return res.json({
        candidateId, guesses: fallbackGuesses, verifiedEmail: null,
        allResults: [{ email: fallbackGuesses[0], valid: false, status: "unverified", reason: "fallback_pattern" }],
        note: "名前からパターンを生成できませんでした。手動でメールアドレスを確認してください。",
      });
    }
    return res.status(400).json({ error: "メアドパターンを生成できませんでした。氏名とドメインを確認してください。" });
  }

  // SMTP プローブで検証
  const smtpResult = await smtpVerifyBatch(domain, guesses).catch(e => ({
    domain, provider: 'error', results: guesses.map(email => ({ email, status: 'unknown', reason: e.message }))
  }));

  const allResults = smtpResult.results.map(r => ({
    email:  r.email,
    valid:  r.status === 'valid',
    status: r.status,
    reason: r.reason || null,
    code:   r.code   || null,
  }));
  const provider = smtpResult.provider || 'unknown';
  const verifiedEmail = allResults.find(r => r.valid)?.email || null;

  // Google/Microsoft365 はSMTP検証不可 → 最有力パターンをbestGuessとして返す
  // パターン優先順: firstname.lastname@ → flastname@ → firstname@
  let bestGuess = null;
  if (!verifiedEmail && (provider === 'google' || provider === 'microsoft365')) {
    bestGuess = guesses[0] || null;
  }

  console.log(`📧 guess-and-verify: ${firstName} ${lastName} @ ${domain} [${provider}] → ${verifiedEmail || bestGuess || "not found"} (${allResults.length}パターン試行)`);

  res.json({
    candidateId,
    guesses,
    verifiedEmail,
    bestGuess,
    provider,
    allResults,
  });
});

// ══════════════════════════════════════════════
// LinkedIn 送信 (Unipile API)
// ══════════════════════════════════════════════

/**
 * LinkedIn 用文章を 300 文字以内に最適化する。
 * Claude を使って招待状本文を生成・短縮する。
 *   prompt はメール本文または任意の文章を受け取り、LinkedIn 招待状向けに
 *   300 文字（半角換算）以内で再生成する。
 */
async function generateLinkedInMessage({ name, company, title, body, settings }) {
  const businessProfile = `
Company: ${settings?.myCompany || "(unknown)"}
Service: ${settings?.myService || "(unknown)"}
Sender: ${settings?.myName || "(unknown)"}
LP: ${settings?.lpUrl || "(unknown)"}
  `.trim();

  const prompt = `You are a world-class B2B sales expert specializing in LinkedIn outreach.
Write a LinkedIn connection request message in ENGLISH based on the information below.

[Our Company]
${businessProfile}

[Recipient]
Name: ${name || "(unknown)"}
Title: ${title || "(unknown)"}
Company: ${company || "(unknown)"}

[Reference message (optional)]
${body || "(none)"}

[STRICT RULES]
- Write ENTIRELY IN ENGLISH — no Japanese, no mixed language
- MUST be under 300 characters (count every character including spaces and punctuation)
- Do NOT use placeholders like {{name}} — embed the actual name
- Lead with value, shared context, or genuine curiosity — NOT a pitch
- ONE soft CTA only (e.g. "Would love to connect.", "Happy to connect if relevant.")
- Reference our service naturally if it's relevant to their role — but do not oversell
- For Web3 / crypto / fintech / casino / OTC recipients: mention relevant cost savings (0.19% effective rate), compliance automation, or multi-chain support if appropriate
- Do NOT include the LP URL unless space allows and it adds value

Return ONLY the message body — no explanation, no markdown, no quotes:`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CONFIG.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
    const data = await resp.json();
    let msg = (data.content?.[0]?.text || "").trim();
    // Strip any leading/trailing quotes the model might add
    msg = msg.replace(/^["'`]+|["'`]+$/g, "").trim();
    // Enforce 300 char limit
    if (msg.length > 300) {
      msg = msg.slice(0, 297) + "...";
    }
    return msg;
  } catch (e) {
    console.error("LinkedIn message generation failed:", e.message);
    const fallback = (body || "").slice(0, 297);
    return fallback || `Hi ${name || "there"}, I came across your profile and thought our crypto payment platform might be relevant to your work at ${company || "your company"}. Would love to connect.`;
  }
}

/**
 * LinkedIn プロフィール URL から provider_id（リソースID）を取得する。
 * Unipile API を使って account の LinkedIn ユーザー情報を解決する。
 *
 * Unipile では /api/v1/users/{account_id}/invitations に送る際に
 * LinkedIn の public_identifier（例: "john-doe-123"）が使えるが、
 * 確実性のため URL パースで取り出す。
 */
function extractLinkedInId(profileUrl) {
  if (!profileUrl) return null;
  // https://www.linkedin.com/in/john-doe-123/ → john-doe-123
  const m = profileUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1].replace(/\/$/, "") : null;
}

/**
 * POST /linkedin/send
 *
 * body:
 *   {
 *     recipientId:    string,   // CRM ID（トラッキング紐付け用）
 *     name:           string,   // 送信先名前
 *     title:          string,
 *     company:        string,
 *     linkedinUrl:    string,   // LinkedIn プロフィール URL
 *     messageBody:    string,   // 参考本文（任意、超えれば自動最適化）
 *     campaignId:     string,   // トラッキング用（任意）
 *     variantId:      string,   // トラッキング用（任意）
 *     industry:       string,
 *     country:        string,
 *     settings:       object,   // buildBusinessProfile 用の自社情報
 *   }
 *
 * 処理:
 *   1. LinkedIn プロフィールURLから public_identifier を取得
 *   2. Claude で 300 文字以内の招待状メッセージを生成
 *   3. Unipile API でコネクションリクエスト＋メッセージ送信
 *   4. trackingStore に登録（email/sent と同様ロジック）
 *   5. クリック計測用 trackingId を返す
 */
app.post("/linkedin/send", async (req, res) => {
  const { recipientId, name, title, company, linkedinUrl, messageBody,
          campaignId, variantId, industry, country, settings: clientSettings } = req.body;

  if (!recipientId || !linkedinUrl) {
    return res.status(400).json({ error: "recipientId と linkedinUrl が必要です" });
  }

  const unipileKey = CONFIG.UNIPILE_API_KEY;
  const unipileAccountId = CONFIG.UNIPILE_ACCOUNT_ID;
  const unipileBaseUrl   = CONFIG.UNIPILE_URL;

  if (!unipileKey || !unipileAccountId) {
    return res.status(503).json({
      error: "UNIPILE_API_KEY または UNIPILE_ACCOUNT_ID が未設定です。Railway の環境変数に設定してください。",
      hint: "UNIPILE_URL は Unipile ダッシュボードの DSN（例: https://api1.unipile.com:13111）を使用してください。",
    });
  }

  try {
    // ── 1. LinkedIn public_identifier を URL から抽出 ──
    const publicIdentifier = extractLinkedInId(linkedinUrl);
    if (!publicIdentifier) {
      return res.status(400).json({ error: "有効な LinkedIn プロフィール URL を指定してください" });
    }

    // ── 2. Unipile でプロフィール取得 → provider_id を解決 ──
    // エラーページ(HTML)の場合にも対応するため content-type を確認する
    const profileRes = await fetch(
      `${unipileBaseUrl}/api/v1/users/${encodeURIComponent(publicIdentifier)}?account_id=${encodeURIComponent(unipileAccountId)}`,
      { headers: { "X-API-KEY": unipileKey, "Accept": "application/json" } }
    );
    if (!profileRes.ok) {
      const t = await profileRes.text();
      let b; try { b = JSON.parse(t); } catch { b = { error: t.slice(0, 200) }; }
      console.error(`Unipile プロフィール取得エラー ${profileRes.status}:`, b);
      return res.status(profileRes.status).json({
        error: `LinkedIn プロフィール取得失敗 (${profileRes.status}): ${b.title || b.error || "不明なエラー"}`,
        detail: b.detail || null,
      });
    }
    const profileData = await profileRes.json();
    const providerId = profileData.provider_id;
    if (!providerId) {
      console.error("Unipile プロフィールレスポンス:", profileData);
      return res.status(400).json({ error: "Unipile から provider_id を取得できませんでした。LinkedIn URLを確認してください。" });
    }
    console.log(`🔍 LinkedIn プロフィール解決: ${publicIdentifier} → provider_id: ${providerId}`);

    // ── 3. メッセージ生成（300文字以内に最適化） ──
    const mergedSettings = clientSettings || {};
    const optimizedMessage = await generateLinkedInMessage({
      name, company, title,
      body: messageBody,
      settings: mergedSettings,
    });

    // ── 4. トラッキング ID 生成 & tracking link を埋め込む ──
    const trackingId = uuidv4();
    const trackingUrl = `${CONFIG.TUNNEL_URL}/track/click/${trackingId}?redirect=${encodeURIComponent(mergedSettings.lpUrl || CONFIG.CLICK_REDIRECT_URL)}`;
    let finalMessage = optimizedMessage;
    const withLink = `${optimizedMessage}\n${trackingUrl}`;
    if (withLink.length <= 300) finalMessage = withLink;

    // ── 5. Unipile API でコネクションリクエスト送信 ──
    // エンドポイント: POST /api/v1/users/invite
    // provider_id は Unipile が返す "ACoAAA..." 形式の内部 ID
    const unipileRes = await fetch(
      `${unipileBaseUrl}/api/v1/users/invite`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": unipileKey,
        },
        body: JSON.stringify({
          account_id:  unipileAccountId,
          provider_id: providerId,   // ← Unipile が要求する内部 ID
          message:     finalMessage,
        }),
      }
    );

    if (!unipileRes.ok) {
      const errText = await unipileRes.text();
      let errBody;
      try { errBody = JSON.parse(errText); } catch { errBody = { error: errText.slice(0, 300) }; }
      console.error(`Unipile API エラー ${unipileRes.status}:`, errBody);
      return res.status(unipileRes.status).json({
        error: errBody.title || errBody.message || errBody.error || `Unipile API エラー: ${unipileRes.status}`,
        detail: errBody.detail || null,
      });
    }

    const unipileData = await unipileRes.json();

    // ── 5. trackingStore に登録（email/sent と同様ロジック） ──
    trackingStore[trackingId] = {
      recipientId,
      email:        null,        // LinkedIn リードはメール不要
      linkedinUrl,
      name:         name || "",
      campaignId:   campaignId || null,
      variantId:    variantId || null,
      subject:      "(LinkedIn招待状)",
      industry:     industry || "",
      country:      country || "",
      title:        title || "",
      channel:      "linkedin",  // ★ チャンネル識別子
      sentAt:       new Date().toISOString(),
      openedAt:     null, clickedAt: null,
      opens: 0, clicks: 0,
      pageViews: 0, scrolledPages: [], convertedAt: null, lastPagePath: null,
      sessions: 0, ga4Conversions: 0,
      planStatus: null, planScore: 0, planConvertedAt: null,
    };

    // variantId が指定されていれば variantToTracking に追加
    if (variantId) {
      variantToTracking[variantId] = variantToTracking[variantId] || [];
      variantToTracking[variantId].push(trackingId);
      if (campaignId && campaignStore[campaignId]) {
        const v = campaignStore[campaignId].variants.find(x => x.id === variantId);
        if (v) v.sentCount++;
      }
    }

    console.log(`🔗 LinkedIn 招待送信: ${name} (${linkedinId}) | trackingId: ${trackingId}`);

    res.json({
      ok:              true,
      trackingId,
      linkedinId,
      messageUsed:     finalMessage,
      messageLength:   finalMessage.length,
      unipileResponse: unipileData,
    });

  } catch (err) {
    console.error("LinkedIn 送信エラー:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /linkedin/status
 * LinkedIn 送信設定が有効かどうかを返す。
 * App.jsx のステータスバーから呼ばれる。
 */
app.get("/linkedin/status", (_req, res) => {
  const configured = !!(CONFIG.UNIPILE_API_KEY && CONFIG.UNIPILE_ACCOUNT_ID);
  res.json({
    configured,
    accountId: configured ? CONFIG.UNIPILE_ACCOUNT_ID : null,
    baseUrl:   configured ? CONFIG.UNIPILE_URL : null,
    hint: configured ? null : "Railway の環境変数に UNIPILE_API_KEY と UNIPILE_ACCOUNT_ID を設定してください。",
  });
});

// ══════════════════════════════════════════════════════════════
// POST /search/find-x-accounts-batch
//   body: { targets: [{ id, name, company, title }] }
//   response: { matches: [{ id, matchUrl }] }
//
//   処理フロー:
//     1. targets を5件ずつのチャンクに分割
//     2. 各チャンクをOR条件で Brave Search (site:x.com)
//     3. 結果スニペットを Gemini 2.5 Flash に渡して同一人物判定
//     4. 確証のあるものだけを返す（誤爆ゼロ優先）
// ══════════════════════════════════════════════════════════════
app.post("/search/find-x-accounts-batch", async (req, res) => {
  if (!BRAVE_API_KEY) {
    return res.status(503).json({ error: "BRAVE_API_KEY が未設定です。" });
  }
  const geminiKey = CONFIG.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(503).json({ error: "GEMINI_API_KEY が未設定です。" });
  }

  const { targets } = req.body;
  if (!Array.isArray(targets) || targets.length === 0) {
    return res.status(400).json({ error: "targets 配列が必要です" });
  }

  const CHUNK_SIZE = 5;
  const allMatches = [];

  try {
    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      const chunk = targets.slice(i, i + CHUNK_SIZE);

      // ── Stage 1: Brave Search でOR検索 ──
      const namesPart = chunk.map(t => `"${t.name}"`).join(" OR ");
      const query = `site:x.com (${namesPart})`;
      const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=15`;

      console.log(`🎯 X特定バッチ [${i}..${i + chunk.length - 1}]: ${query}`);

      let searchResults = [];
      try {
        const braveRes = await fetch(braveUrl, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": BRAVE_API_KEY,
          },
        });
        if (braveRes.ok) {
          const braveData = await braveRes.json();
          searchResults = (braveData.web?.results || []).map(r => ({
            title: r.title || "",
            url:   r.url   || "",
            snippet: r.description || "",
          }));
        } else {
          console.warn(`Brave API ${braveRes.status}:`, await braveRes.text().then(t => t.slice(0, 200)));
        }
      } catch (braveErr) {
        console.warn("Brave 検索エラー:", braveErr.message);
      }

      if (searchResults.length === 0) continue;

      // ── Stage 2: Gemini で同一人物判定 ──
      const targetLines = chunk.map(t =>
        `- id="${t.id}" 名前="${t.name}" 会社="${t.company || "?"}" 役職="${t.title || "?"}"`
      ).join("\n");

      const resultLines = searchResults.map((r, idx) =>
        `[${idx}] URL: ${r.url}\nタイトル: ${r.title}\nスニペット: ${r.snippet}`
      ).join("\n\n");

      const prompt = `以下の【ターゲットリスト】と【X（Twitter）の検索結果スニペット】を比較してください。
検索結果のプロフィール文（スニペット）に会社名や役職が含まれており、確実にターゲットと同一人物だと断定できるXアカウントのURLのみをマッピングしてください。
確証がない別人のアカウントは絶対に含めないでください。
純粋なJSONで以下の形式の配列のみを返してください（Markdown不要）:
[{ "id": "ターゲットのid", "matchUrl": "https://x.com/..." }]

【ターゲットリスト】
${targetLines}

【X（Twitter）の検索結果スニペット】
${resultLines}`;

      const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

      try {
        const geminiRes = await fetch(GEMINI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 512,
              temperature: 0.1,
              responseMimeType: "application/json",
            },
          }),
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          let rawText = (geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
          rawText = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
          const jsonMatch = rawText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
              parsed.forEach(item => {
                if (item.id && item.matchUrl && item.matchUrl.includes("x.com")) {
                  allMatches.push({ id: item.id, matchUrl: item.matchUrl });
                }
              });
            }
          }
        } else {
          console.warn(`Gemini API ${geminiRes.status} (find-x-accounts-batch chunk ${i})`);
        }
      } catch (geminiErr) {
        console.warn("Gemini 判定エラー:", geminiErr.message);
      }

      // Brave API レート制限対策（チャンク間に少し待機）
      if (i + CHUNK_SIZE < targets.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    console.log(`🎯 X特定完了: ${targets.length}件 → ${allMatches.length}件マッチ`);
    res.json({ matches: allMatches });
  } catch (err) {
    console.error("find-x-accounts-batch エラー:", err.message);
    res.status(500).json({ error: err.message, matches: allMatches });
  }
});

// ══════════════════════════════════════════════
const PORT = process.env.PORT || 3001;
(async () => {
  // Node 18+ はグローバル fetch が組み込み済み。
  // それ以前の環境や node-fetch が必要な場合のみ動的 import。
  if (typeof fetch === "undefined") {
    try {
      fetch = (await import("node-fetch")).default;
      console.log("✓ node-fetch をロードしました");
    } catch (e) {
      console.error("⚠️ node-fetch のロードに失敗しました。Node 18+ のグローバル fetch を使用します。", e.message);
      // Node 18+ ならグローバルの fetch がそのまま使われる
    }
  }

  app.listen(PORT, async () => {
    console.log(`Sales Automation バックエンド v2 起動: http://localhost:${PORT}`);
    console.log(`モード: 多次元実験 + 学習ループ + 不達対策`);
    try { await setupGA4(); } catch (e) { console.error("GA4 初期化エラー:", e.message); }
    setTimeout(async () => {
      try {
        await syncGA4ToTrackingStore();
        setInterval(syncGA4ToTrackingStore, 15 * 60 * 1000);
      } catch (e) { console.error("GA4 sync エラー:", e.message); }
    }, 30 * 1000);
  });
})().catch(e => {
  console.error("🔴 サーバー起動エラー:", e.message);
  process.exit(1);
});