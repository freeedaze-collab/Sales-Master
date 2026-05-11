import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ====================================================================
// タブ構成（PDCA高速回転用に刷新）
//   設定 → 企業検索 → リスト管理 → メール送信 → A/Bテスト → CRM → PDCA
// ====================================================================
const TABS = ["設定", "企業検索", "リスト管理", "メール送信", "A/Bテスト", "CRM", "PDCA", "配信健康度"];

const INDUSTRIES = [
  "SaaS / ソフトウェア", "製造業", "小売 / EC", "金融 / FinTech",
  "医療 / ヘルスケア", "不動産", "教育", "広告 / マーケティング",
  "物流 / 運輸", "コンサルティング",
  // ★ dollar-biz 主力ターゲット業界
  "Web3 / 暗号資産", "オンラインカジノ / ゲーミング", "OTC / 取引所",
];

const COUNTRIES = [
  "日本", "アメリカ", "イギリス", "ドイツ", "フランス",
  "シンガポール", "オーストラリア", "カナダ", "韓国", "インド"
];

const COMPANY_SIZES = ["1-10名", "11-50名", "51-200名", "201-500名", "501-1000名", "1000名以上"];

const TITLE_GROUPS = {
  "経営幹部": ["CEO", "Co-Founder", "Founder", "President", "Owner", "Managing Director", "Executive Director", "Chairman", "Principal"],
  "CxO": ["CTO", "CMO", "COO", "CFO", "CPO", "CRO", "CISO", "CDO", "CLO", "CSO"],
  "VP / 上級管理職": ["VP of Sales", "VP of Marketing", "VP of Engineering", "VP of Product", "VP of Operations", "VP of Finance", "VP of Business Development", "SVP", "EVP", "General Manager"],
  "ディレクター": ["Director of Sales", "Director of Marketing", "Director of Engineering", "Director of Product", "Director of Operations", "Director of HR", "Director of Finance", "Director of Business Development", "Director of Strategy"],
  "マネージャー": ["Sales Manager", "Marketing Manager", "Product Manager", "Engineering Manager", "Account Manager", "Project Manager", "Operations Manager", "HR Manager", "Finance Manager"],
  "ヘッド": ["Head of Sales", "Head of Marketing", "Head of Engineering", "Head of Product", "Head of Operations", "Head of Growth", "Head of Design", "Head of Data", "Head of HR"],
  "IT / エンジニア": ["CTO", "VP of Engineering", "Engineering Manager", "Software Engineer", "DevOps Engineer", "Data Engineer", "Security Engineer", "IT Director", "IT Manager"],
  "セールス": ["Sales Director", "Sales Manager", "Account Executive", "Business Development Manager", "Sales Representative", "Inside Sales", "Enterprise Sales", "Sales Operations"],
  "マーケティング": ["Marketing Director", "Marketing Manager", "Growth Manager", "Demand Generation", "Brand Manager", "Content Manager", "Digital Marketing Manager", "SEO Manager"],
  "人事 / 採用": ["HR Director", "HR Manager", "Talent Acquisition", "Recruiter", "People Operations", "Chief People Officer", "Head of HR"],
  "財務": ["CFO", "Finance Director", "Finance Manager", "Controller", "Treasurer", "Head of Finance", "FP&A Manager"],
};

const STATUS_OPTIONS = [
  "未送信", "送信済み", "開封済み", "返信あり", "商談中",
  "Sandbox",  // 無料登録ユーザー(入口CV)
  "Professional", "Corporate", "Enterprise", "Lifetime",
  "クローズ", "見込みなし",
  "LinkedIn送信待ち", // LinkedIn アプローチ用
  // ── CSVインポート用ステータス ──
  "unverified",  // CSV取込直後・未検証
  "ready",       // 検証済み・送信待ち
  "invalid",     // 検証で無効判定
];

const FILTER_OPTIONS = [
  { label: "すべて",              type: "all" },
  { label: "未送信",              type: "status", value: "未送信" },
  { label: "送信済み",            type: "status", value: "送信済み" },
  { label: "開封済み",            type: "status", value: "開封済み" },
  { label: "返信あり",            type: "status", value: "返信あり" },
  { label: "商談中",              type: "status", value: "商談中" },
  { label: "Sandbox(無料登録)",   type: "status", value: "Sandbox" },
  { label: "Professional",        type: "status", value: "Professional" },
  { label: "Corporate",           type: "status", value: "Corporate" },
  { label: "Enterprise",          type: "status", value: "Enterprise" },
  { label: "Lifetime",            type: "status", value: "Lifetime" },
  { label: "クローズ",            type: "status", value: "クローズ" },
  { label: "見込みなし",          type: "status", value: "見込みなし" },
  { label: "🔗 リンククリック済み",   type: "flag", field: "clicked" },
  { label: "📩 複数回開封",           type: "flag", field: "multiOpen" },
  { label: "🌐 サイト訪問あり",       type: "ga",   gaField: "sessions",      gaMin: 1 },
  { label: "📄 複数ページ閲覧",       type: "ga",   gaField: "pageViews",     gaMin: 2 },
  { label: "📜 スクロール済み",       type: "ga",   gaField: "scrolledUsers", gaMin: 1 },
  { label: "🎯 CV済み",              type: "ga",   gaField: "conversions",   gaMin: 1 },
  { label: "💰 プラン契約あり",       type: "plan" },
  { label: "💼 LinkedIn送信待ち",     type: "status", value: "LinkedIn送信待ち" },
  { label: "🔬 未検証",                  type: "status", value: "unverified" },
  { label: "✅ 送信待ち(検証済)",         type: "status", value: "ready" },
  { label: "❌ 無効メール",               type: "status", value: "invalid" },
];

// Sandbox は「無料登録したが未課金」の状態。CV入口だが、有料転換が本当のゴール
const SCORE_WEIGHTS = {
  "未送信": 0, "送信済み": 0, "開封済み": 5,
  "クリック": 15, "返信あり": 20, "商談中": 40,
  "Sandbox": 50,  // 無料登録は明確なリード
  "Professional": 100, "Corporate": 200, "Enterprise": 400,
  "Lifetime": 800,  // 買い切り最上位
  "クローズ": 800, "見込みなし": 0,
  "LinkedIn送信待ち": 0,
  "unverified": 0, "ready": 0, "invalid": 0,
};

const STATUS_COLORS = {
  "未送信":       { bg: "#E6F1FB", color: "#0C447C" },
  "送信済み":     { bg: "#EAF3DE", color: "#27500A" },
  "開封済み":     { bg: "#FAEEDA", color: "#633806" },
  "返信あり":     { bg: "#EEEDFE", color: "#3C3489" },
  "商談中":       { bg: "#FAC775", color: "#412402" },
  "Sandbox":      { bg: "#F0E6FB", color: "#4B1A7C" },  // Sandboxは紫系で目立たせる
  "Professional": { bg: "#D6EAF8", color: "#1A5276" },
  "Corporate":    { bg: "#D5F5E3", color: "#1E8449" },
  "Enterprise":   { bg: "#FDEDEC", color: "#922B21" },
  "Lifetime":     { bg: "#F9E79F", color: "#6B5E07" },  // 金色系
  "クローズ":     { bg: "#9FE1CB", color: "#085041" },
  "見込みなし":   { bg: "#F1EFE8", color: "#444441" },
  "LinkedIn送信待ち": { bg: "#E8F4FD", color: "#0A66C2" },  // LinkedIn ブランドカラー系
  "unverified": { bg: "#F5F0FF", color: "#6B21A8" },  // 未検証
  "ready":      { bg: "#DCFCE7", color: "#166534" },  // 検証済み・送信待ち
  "invalid":    { bg: "#FEE2E2", color: "#991B1B" },  // 無効
};

// プラン設定 — dollar-biz.com の実プランに対応
//   Sandbox($0): 無料登録, $50K取引上限, 1 user, Pre-seed/integration testing向け
//   Professional($1,980): $500K取引上限, 3 users, Seed〜early-stage Web3向け, 実効手数料0.39%
//   Corporate($9,800): $5M取引上限, 10 users, Series A/B・中規模向け, 実効手数料0.19%
//   Enterprise($29,800): 無制限, 無制限ユーザー, カジノ/OTC/大企業向け
//   "クローズ" は Enterprise 以上の大型契約や特殊契約用の汎用スコア
const PLAN_CONFIG = {
  "Sandbox":      { score: 10,   label: "Sandbox $0/mo",
                    volumeLimit: "$50,000",  teamSize: "1 user",
                    bestFor: "Pre-seed startups & integration testing",
                    effectiveRate: "—",
                    cta: "Try for Free" },
  "Professional": { score: 100,  label: "Professional $1,980/mo",
                    volumeLimit: "$500,000", teamSize: "Up to 3 users (Admin, Accountant)",
                    bestFor: "Seed to early-stage Web3 companies, small agencies",
                    effectiveRate: "0.39% (vs 1.5% + $0.25/tx on legacy)",
                    cta: "Start Free Trial" },
  "Corporate":    { score: 200,  label: "Corporate $9,800/mo",
                    volumeLimit: "$5,000,000", teamSize: "Up to 10 users (CFO, Tax Officer, Auditor)",
                    bestFor: "Series A/B companies, mid-size platforms",
                    effectiveRate: "0.19% (vs 1.0% + $0.25/tx on legacy)",
                    cta: "Contact Sales" },
  "Enterprise":   { score: 400,  label: "Enterprise $29,800/mo",
                    volumeLimit: "Unlimited", teamSize: "Unlimited users (Department & subsidiary-level permissions)",
                    bestFor: "Online casinos, OTC desks, enterprises",
                    effectiveRate: "—",
                    cta: "Contact Sales" },
  "Lifetime":     { score: 800,  label: "Lifetime $980,000 (買い切り)",
                    volumeLimit: "Unlimited (永続)", teamSize: "Unlimited",
                    bestFor: "長期的に大量取引を行う企業。一度の支払いで今後無制限利用",
                    effectiveRate: "—",
                    cta: "Contact Sales" },
  "クローズ":     { score: 1000, label: "その他大型/特殊契約",
                    volumeLimit: "—", teamSize: "—",
                    bestFor: "Lifetime超えの特殊案件・パートナー契約",
                    effectiveRate: "—",
                    cta: "—" },
};

// CV導線(dollar-biz の実際のフロー)
const DEFAULT_CV_FLOW = [
  { step: 1, name: "メール開封",        description: "件名フックで注意喚起" },
  { step: 2, name: "メール内リンクCL",  description: "LPへの誘導(https://dollar-biz.com/)" },
  { step: 3, name: "LP閲覧",           description: "ヒーロー→機能紹介→料金テーブル→FAQ" },
  { step: 4, name: "無料登録(Sandbox)", description: "$50Kまで無料利用可能。入口CV" },
  { step: 5, name: "商談(任意)",       description: "全プラン任意。Corporate/Enterprise検討者に多い" },
  { step: 6, name: "有料プラン契約",    description: "Professional以上、クレジット決済" },
];

const AI_COPY_CATEGORIES = [
  {
    key: "cold", label: "新規コールド", desc: "未送信・送信済みのみ",
    filter: (c) => ["未送信", "送信済み"].includes(c.status),
    strategy: "第一印象が命。押し付けず「価値提示」に集中。件名は好奇心を刺激する問いかけ形式。",
    color: { bg: "#E6F1FB", color: "#0C447C" },
  },
  {
    key: "opened", label: "開封済み・検討中", desc: "開封したが未返信",
    filter: (c) => c.status === "開封済み" || (c.opens || 0) >= 1,
    strategy: "興味は確認済み。具体的な事例・数字で信頼を積む。CTA は低摩擦に（資料を見る、デモを申し込む）。",
    color: { bg: "#FAEEDA", color: "#633806" },
  },
  {
    key: "engaged", label: "高エンゲージメント", desc: "クリック・複数訪問あり",
    filter: (c) => c.clicked || (c.gaData?.sessions || 0) >= 2 || (c.opens || 0) >= 2,
    strategy: "複数回訪問・クリック済み。購買意欲は高い段階。限定性・希少性・比較優位を訴求し背中を押す。",
    color: { bg: "#EEEDFE", color: "#3C3489" },
  },
  {
    key: "sandbox", label: "Sandbox登録者(無料→有料転換候補)", desc: "無料登録済み・未課金",
    filter: (c) => c.status === "Sandbox",
    strategy: "最重要セグメント。無料で実際に触っている=製品価値を体験済み。ここから有料(Professional以上)への転換がCVゴール。使用実績の振り返り+上位プランで解除される制約(取引量・ユーザー数・手数料)を数値で訴求。『いま$50K上限に近づいていませんか?』のような使用ベースの呼びかけが効く。",
    color: { bg: "#F0E6FB", color: "#4B1A7C" },
  },
  {
    key: "replied", label: "返信・商談中", desc: "返信あり・商談中",
    filter: (c) => ["返信あり", "商談中"].includes(c.status),
    strategy: "関係構築済み。提案の具体化・次のアクション設定にフォーカス。件名はパーソナル感を最大化。",
    color: { bg: "#EAF3DE", color: "#27500A" },
  },
  {
    key: "cv", label: "CV済み・検討継続", desc: "サイトCVまたはプラン閲覧済み",
    filter: (c) => (c.gaData?.conversions || 0) >= 1 || !!c.gaData?.planStatus,
    strategy: "購買意図が明確。上位プランへの誘導・導入支援の提案。「次のステップ」を具体的に提示。",
    color: { bg: "#E1F5EE", color: "#085041" },
  },
  {
    key: "plan", label: "契約済み顧客", desc: "プラン契約済み",
    filter: (c) => ["Professional", "Corporate", "Enterprise", "クローズ"].includes(c.status),
    strategy: "アップセル・クロスセル機会。成果の共有・上位プランへの価値提案。感謝と実績から入る。",
    color: { bg: "#D5F5E3", color: "#1E8449" },
  },
  {
    key: "churn", label: "休眠・再エンゲージ", desc: "長期間反応なし",
    filter: (c) => c.status === "見込みなし" || (c.status === "送信済み" && !c.opens),
    strategy: "長期間反応なし。インセンティブ（割引・新機能）または感情訴求（何かお力になれましたか？）で再燃。",
    color: { bg: "#F1EFE8", color: "#444441" },
  },
];

const EMAIL_GROUPS = [
  { label: "すべて（メールあり）",   filter: c => !!c.email },
  { label: "未送信のみ",             filter: c => !!c.email && c.status === "未送信" },
  { label: "開封済み",               filter: c => !!c.email && ["開封済み","返信あり","商談中"].includes(c.status) },
  { label: "🆓 Sandbox登録者(有料転換候補)", filter: c => !!c.email && c.status === "Sandbox" },
  { label: "CV済み",                 filter: c => !!c.email && (c.gaData?.conversions >= 1) },
  { label: "サイト訪問あり",         filter: c => !!c.email && (c.gaData?.sessions >= 1) },
  { label: "スコア 15pt 以上",       filter: c => !!c.email && calcScore(c) >= 15 },
  { label: "スコア 40pt 以上",       filter: c => !!c.email && calcScore(c) >= 40 },
  { label: "返信あり・商談中",       filter: c => !!c.email && ["返信あり","商談中"].includes(c.status) },
  { label: "プラン契約済み",         filter: c => !!c.email && !!c.gaData?.planStatus },
  { label: "見込みなし",             filter: c => !!c.email && c.status === "見込みなし" },
  { label: "SaaS / ソフトウェア",    filter: c => !!c.email && c.industry === "SaaS / ソフトウェア" },
  { label: "製造業",                 filter: c => !!c.email && c.industry === "製造業" },
  { label: "金融 / FinTech",         filter: c => !!c.email && c.industry === "金融 / FinTech" },
  { label: "医療 / ヘルスケア",      filter: c => !!c.email && c.industry === "医療 / ヘルスケア" },
  { label: "複数回開封",             filter: c => !!c.email && (c.opens || 0) >= 2 },
  { label: "リンククリック済み",     filter: c => !!c.email && !!c.clicked },
];

// LinkedIn 送信グループ
const LINKEDIN_GROUPS = [
  // メアド未取得 OR LinkedIn送信待ち → LinkedInでフォローアップすべき全員
  {
    label: "📭 メアドなし／LinkedIn送信待ち",
    filter: c => c.status === "LinkedIn送信待ち" || (!c.email && c.status !== "送信済み" && c.status !== "クローズ" && c.status !== "見込みなし"),
  },
  // LinkedIn URL が確定しているリード
  { label: "💼 LinkedIn URL あり",           filter: c => !!(c.linkedin || c.linkedinUrl) },
  // 送信済み（LinkedIn経由）
  { label: "✅ 送信済み（LinkedIn経由）",   filter: c => c.status === "送信済み" && !!(c.linkedin || c.linkedinUrl) && !c.email },
  // クリック反応あり
  { label: "🔗 反応あり",                   filter: c => !!(c.linkedin || c.linkedinUrl) && !!c.clicked },
];

const RAILWAY = "http://178.104.65.99:3000";
const LOCAL_SEND = "http://localhost:3002";

// ────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────

// 学習重みはモジュールスコープに保持。サーバーから fetch して上書き。
let LEARNED_WEIGHTS = { industry: {}, title: {}, country: {} };
let LEARNED_WEIGHTS_UPDATED_AT = null;

// 役職の正規化(サーバー側と同じルール)
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

// Lifecycle phase 推定
//   prospect   : リスト化されただけ(未送信)
//   cold       : 送信済みだが未反応
//   warm       : メール開封
//   engaged    : クリック・LP複数訪問
//   sandbox    : 無料登録(dollar-biz 固有の重要フェーズ)
//   replied    : メール返信あり
//   negotiating: 商談中
//   customer   : 有料プラン契約済み
//   churned    : 見込みなし
function inferPhase(person) {
  const s = person.status;
  if (["Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(s)) return "customer";
  if (s === "Sandbox") return "sandbox"; // 無料登録は有料転換の最有力候補
  if (s === "商談中") return "negotiating";
  if (s === "返信あり") return "replied";
  if (person.clicked || (person.gaData?.sessions || 0) >= 2 || (person.gaData?.pageViews || 0) >= 2) return "engaged";
  if (s === "開封済み" || (person.opens || 0) >= 1) return "warm";
  if (s === "見込みなし") return "churned";
  if (s !== "未送信") return "cold";
  return "prospect";
}

// セグメントキー: 業界×役職グループ×フェーズ
function segmentKeyOf(person) {
  return `${person.industry || "?"}×${normalizeTitle(person.title) || "?"}×${inferPhase(person)}`;
}

// 基本スコア(既存互換)
function calcBaseScore(person) {
  const base = (SCORE_WEIGHTS[person.status] || 0) + (person.clicked ? SCORE_WEIGHTS["クリック"] : 0);
  const planScore = person.gaData?.planScore || 0;
  const planStatusScore = PLAN_CONFIG[person.status] ? PLAN_CONFIG[person.status].score : 0;
  return base + Math.max(planScore, planStatusScore);
}

// 学習重みを乗算した総合スコア
function calcScore(person) {
  const base = calcBaseScore(person);
  if (!LEARNED_WEIGHTS) return base;
  const indW = LEARNED_WEIGHTS.industry?.[person.industry] || 1;
  const titleW = LEARNED_WEIGHTS.title?.[normalizeTitle(person.title)] || 1;
  const ctryW = LEARNED_WEIGHTS.country?.[person.country] || 1;
  // 三軸の相乗(ただし影響を抑えるためベース0の時は乗算しない)
  if (base === 0) return 0;
  return Math.round(base * indW * titleW * ctryW);
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }

// ────────────────────────────────────────────────────────────
// UI primitives
// ────────────────────────────────────────────────────────────
function Avatar({ name, size = 36 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "#EEEDFE", color: "#3C3489",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 500, flexShrink: 0 }}>
      {initials(name)}
    </div>
  );
}

function Badge({ status }) {
  const s = STATUS_COLORS[status] || { bg: "#F1EFE8", color: "#444441" };
  return <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 100, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>{status}</span>;
}

function ScoreBadge({ score }) {
  const color = score >= 100 ? "#922B21" : score >= 40 ? "#1E8449" : score >= 15 ? "#633806" : "#444441";
  const bg    = score >= 100 ? "#FDEDEC" : score >= 40 ? "#D5F5E3" : score >= 15 ? "#FAEEDA" : "#F1EFE8";
  return <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 100, background: bg, color, whiteSpace: "nowrap" }}>{score}pt</span>;
}

function CvBadge() {
  return <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 100, background: "#FFF3CD", color: "#6B5E07" }}>🎯 CV</span>;
}

function PlanBadge({ planStatus, planScore }) {
  const cfg = PLAN_CONFIG[planStatus] || null;
  if (!cfg) return null;
  const col = STATUS_COLORS[planStatus] || { bg: "#F1EFE8", color: "#444441" };
  return <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 100, background: col.bg, color: col.color, whiteSpace: "nowrap" }}>💰 {planStatus} {planScore}pt</span>;
}

function Card({ children, style }) {
  return <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "0.875rem 1rem", ...style }}>{children}</div>;
}

function Section({ title, right, children }) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 0.5rem" }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// 全AI機能で共通のビジネスプロファイル構築
//   - settings からサービス情報 / プラン詳細 / CVフロー / 訴求制約を読み、
//     Claudeに渡すテキストブロックとして組み立てる
// ════════════════════════════════════════════════════════════
function buildBusinessProfile(settings) {
  const planDetails = settings.planDetails || {};
  const cvFlow = settings.cvFlow || DEFAULT_CV_FLOW;

  const planLines = ["Sandbox", "Professional", "Corporate", "Enterprise", "Lifetime"].map(name => {
    const cfg = PLAN_CONFIG[name] || {};
    const detail = planDetails[name] || "";
    return `■ ${name} (${cfg.label || name})
  Volume limit: ${cfg.volumeLimit || "—"} / Team: ${cfg.teamSize || "—"} / CTA: "${cfg.cta || "—"}"
  Best for: ${cfg.bestFor || "—"}${cfg.effectiveRate && cfg.effectiveRate !== "—" ? `\n  Effective rate: ${cfg.effectiveRate}` : ""}${detail ? `\n  Additional notes: ${detail}` : ""}`;
  }).join("\n\n");

  const cvLines = cvFlow.map(s => `Step ${s.step}: ${s.name}${s.description ? ` — ${s.description}` : ""}`).join("\n");

  // ★ サービス固有のターゲティングヒントを常に注入
  const serviceHints = `
[Service-specific targeting context]
- Primary targets: Web3/crypto companies, online casinos, OTC desks, B2B payment processors handling crypto/stablecoins
- Key pain point we solve: Legacy payment processors charge 1.5%+$0.25/tx; we reduce effective rate to 0.19%
- Additional value: Automated tax reporting, multi-chain stablecoin support, compliance tools
- Ideal prospect signals: CFO/Finance/Payment role at crypto-native or crypto-adjacent companies
- Upgrade trigger for Sandbox users: approaching $50K monthly volume limit
- Upgrade trigger for Professional: team growth beyond 3 users OR approaching $500K volume`;

  return `[Our Company Profile]
Company: ${settings.myCompany || "(not set)"}
Service overview:
${settings.myService || "(not set)"}

LP URL: ${settings.lpUrl || "(not set)"}
Sender: ${settings.myName || "(not set)"}

[Plan Details]
${planLines}

[Conversion Funnel]
${cvLines}

${serviceHints}

${settings.keywordsInclude ? `[Keywords to emphasize]\n${settings.keywordsInclude}\n` : ""}${settings.keywordsExclude ? `[Forbidden expressions]\n${settings.keywordsExclude}\n` : ""}`;
}

function useGA4Tracking() {
  const trackingId = useRef(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const campaign = params.get("utm_campaign");
    if (campaign) trackingId.current = campaign;
  }, []);
  const sendPageView = useCallback(async (pagePath, pageTitle) => {
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "page_view", { page_path: pagePath, page_title: pageTitle });
    }
    if (!trackingId.current) return;
    try {
      await fetch(`${RAILWAY}/track/page-view`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingId: trackingId.current, pagePath, pageTitle }),
      });
    } catch (e) { console.warn("page_view 送信失敗:", e); }
  }, []);
  const sendScroll = useCallback(async (pagePath) => {
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "scroll", { percent_scrolled: 90, page_path: pagePath });
    }
    if (!trackingId.current) return;
    try {
      await fetch(`${RAILWAY}/track/scroll`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingId: trackingId.current, pagePath, percentScrolled: 90 }),
      });
    } catch (e) { console.warn("scroll 送信失敗:", e); }
  }, []);
  return { sendPageView, sendScroll, trackingId };
}

// ────────────────────────────────────────────────────────────
// Claude API ヘルパ（ストリーミング対応）
//   - ブラウザから Anthropic API は CORS でブロックされるので Railway 経由
//   - APIキーは Railway 側の環境変数 ANTHROPIC_API_KEY で保持
// ────────────────────────────────────────────────────────────
async function callClaude({ prompt, maxTokens = 1500, stream = false }) {
  const resp = await fetch(`${RAILWAY}/claude/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      stream,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || e.error || `HTTP ${resp.status}`); }
  if (!stream) {
    const data = await resp.json();
    return data.content?.[0]?.text || "";
  }
  // stream
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const p = JSON.parse(data);
        if (p.type === "content_block_delta" && p.delta?.text) full += p.delta.text;
      } catch {}
    }
  }
  return full;
}

// ════════════════════════════════════════════════════════════
// Tab: 設定
// ════════════════════════════════════════════════════════════
function SettingsTab({ settings, setSettings, onSaveToDb, dbStatus }) {
  const [saved, setSaved] = useState(false);
  const handle = (k, v) => setSettings(s => ({ ...s, [k]: v }));
  const save = async () => { setSaved(true); await onSaveToDb(); setTimeout(() => setSaved(false), 2000); };

  const envVars = [
    { label: "VITE_APOLLO_KEY",    value: import.meta.env.VITE_APOLLO_KEY },
    { label: "VITE_FROM_EMAIL",    value: import.meta.env.VITE_FROM_EMAIL },
    { label: "VITE_GMAIL_PASS",    value: import.meta.env.VITE_GMAIL_PASS },
    { label: "VITE_SUPABASE_URL",  value: import.meta.env.VITE_SUPABASE_URL },
    { label: "VITE_SUPABASE_KEY",  value: import.meta.env.VITE_SUPABASE_KEY },
  ];

  return (
    <div style={{ maxWidth: 560 }}>
      <Section title=".env 読み込み状況">
        <Card>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-secondary)" }}>
            プロジェクトルートの <code style={{ fontSize: 12, background: "var(--color-background-secondary)", padding: "2px 6px", borderRadius: 4 }}>.env</code> から自動で読み込まれます
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {envVars.map(({ label, value }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                <code style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{label}</code>
                <span style={{ fontSize: 12, color: value ? "var(--color-text-success)" : "var(--color-text-danger)", fontWeight: 500 }}>
                  {value ? "✓ 設定済み" : "✗ 未設定"}
                </span>
              </div>
            ))}
          </div>
          {dbStatus && (
            <p style={{ margin: "12px 0 0", fontSize: 12, color: dbStatus.ok ? "var(--color-text-success)" : "var(--color-text-danger)" }}>
              {dbStatus.ok ? "✓ Supabase 接続済み" : "✗ " + dbStatus.msg}
            </p>
          )}
        </Card>
      </Section>

      <Section title="自社情報">
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>会社名</label>
            <input placeholder="株式会社〇〇" value={settings.myCompany || ""} onChange={e => handle("myCompany", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />

            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
              サービス概要
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400, marginLeft: 6 }}>
                ※ 全AI機能がこの内容を参照します。1文目は「誰に・何を・どう解決するか」がおすすめ。
              </span>
            </label>
            <textarea
              placeholder={`例: all-in-one crypto and stablecoin payment platform with automated accounting and tax reporting.\n主なターゲット: Web3企業、オンラインカジノ、OTCデスク、暗号資産を扱うB2B決済事業者。\n差別化: 既存決済(1.5%+$0.25/tx)に対し、最大で実効0.19%まで削減。税務レポート自動化で経理工数を大幅削減。`}
              rows={6} value={settings.myService || ""} onChange={e => handle("myService", e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", fontSize: 14, padding: "8px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8 }} />

            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>担当者名</label>
            <input placeholder="山田 太郎" value={settings.myName || ""} onChange={e => handle("myName", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />

            <label style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
              LP URL
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400, marginLeft: 6 }}>
                ※ メール内リンクの既定遷移先
              </span>
            </label>
            <input placeholder="https://dollar-biz.com/" value={settings.lpUrl || ""} onChange={e => handle("lpUrl", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
        </Card>
      </Section>

      <Section title="プラン詳細(AIプロンプトに注入されます)">
        <Card>
          <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "0 0 10px", lineHeight: 1.6 }}>
            各プランの特徴を書いてください。PDCA分析、AI訴求生成、メール自動生成すべてがこの情報を参照し、プラン別に訴求軸を切り替えます。<br />
            <strong>空欄のままにすると既定値(dollar-biz.comの実プラン情報)が使われます。</strong>
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { key: "Sandbox",      placeholder: "$0/mo. Transaction Volume: Up to $50,000 USD. Team: 1 user (Admin only). Best For: Pre-seed startups & integration testing. CTA: Try for Free." },
              { key: "Professional", placeholder: "$1,980/mo. Transaction Volume: Up to $500,000 USD. Team: Up to 3 users (Admin, Accountant roles). Best For: Seed to early-stage Web3 companies, small agencies. Effective Rate: 0.39% (vs 1.5% + $0.25/tx on legacy processors). CTA: Start Free Trial." },
              { key: "Corporate",    placeholder: "$9,800/mo. Transaction Volume: Up to $5,000,000 USD. Team: Up to 10 users (CFO, Tax Officer, Auditor roles). Best For: Series A/B companies, mid-size platforms. Effective Rate: 0.19% (vs 1.0% + $0.25/tx on legacy processors). CTA: Contact Sales." },
              { key: "Enterprise",   placeholder: "$29,800/mo. Transaction Volume: Unlimited. Team: Unlimited users (Department & subsidiary-level permissions). Best For: Online casinos, OTC desks, enterprises. CTA: Contact Sales." },
              { key: "Lifetime",     placeholder: "$980,000 one-time payment. All features, unlimited volume, unlimited users, forever. Best For: High-volume enterprises seeking long-term cost certainty. CTA: Contact Sales." },
            ].map(({ key, placeholder }) => {
              const cfg = PLAN_CONFIG[key];
              const col = STATUS_COLORS[key] || { bg: "#F1EFE8", color: "#444441" };
              return (
                <div key={key}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 100, background: col.bg, color: col.color }}>{key}</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{cfg?.label}</span>
                  </div>
                  <textarea
                    placeholder={placeholder}
                    rows={3}
                    value={(settings.planDetails || {})[key] || ""}
                    onChange={e => handle("planDetails", { ...(settings.planDetails || {}), [key]: e.target.value })}
                    style={{ width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", fontSize: 12, padding: "6px 8px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6 }}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      </Section>

      <Section title="CV導線(AIがフェーズ別に最適化するために使います)">
        <Card>
          <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "0 0 10px", lineHeight: 1.6 }}>
            顧客が契約に至るまでのステップを記述。各ステップの目標・よくあるつまずき・次のアクションを書くと、AIがフェーズ別に適切な訴求を選択できます。
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(settings.cvFlow || DEFAULT_CV_FLOW).map((step, i) => (
              <div key={i} style={{ padding: 10, borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 100, background: "#EEEDFE", color: "#3C3489" }}>Step {step.step}</span>
                  <input
                    value={step.name}
                    onChange={e => {
                      const flow = [...(settings.cvFlow || DEFAULT_CV_FLOW)];
                      flow[i] = { ...step, name: e.target.value };
                      handle("cvFlow", flow);
                    }}
                    style={{ flex: 1, fontSize: 13, padding: "3px 8px", fontWeight: 500 }}
                  />
                </div>
                <textarea
                  value={step.description}
                  onChange={e => {
                    const flow = [...(settings.cvFlow || DEFAULT_CV_FLOW)];
                    flow[i] = { ...step, description: e.target.value };
                    handle("cvFlow", flow);
                  }}
                  rows={2}
                  placeholder="このステップの目標・よくあるつまずき・次のアクション"
                  style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "5px 8px", resize: "vertical", fontFamily: "inherit", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6 }}
                />
              </div>
            ))}
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => {
                const flow = [...(settings.cvFlow || DEFAULT_CV_FLOW)];
                flow.push({ step: flow.length + 1, name: "新しいステップ", description: "" });
                handle("cvFlow", flow);
              }} style={{ fontSize: 11, padding: "4px 10px" }}>+ ステップ追加</button>
              {settings.cvFlow && settings.cvFlow.length > 0 && (
                <button onClick={() => handle("cvFlow", null)} style={{ fontSize: 11, padding: "4px 10px", color: "var(--color-text-secondary)" }}>既定値に戻す</button>
              )}
            </div>
          </div>
        </Card>
      </Section>

      <Section title="訴求の制約(任意)">
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                強調したいキーワード
                <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginLeft: 6 }}>カンマ区切り</span>
              </label>
              <input
                placeholder="例: 0.19% effective rate, automated tax reporting, multi-chain, stablecoin"
                value={settings.keywordsInclude || ""}
                onChange={e => handle("keywordsInclude", e.target.value)}
                style={{ width: "100%", marginTop: 4, boxSizing: "border-box", fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                使ってはいけない表現
                <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginLeft: 6 }}>カンマ区切り</span>
              </label>
              <input
                placeholder="例: guaranteed profit, 100% safe, 投資勧誘に該当する表現"
                value={settings.keywordsExclude || ""}
                onChange={e => handle("keywordsExclude", e.target.value)}
                style={{ width: "100%", marginTop: 4, boxSizing: "border-box", fontSize: 12 }}
              />
            </div>
          </div>
        </Card>
      </Section>

      <Section title="送信プロバイダ（参考）">
        <Card>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 6px" }}>
            大量送信時の参考。<code>server_local.js</code> 側の環境変数で切替:
          </p>
          <pre style={{ fontSize: 11, margin: 0, background: "var(--color-background-secondary)", padding: "8px 10px", borderRadius: 6, overflow: "auto" }}>
{`# Gmail (既定、~2,000通/日/アカウント)
MAIL_PROVIDER=smtp  FROM_EMAIL=...  GMAIL_PASS=...

# SendGrid (有料プランで 100,000通/日~)
MAIL_PROVIDER=sendgrid  SENDGRID_API_KEY=...  FROM_EMAIL=...

# 日次上限の明示
DAILY_LIMIT=1800`}
          </pre>
        </Card>
      </Section>

      <button onClick={save} style={{ background: saved ? "var(--color-background-success)" : undefined }}>{saved ? "✓ 保存しました" : "自社情報を保存（DBに同期）"}</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// AIターゲティング提案（SearchTab 内で使用）
//   直近の送信結果から、どの属性がハイパフォーマンスかを抽出
// ════════════════════════════════════════════════════════════
function TargetingSuggestion({ settings, crm, onApply }) {
  const sent = crm.filter(c => c.status !== "未送信");
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [error, setError] = useState("");

  // 業界・役職・国・規模別にKPIを出す
  const analyze = (key) => {
    const buckets = {};
    sent.forEach(c => {
      const k = c[key] || "不明";
      if (!buckets[k]) buckets[k] = { count: 0, opened: 0, clicked: 0, replied: 0, converted: 0, planScore: 0 };
      buckets[k].count++;
      const s = c.status;
      if (["開封済み","返信あり","商談中","Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(s)) buckets[k].opened++;
      if (c.clicked) buckets[k].clicked++;
      if (["返信あり","商談中","Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(s)) buckets[k].replied++;
      if (["Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(s)) buckets[k].converted++;
      buckets[k].planScore += calcScore(c);
    });
    return Object.entries(buckets)
      .filter(([_, v]) => v.count >= 3) // 統計ノイズ避け
      .map(([k, v]) => ({
        key: k, ...v,
        openRate: pct(v.opened, v.count),
        replyRate: pct(v.replied, v.count),
        cvRate: pct(v.converted, v.count),
        avgScore: Math.round(v.planScore / v.count),
      }))
      .sort((a, b) => b.avgScore - a.avgScore);
  };

  const runAI = async () => {
    if (sent.length < 10) { setError("送信済みデータが10件未満のため統計が不十分です。データを積んでから再試行してください。"); return; }
    setLoading(true); setError(""); setSuggestion(null);
    const industry = analyze("industry").slice(0, 5);
    const title    = analyze("title").slice(0, 5);
    const country  = analyze("country").slice(0, 5);

    const prompt = `You are a B2B sales targeting strategist. Based on the business profile and historical send data below, identify the best attribute combination to search for next on Apollo.io.

${buildBusinessProfile(settings)}

[Historical send performance by attribute (min 3 records)]
By industry: ${JSON.stringify(industry)}
By title: ${JSON.stringify(title)}
By country: ${JSON.stringify(country)}

[Decision criteria]
- Highest priority: alignment with our service's ideal customer profile (Web3/crypto companies, online casinos, OTC desks, fintech)
- Match recommended targets per plan (Sandbox=Pre-seed, Professional=Seed~early-stage Web3, Corporate=Series A/B, Enterprise=online casino/OTC)
- Even low-volume segments can be recommended if they align well with the service profile

Return ONLY this JSON (no other text):
{
  "facts": ["fact1", "fact2", "fact3"],
  "hypothesis": ["hypothesis1: reason", "hypothesis2: reason"],
  "nextAction": {
    "recommendedIndustry": "best industry from INDUSTRIES list, or null",
    "recommendedTitles": ["title1", "title2", "title3"],
    "recommendedCountry": "best country",
    "reasoning": "1-2 sentences explaining this recommendation and its alignment with our service profile"
  }
}

[Available options]
Industries: ${JSON.stringify(INDUSTRIES)}
Countries: ${JSON.stringify(COUNTRIES)}`;

    try {
      const text = await callClaude({ prompt, maxTokens: 800 });
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("JSONの抽出に失敗しました");
      const parsed = JSON.parse(jsonMatch[0]);
      setSuggestion(parsed);
    } catch (e) { setError("AI分析失敗: " + e.message); }
    setLoading(false);
  };

  return (
    <Card style={{ marginBottom: "1rem", background: "#F7F9FC", border: "0.5px dashed var(--color-border-secondary)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>🎯 AIターゲティング提案</p>
        <button onClick={runAI} disabled={loading || sent.length < 10} style={{ fontSize: 12, padding: "5px 12px" }}>
          {loading ? "分析中..." : sent.length < 10 ? `データ不足 (${sent.length}/10)` : "実績から提案"}
        </button>
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: 0 }}>
        送信済み {sent.length} 件の実績を分析し、最も勝率の高い検索条件を自動提案します。
      </p>

      {error && <p style={{ fontSize: 12, color: "var(--color-text-danger)", marginTop: 8 }}>{error}</p>}

      {suggestion && (
        <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.7 }}>
          <ThinkingBlock label="事実" color="#185FA5" items={suggestion.facts} />
          <ThinkingBlock label="仮説" color="#3C3489" items={suggestion.hypothesis} />
          <div style={{ padding: "8px 12px", borderLeft: "2px solid #1D9E75", marginBottom: 6, borderRadius: "0 6px 6px 0", background: "#F0FAF5" }}>
            <strong style={{ fontSize: 11, color: "#1D9E75" }}>ネクストアクション</strong>
            <p style={{ margin: "4px 0 8px", fontSize: 12 }}>{suggestion.nextAction?.reasoning}</p>
            <div style={{ fontSize: 12, color: "#444" }}>
              推奨業界: <strong>{suggestion.nextAction?.recommendedIndustry || "なし"}</strong> / 推奨国: <strong>{suggestion.nextAction?.recommendedCountry || "なし"}</strong><br />
              推奨役職: {(suggestion.nextAction?.recommendedTitles || []).join(", ")}
            </div>
            <button onClick={() => onApply(suggestion.nextAction)}
              style={{ marginTop: 8, fontSize: 12, padding: "6px 14px", background: "#1D9E75", color: "#fff", border: "none", borderRadius: 6 }}>
              この条件を検索フォームに反映 →
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ThinkingBlock({ label, color, items }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ padding: "8px 12px", borderLeft: `2px solid ${color}`, marginBottom: 6, borderRadius: "0 6px 6px 0", background: "var(--color-background-secondary)" }}>
      <strong style={{ fontSize: 11, color }}>{label}</strong>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12 }}>
        {items.map((t, i) => <li key={i} style={{ marginBottom: 2 }}>{t}</li>)}
      </ul>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab: 企業検索（Apollo検索 + EmailVerify.io スタンドアロン検証）
//
// フロー:
//   Step 1: Apollo で検索 → メールありの候補一覧（従来通り）
//   Step 2: ユーザーが候補を選択
//   Step 3: EmailVerify.io で選択メールを検証
//   Step 4: valid のもののみ CRM に追加
//
// ★ このコンポーネントで元の SearchTab を丸ごと差し替えてください
// ════════════════════════════════════════════════════════════
function SearchTab({ settings, crm, setCrm, prefill }) {
  const [country, setCountry] = useState("日本");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [keyword, setKeyword] = useState("");
  const [titleInput, setTitleInput] = useState("CEO, CTO");
  const [openGroup, setOpenGroup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [added, setAdded] = useState({});
  const [perPage, setPerPage] = useState(10);

  // ★ EmailVerify.io 検証用 state
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [selectedForVerify, setSelectedForVerify] = useState(new Set());
  const [evCredits, setEvCredits] = useState(null);

  // 起動時に EmailVerify.io 残高を取得
  useEffect(() => {
    fetch(`${RAILWAY}/email/verify-emailverify/credits`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setEvCredits(d); })
      .catch(() => {});
  }, []);

  // PDCAタブから retarget アクションが流れてきた場合
  useEffect(() => {
    if (prefill?.suggestedTargeting) {
      const st = prefill.suggestedTargeting;
      if (st.industry) setIndustry(st.industry);
      if (st.country)  setCountry(st.country);
      if (st.titles?.length) setTitleInput(st.titles.join(", "));
    }
  }, [prefill?.suggestedTargeting]);

  const parsedTitles = titleInput.split(",").map(t => t.trim()).filter(Boolean);

  const addTitle = (t) => {
    const current = titleInput.split(",").map(s => s.trim()).filter(Boolean);
    if (current.map(s => s.toLowerCase()).includes(t.toLowerCase())) return;
    setTitleInput(current.length ? current.join(", ") + ", " + t : t);
  };

  const COUNTRY_MAP = {
    "日本": "Japan", "アメリカ": "United States", "イギリス": "United Kingdom",
    "ドイツ": "Germany", "フランス": "France", "シンガポール": "Singapore",
    "オーストラリア": "Australia", "カナダ": "Canada", "韓国": "South Korea", "インド": "India"
  };
  const INDUSTRY_MAP = {
    "SaaS / ソフトウェア": "SaaS Software", "製造業": "Manufacturing", "小売 / EC": "Retail E-commerce",
    "金融 / FinTech": "Financial Services FinTech", "医療 / ヘルスケア": "Healthcare",
    "不動産": "Real Estate", "教育": "Education", "広告 / マーケティング": "Advertising Marketing",
    "物流 / 運輸": "Logistics Transportation", "コンサルティング": "Consulting",
    // ★ Web3 / 暗号資産関連
    "Web3 / 暗号資産": "web3 crypto blockchain cryptocurrency DeFi stablecoin",
    "オンラインカジノ / ゲーミング": "online casino gaming iGaming gambling",
    "OTC / 取引所": "OTC desk crypto exchange trading",
  };

  const applyAISuggestion = (next) => {
    if (next?.recommendedIndustry) setIndustry(next.recommendedIndustry);
    if (next?.recommendedCountry)  setCountry(next.recommendedCountry);
    if (next?.recommendedTitles?.length) setTitleInput(next.recommendedTitles.join(", "));
  };

  // ── Step 1: Apollo 検索（従来通り） ──
  const search = async () => {
    setError(""); setLoading(true); setResults([]);
    setVerifyResult(null); setSelectedForVerify(new Set()); setAdded({});
    try {
      const countryEn  = COUNTRY_MAP[country]  || country;
      const industryEn = INDUSTRY_MAP[industry] || industry;
      const body = { person_titles: parsedTitles, organization_locations: [countryEn], per_page: perPage };
      // ★ キーワードは q_keywords（全文検索）。q_organization_domains はドメイン名専用のため誤用しない
      if (keyword)     body.q_keywords = industryEn ? `${industryEn} ${keyword}` : keyword;
      else if (industryEn) body.q_keywords = industryEn;
      if (size) {
        const sizeMap = { "1-10名": [1, 10], "11-50名": [11, 50], "51-200名": [51, 200], "201-500名": [201, 500], "501-1000名": [501, 1000], "1000名以上": [1001, 100000] };
        const [min, max] = sizeMap[size] || [];
        if (min) body.organization_num_employees_ranges = [`${min},${max}`];
      }
      const res = await fetch(`${RAILWAY}/apollo/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Apollo API エラー: ${res.status}`);
      const data = await res.json();
      const people = (data.people || []).map(p => ({
        id: p.id, name: p.name || "不明", title: p.title || "", email: p.email || "",
        linkedin:    p.linkedin_url || "",
        linkedinUrl: p.linkedin_url || "",  // 両フィールドを統一
        company: p.organization?.name || "",
        industry: industry || "指定なし", country: p.country || country,
        status: "未送信", notes: "", clicked: false, opens: 0, sentAt: null,
        subject: "", messageBody: "", trackingId: null, gaData: null,
        _verifyStatus: null,
      }));
      setResults(people);
      if (people.length === 0) setError("結果が見つかりませんでした。条件を変更してお試しください。");
    } catch (e) { setError(e.message || "検索中にエラーが発生しました"); }
    setLoading(false);
  };

  // ── Step 2-3: EmailVerify.io で検証 → valid のみ CRM 追加 ──
  const verifyAndAdd = async (emailsToVerify) => {
    if (emailsToVerify.length === 0) return;
    setVerifying(true);
    setVerifyResult(null);
    setError("");
    try {
      const res = await fetch(`${RAILWAY}/email/verify-emailverify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: emailsToVerify.map(p => p.email) }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `API エラー: ${res.status}`);
      }
      const data = await res.json();

      // 結果をマッピング
      const resultMap = {};
      for (const r of data.results) {
        resultMap[r.email.toLowerCase()] = r;
      }

      // results の _verifyStatus を更新
      setResults(prev => prev.map(p => {
        const vr = resultMap[p.email.toLowerCase()];
        if (vr) return { ...p, _verifyStatus: vr.valid ? "valid" : vr.status };
        return p;
      }));

      // valid のもののみ CRM に追加
      let addedCount = 0;
      for (const p of emailsToVerify) {
        const vr = resultMap[p.email.toLowerCase()];
        if (!vr || !vr.valid) {
          setAdded(a => ({ ...a, [p.id]: vr ? `✗ ${vr.reason}` : "✗ error" }));
          continue;
        }
        if (crm.find(c => c.id === p.id)) {
          setAdded(a => ({ ...a, [p.id]: "既存" }));
          continue;
        }
        setCrm(prev => [...prev, {
          ...p, _verifyStatus: "valid",
          addedAt: new Date().toISOString(),
        }]);
        setAdded(a => ({ ...a, [p.id]: "✓ valid" }));
        addedCount++;
      }

      setVerifyResult({ ...data.stats, addedToCrm: addedCount });

      // 残高を再取得
      fetch(`${RAILWAY}/email/verify-emailverify/credits`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setEvCredits(d); })
        .catch(() => {});

    } catch (e) {
      setError("メール検証失敗: " + e.message);
    }
    setVerifying(false);
  };

  // 選択トグル
  const toggleSelect = (id) => {
    setSelectedForVerify(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllWithEmail = () => {
    setSelectedForVerify(new Set(results.filter(p => p.email && !added[p.id]).map(p => p.id)));
  };
  const clearSelection = () => setSelectedForVerify(new Set());

  const verifySelected = () => {
    const selected = results.filter(p => selectedForVerify.has(p.id) && p.email);
    verifyAndAdd(selected);
  };
  const verifyAll = () => {
    const eligible = results.filter(p => p.email && !added[p.id]);
    verifyAndAdd(eligible);
  };

  // 従来の「検証なし追加」（EmailVerify.io 未設定時のフォールバック）
  const addWithoutVerify = (person) => {
    if (crm.find(c => c.id === person.id)) { setAdded(a => ({ ...a, [person.id]: "既存" })); return; }
    const liUrl = person.linkedinUrl || person.linkedin || "";
    setCrm(prev => [...prev, {
      ...person,
      linkedin:    liUrl,
      linkedinUrl: liUrl,
      addedAt: new Date().toISOString(),
    }]);
    setAdded(a => ({ ...a, [person.id]: "追加済" }));
  };

  const evAvailable = evCredits !== null && evCredits.api_status !== "disabled";

  return (
    <div>
      <TargetingSuggestion settings={settings} crm={crm} onApply={applyAISuggestion} />

      {/* ★ EmailVerify.io ステータスバー */}
      <Card style={{ marginBottom: "1rem", padding: "0.625rem 1rem",
        background: evAvailable ? "#F0FAF5" : "#FEF9E7",
        border: `0.5px solid ${evAvailable ? "#1D9E75" : "#D4AC0D"}`,
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>{evAvailable ? "🛡️" : "⚠️"}</span>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: evAvailable ? "#085041" : "#7D6608" }}>
              {evAvailable ? "EmailVerify.io 接続済み" : "EmailVerify.io 未設定"}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>
              {evAvailable
                ? `残りクレジット: ${evCredits.remaining_credits} / 日次上限: ${evCredits.daily_credits_limit}`
                : "EMAILVERIFY_API_KEY を Railway に設定すると、Apollo 検索後にメール検証が使えます"}
            </p>
          </div>
        </div>
        {evAvailable && (
          <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: "#D5F5E3", color: "#1E8449", fontWeight: 500 }}>
            {evCredits.remaining_credits} credits
          </span>
        )}
      </Card>

      <Section title="検索条件">
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>国</label>
              <select value={country} onChange={e => setCountry(e.target.value)} style={{ width: "100%", marginTop: 4 }}>{COUNTRIES.map(c => <option key={c}>{c}</option>)}</select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>業界</label>
              <select value={industry} onChange={e => setIndustry(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                <option value="">指定なし</option>
                {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>企業規模</label>
              <select value={size} onChange={e => setSize(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                <option value="">指定なし</option>
                {COMPANY_SIZES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>取得件数</label>
              <select value={perPage} onChange={e => setPerPage(Number(e.target.value))} style={{ width: "100%", marginTop: 4 }}>
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}件</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>キーワード（任意）</label>
              <input placeholder="例: fintech, AI, SaaS" value={keyword} onChange={e => setKeyword(e.target.value)} style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>ターゲット役職（カンマ区切り）</label>
              <button onClick={() => setTitleInput("")} style={{ fontSize: 11, padding: "2px 8px", color: "var(--color-text-secondary)" }}>クリア</button>
            </div>
            <input value={titleInput} onChange={e => setTitleInput(e.target.value)} placeholder="例: CEO, VP of Sales, Marketing Manager" style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 8 }}>クイック選択 · 現在 {parsedTitles.length} 件</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(TITLE_GROUPS).map(([group, titles]) => (
                <div key={group} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
                  <button onClick={() => setOpenGroup(openGroup === group ? null : group)}
                    style={{ width: "100%", textAlign: "left", padding: "7px 12px", fontSize: 12, fontWeight: 500, background: openGroup === group ? "var(--color-background-secondary)" : "transparent", border: "none", borderRadius: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{group}</span>
                    <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{openGroup === group ? "▲" : "▼"}</span>
                  </button>
                  {openGroup === group && (
                    <div style={{ padding: "8px 12px", display: "flex", flexWrap: "wrap", gap: 6, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                      {titles.map(t => {
                        const active = parsedTitles.map(s => s.toLowerCase()).includes(t.toLowerCase());
                        return <button key={t} onClick={() => addTitle(t)} style={{ fontSize: 11, padding: "3px 9px", background: active ? "var(--color-background-info)" : undefined, color: active ? "var(--color-text-info)" : undefined, border: active ? "0.5px solid var(--color-border-info)" : undefined }}>{t}</button>;
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {error && <p style={{ color: "var(--color-text-danger)", fontSize: 13, marginTop: 12 }}>{error}</p>}
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button onClick={search} disabled={loading}>{loading ? "検索中..." : "Apollo.io で検索"}</button>
          </div>
        </Card>
      </Section>

      {/* ★ 検証結果サマリー */}
      {verifyResult && (
        <Card style={{ marginBottom: 12, background: "#F0FAF5", borderLeft: "3px solid #1D9E75" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#085041" }}>🛡️ EmailVerify.io 検証完了</p>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            検証対象: <strong>{verifyResult.total}</strong>件 →
            valid: <strong style={{ color: "#1D9E75" }}>{verifyResult.valid}</strong> /
            invalid: <strong style={{ color: "#922B21" }}>{verifyResult.invalid}</strong>
            {verifyResult.skipped > 0 && <> / skipped: {verifyResult.skipped}</>}
            {verifyResult.byStatus && Object.keys(verifyResult.byStatus).length > 0 && (
              <> — 内訳: {Object.entries(verifyResult.byStatus).map(([k, v]) => `${k}:${v}`).join(", ")}</>
            )}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#085041" }}>
            <strong>{verifyResult.addedToCrm}件</strong>をCRMリストに追加 · 消費クレジット: <strong>{verifyResult.creditsUsed}</strong>
          </p>
        </Card>
      )}

      {results.length > 0 && (
        <Section title={`検索結果 (${results.length}件)`}
          right={
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {evAvailable && (
                <>
                  <button onClick={selectAllWithEmail} style={{ fontSize: 11, padding: "4px 10px" }}>全選択</button>
                  <button onClick={clearSelection} style={{ fontSize: 11, padding: "4px 10px" }}>解除</button>
                  {selectedForVerify.size > 0 && (
                    <button onClick={verifySelected} disabled={verifying}
                      style={{ fontSize: 12, padding: "5px 14px", background: "#1D9E75", color: "#fff", border: "none", borderRadius: 8, fontWeight: 500 }}>
                      {verifying ? "検証中..." : `🛡️ ${selectedForVerify.size}件を検証 & 追加`}
                    </button>
                  )}
                  <button onClick={verifyAll} disabled={verifying}
                    style={{ fontSize: 12, padding: "5px 12px", background: "#185FA5", color: "#fff", border: "none", borderRadius: 8 }}>
                    {verifying ? "検証中..." : "全件検証 & 追加"}
                  </button>
                </>
              )}
              {!evAvailable && (
                <button onClick={() => {
                  results.forEach(p => { if (p.email && !crm.find(c => c.id === p.id)) addWithoutVerify(p); });
                }} style={{ fontSize: 12, padding: "5px 12px" }}>
                  全件リストに追加（検証なし）
                </button>
              )}
            </div>
          }>

          {/* フロー説明 */}
          {evAvailable && (
            <Card style={{ marginBottom: 10, background: "#F7F9FC", border: "0.5px dashed var(--color-border-secondary)" }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                🛡️ <strong>EmailVerify.io 二重チェックモード</strong>:
                Apollo の検索結果（Apollo 側で verified フィルター済み）に対し、
                EmailVerify.io でスタンドアロン検証を実行します。
                <strong style={{ color: "#1D9E75" }}>valid（配信可能）と判定されたメールのみ</strong>がCRMリストに追加されます。
                invalid / disposable / spamtrap / catch-all 等は自動除外されます。
              </p>
            </Card>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.map(p => {
              const addedStatus = added[p.id];
              const isVerified = addedStatus === "✓ valid";
              const isFailed = addedStatus && addedStatus.startsWith("✗");
              const isSelected = selectedForVerify.has(p.id);
              const vs = p._verifyStatus;

              return (
                <Card key={p.id} style={{
                  border: isVerified ? "1px solid #1D9E75"
                    : isFailed ? "1px solid #E24B4A"
                    : isSelected ? "1px solid var(--color-border-info)"
                    : undefined,
                  background: isVerified ? "#F0FAF5"
                    : isFailed ? "#FEF2F2"
                    : isSelected ? "#F0F5FF"
                    : undefined,
                  opacity: isFailed ? 0.65 : 1,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {/* チェックボックス */}
                      {evAvailable && !addedStatus && p.email && (
                        <input type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(p.id)}
                          style={{ cursor: "pointer", flexShrink: 0 }}
                        />
                      )}
                      <Avatar name={p.name} />
                      <div>
                        <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{p.name}</p>
                        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{p.title} · {p.company}</p>
                        <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                          {p.email && (
                            <span style={{ fontSize: 11, color: "var(--color-text-info)" }}>{p.email}</span>
                          )}
                          {!p.email && (
                            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>📧 メールなし</span>
                          )}
                          {p.linkedin && <a href={p.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>LinkedIn</a>}
                          {/* ★ 検証ステータスバッジ */}
                          {vs === "valid" && (
                            <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 100, background: "#D5F5E3", color: "#1E8449" }}>🛡️ valid</span>
                          )}
                          {vs && vs !== "valid" && (
                            <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 100, background: "#FDEDEC", color: "#922B21" }}>✗ {vs}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, display: "flex", gap: 6, alignItems: "center" }}>
                      {addedStatus && (
                        <span style={{
                          fontSize: 12, padding: "5px 12px", borderRadius: 8, fontWeight: 500,
                          background: isVerified ? "#D5F5E3" : isFailed ? "#FDEDEC" : "#F1EFE8",
                          color: isVerified ? "#1E8449" : isFailed ? "#922B21" : "var(--color-text-secondary)",
                        }}>
                          {addedStatus}
                        </span>
                      )}
                      {!addedStatus && !evAvailable && p.email && (
                        <button onClick={() => addWithoutVerify(p)} style={{ fontSize: 12, padding: "6px 12px", flexShrink: 0 }}>
                          + リストに追加
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

/**
 * App.jsx パッチ — SearchTab をインテントベース検索に拡張
 *
 * 変更箇所:
 *   1. SearchTab コンポーネントを下記の IntentSearchTab に差し替える
 *      （既存 Apollo 検索 UI はトグルで残す）
 *   2. App の tab===1 のレンダリング部分を <IntentSearchTab ...> に変える
 *
 * 使い方:
 *   App.jsx の既存 SearchTab 定義を丸ごと下記 IntentSearchTab で置き換えてください。
 *   その後 App() の中の
 *     {tab === 1 && <SearchTab ... />}
 *   を
 *     {tab === 1 && <IntentSearchTab settings={settings} crm={crm} setCrm={setCrmWithSync} prefill={searchPrefill} />}
 *   に変更してください。
 *
 * 依存:
 *   - callClaude          (既存)
 *   - RAILWAY             (既存定数)
 *   - Avatar, Badge, Card, Section (既存UI部品)
 *   - calcScore, STATUS_OPTIONS   (既存ヘルパ)
 *   - TargetingSuggestion (既存コンポーネント — Apollo用なので非表示にする)
 */

// ════════════════════════════════════════════════════════════
// IntentSearchTab v2 — 意図＋コンテキストベース検索
//   - モード切替: "intent" (新) / "apollo" (既存)
//   - intent モード:
//       Step 1: intentQuery + targetingContext をサーバーに送信
//       Step 2: サーバー側で Claude がクエリ生成 → Serper 検索 → Claude が精査
//       Step 3: 各候補に「メアド推測」ボタン → /email/guess-and-verify
//       Step 4: valid メアドのある候補を CRM 登録(sourceIntent/sourceContext付き)
// ════════════════════════════════════════════════════════════
function IntentSearchTab({ settings, crm, setCrm, prefill }) {
  // ── モード ──
  const [mode, setMode] = React.useState("intent"); // "intent" | "apollo" | "scraper"

  // ── アプローチ手法 ──
  const [approachMode, setApproachMode] = React.useState("email"); // "email" | "linkedin"

  // ── Intent モード state ──
  const [intentQuery, setIntentQuery] = React.useState("");
  const [targetingContext, setTargetingContext] = React.useState("");
  const [limit, setLimit] = React.useState(10);
  const [intentLoading, setIntentLoading] = React.useState(false);
  const [generatedQuery, setGeneratedQuery] = React.useState("");
  const [candidates, setCandidates] = React.useState([]);
  const [intentError, setIntentError] = React.useState("");
  const [searchMeta, setSearchMeta] = React.useState(null);

  // ── Apolloスクレイパーモード state ──
  const [scraperQuery, setScraperQuery]           = React.useState({ titles: "", industries: "", countries: "", keywords: "", maxPages: 5 });
  const [scraperSent, setScraperSent]             = React.useState(false);
  const [scraperSending, setScraperSending]       = React.useState(false);
  const [scraperPolling, setScraperPolling]       = React.useState(false);
  const [scraperResult, setScraperResult]         = React.useState(null);
  const [autoCleanAfter, setAutoCleanAfter]       = React.useState(true);
  const [autoCleanRunning, setAutoCleanRunning]   = React.useState(false);
  const [autoCleanProgress, setAutoCleanProgress] = React.useState(null);
  const [apifyRunId, setApifyRunId]               = React.useState(null);
  const [apifyStatus, setApifyStatus]             = React.useState(null); // RUNNING/SUCCEEDED/FAILED
  const scraperPollingRef = React.useRef(null);

  // メアド推測 state
  const [guessState, setGuessState] = React.useState({});
  const [domainOverride, setDomainOverride] = React.useState({});
  const [added, setAdded] = React.useState({});
  const [serperOk, setSerperOk] = React.useState(null);

  // 一括CRM追加
  const [bulkAdding, setBulkAdding] = React.useState(false);

  React.useEffect(() => {
    fetch(`${RAILWAY}/health`)
      .then(r => r.json())
      .then(() => setSerperOk(true))
      .catch(() => setSerperOk(false));
  }, []);

  // ── Apify Actor を起動 ──
  const sendScraperQuery = async () => {
    setScraperSending(true);
    setScraperSent(false);
    setScraperResult(null);
    setApifyRunId(null);
    setApifyStatus(null);

    try {
      const res = await fetch(`${RAILWAY}/apify/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titles:     scraperQuery.titles.split(/[,、\n]/).map(s => s.trim()).filter(Boolean),
          industries: scraperQuery.industries.split(/[,、\n]/).map(s => s.trim()).filter(Boolean),
          countries:  scraperQuery.countries.split(/[,、\n]/).map(s => s.trim()).filter(Boolean),
          keywords:   scraperQuery.keywords.trim(),
          maxPages:   Number(scraperQuery.maxPages) || 5,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setApifyRunId(data.runId);
      setApifyStatus("RUNNING");
      setScraperSent(true);

      // Apify Runのステータスを15秒ごとにポーリング
      startApifyPolling(data.runId);

    } catch (err) {
      alert("Apify起動エラー: " + err.message);
    } finally {
      setScraperSending(false);
    }
  };

  // ── Apify Run ステータスポーリング ──
  const startApifyPolling = (runId) => {
    if (scraperPollingRef.current) clearInterval(scraperPollingRef.current);
    setScraperPolling(true);

    scraperPollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${RAILWAY}/apify/status/${runId}`);
        if (!res.ok) return;
        const data = await res.json();
        setApifyStatus(data.status);

        if (data.status === "SUCCEEDED") {
          // 完了 → Webhookが自動でインポートするので少し待ってCRMをリロード
          clearInterval(scraperPollingRef.current);
          scraperPollingRef.current = null;
          setScraperPolling(false);
          setScraperResult({ itemCount: data.itemCount });

          // 自動クリーニング
          if (autoCleanAfter) {
            await new Promise(r => setTimeout(r, 3000)); // Webhook処理を待つ
            triggerAutoClean();
          }
        } else if (data.status === "FAILED" || data.status === "ABORTED") {
          clearInterval(scraperPollingRef.current);
          scraperPollingRef.current = null;
          setScraperPolling(false);
          setApifyStatus("FAILED");
        }
      } catch {}
    }, 15000);
  };

  const stopScraperPolling = () => {
    if (scraperPollingRef.current) { clearInterval(scraperPollingRef.current); scraperPollingRef.current = null; }
    setScraperPolling(false);
  };

  // スクレイパー完了通知を受けてポーリング停止 + 自動クリーニング
  React.useEffect(() => {
    const checkDone = setInterval(async () => {
      if (!scraperPolling) return;
      try {
        const res = await fetch(`${RAILWAY}/leads/scraper-status`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.done) {
          stopScraperPolling();
          if (autoCleanAfter) triggerAutoClean();
        }
      } catch {}
    }, 6000);
    return () => clearInterval(checkDone);
  }, [scraperPolling, autoCleanAfter]); // eslint-disable-line

  // 自動クリーニング（verify-single を順番に呼ぶ）
  const triggerAutoClean = async () => {
    setAutoCleanRunning(true);
    setAutoCleanProgress({ done: 0, total: 0, valid: 0, invalid: 0 });
    // 少し待ってからCRMの最新状態を参照
    await new Promise(r => setTimeout(r, 1000));
    setCrm(currentCrm => {
      const targets = currentCrm.filter(c => c.status === "unverified" && c.email);
      setAutoCleanProgress({ done: 0, total: targets.length, valid: 0, invalid: 0 });
      (async () => {
        let valid = 0, invalid = 0;
        for (let i = 0; i < targets.length; i++) {
          const contact = targets[i];
          let newStatus = "invalid";
          try {
            const res = await fetch(`${RAILWAY}/email/verify-single`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: contact.email }),
            });
            if (res.ok) { const d = await res.json(); newStatus = d.valid ? "ready" : "invalid"; }
          } catch {}
          if (newStatus === "ready") valid++; else invalid++;
          setCrm(prev => prev.map(c => c.id === contact.id ? { ...c, status: newStatus } : c));
          setAutoCleanProgress({ done: i + 1, total: targets.length, valid, invalid });
          if (i < targets.length - 1) await new Promise(r => setTimeout(r, 150));
        }
        setAutoCleanRunning(false);
      })();
      return currentCrm;
    });
  };

  React.useEffect(() => {
    return () => { if (scraperPollingRef.current) clearInterval(scraperPollingRef.current); };
  }, []);

  // PDCAタブからの prefill 対応
  React.useEffect(() => {
    if (prefill?.suggestedTargeting) {
      const st = prefill.suggestedTargeting;
      const parts = [];
      if (st.titles?.length) parts.push(st.titles.slice(0, 3).join(" / "));
      if (parts.length) setIntentQuery(parts.join(", "));
      const ctxParts = [];
      if (st.industry) ctxParts.push(`業界: ${st.industry}`);
      if (st.country) ctxParts.push(`地域: ${st.country}`);
      if (ctxParts.length) setTargetingContext(ctxParts.join("\n"));
    }
  }, [prefill?.suggestedTargeting]);

  // ── 検索実行: サーバー /search/intent-xray に送信 ──
  const runIntentSearch = async () => {
    if (!intentQuery.trim()) return;
    setIntentLoading(true);
    setIntentError("");
    setCandidates([]);
    setGeneratedQuery("");
    setGuessState({});
    setAdded({});
    setSearchMeta(null);

    try {
      const res = await fetch(`${RAILWAY}/search/intent-xray`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intentQuery: intentQuery.trim(),
          targetingContext: targetingContext.trim(),
          limit,
          settings, // ★ 自社プロファイルをサーバーに渡す（クエリ生成精度向上）
        }),
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {}

        if (res.status === 503) {
          throw new Error(`⏳ Gemini API が一時的に混雑中です。数秒後にもう一度お試しください。\n(${errMsg})`);
        } else if (res.status === 404) {
          throw new Error(`⚠️ /search/intent-xray エンドポイントが見つかりません。新しい server.js を Railway にデプロイしてください。`);
        } else {
          throw new Error(errMsg);
        }
      }

      const data = await res.json();
      setGeneratedQuery(data.query || "");
      setCandidates(data.candidates || []);
      setSearchMeta({
        totalRaw: data._rawTotal || 0,
        totalFiltered: data.total || 0,
        contextUsed: !!targetingContext.trim(),
      });
      if (!data.candidates?.length) {
        setIntentError("候補が見つかりませんでした。検索意図やコンテキストを調整してお試しください。");
      }
    } catch (e) {
      setIntentError("検索失敗: " + (e.message || String(e)));
    }
    setIntentLoading(false);
  };

  // ── メアド推測（単体） ──
  const guessEmailSingle = async (candidate, domOverride) => {
    const domain = (domOverride || domainOverride[candidate.id] || candidate.guessedDomain || "").trim();
    if (!domain) {
      setGuessState(prev => ({ ...prev, [candidate.id]: { loading: false, error: "ドメインを入力してください" } }));
      return null;
    }
    setGuessState(prev => ({ ...prev, [candidate.id]: { loading: true } }));
    try {
      const nameParts = (candidate.name || "").trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName  = nameParts.slice(1).join(" ") || nameParts[0] || "";
      const res = await fetch(`${RAILWAY}/email/guess-and-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, domain, name: candidate.name, candidateId: candidate.id }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `HTTP ${res.status}`); }
      const data = await res.json();
      setGuessState(prev => ({ ...prev, [candidate.id]: { loading: false, result: data } }));
      if (data.verifiedEmail) {
        setCandidates(prev => prev.map(c => c.id === candidate.id ? { ...c, email: data.verifiedEmail, _verifyStatus: "valid" } : c));
        return data.verifiedEmail;
      } else if (data.bestGuess) {
        setCandidates(prev => prev.map(c => c.id === candidate.id ? { ...c, email: data.bestGuess, _verifyStatus: "unverifiable" } : c));
        return data.bestGuess;
      }
      return null;
    } catch (e) {
      setGuessState(prev => ({ ...prev, [candidate.id]: { loading: false, error: e.message } }));
      return null;
    }
  };

  // 互換: 単体ボタン用（ドメイン未入力でもAI推測を試みる）
  const guessEmail = async (candidate) => {
    let domain = (domainOverride[candidate.id] || candidate.guessedDomain || "").trim();
    // ドメインがなければAIで推測
    if (!domain) {
      setGuessState(prev => ({ ...prev, [candidate.id]: { loading: true } }));
      try {
        const map = await guessDomainWithAI([candidate]);
        if (map[candidate.id]) {
          domain = map[candidate.id];
          setDomainOverride(prev => ({ ...prev, [candidate.id]: domain }));
          setCandidates(prev => prev.map(c => c.id === candidate.id ? { ...c, guessedDomain: domain } : c));
        }
      } catch {}
      if (!domain) {
        setGuessState(prev => ({ ...prev, [candidate.id]: { loading: false, error: "ドメインを推測できませんでした。手動入力してください。" } }));
        return;
      }
    }
    await guessEmailSingle(candidate, domain);
  };

  // ── サーバー経由で Gemini によるドメイン推測 ──
  const guessDomainWithAI = async (candidatesNeedDomain) => {
    if (candidatesNeedDomain.length === 0) return {};
    try {
      const res = await fetch(`${RAILWAY}/search/guess-domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: candidatesNeedDomain.map(c => ({
            id: c.id,
            name: c.name,
            title: c.title || "",
            company: c.company || "",
            linkedinUrl: c.linkedinUrl || "",
            rawTitle: (c.rawTitle || "").slice(0, 150),
            rawSnippet: (c.rawSnippet || c.rawTitle || "").slice(0, 120),
          })),
        }),
      });
      if (!res.ok) {
        console.warn("ドメイン推測API失敗:", res.status);
        return {};
      }
      const data = await res.json();
      return data.domainMap || {};
    } catch (e) {
      console.warn("ドメイン推測失敗:", e.message);
    }
    return {};
  };

  // ── 自動一括メアド推測＋検証 ──
  const [autoVerifyRunning, setAutoVerifyRunning] = React.useState(false);
  const [autoVerifyProgress, setAutoVerifyProgress] = React.useState({ done: 0, total: 0, found: 0, phase: "" });
  const autoVerifyAbort = React.useRef(false);

  const runAutoVerifyAll = async (candidateList) => {
    if (!candidateList || candidateList.length === 0) return;

    setAutoVerifyRunning(true);
    autoVerifyAbort.current = false;

    // Phase 1: ドメインがない候補のドメインを Gemini で推測
    const needDomain = candidateList.filter(c => !c.email && !c.guessedDomain && !domainOverride[c.id]);
    let domainMap = {};
    if (needDomain.length > 0) {
      setAutoVerifyProgress({ done: 0, total: candidateList.length, found: 0, phase: "ドメイン推測中..." });
      domainMap = await guessDomainWithAI(needDomain);
      if (Object.keys(domainMap).length > 0) {
        setCandidates(prev => prev.map(c => domainMap[c.id] ? { ...c, guessedDomain: domainMap[c.id] } : c));
        setDomainOverride(prev => {
          const next = { ...prev };
          Object.entries(domainMap).forEach(([id, dom]) => { next[id] = dom; });
          return next;
        });
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Phase 2: ドメインがある全候補のメアドを推測＋検証
    // domainMap (Phase 1結果) と既存の domainOverride/guessedDomain をマージして参照
    const targets = candidateList.filter(c => {
      if (c.email) return false;
      const dom = domainMap[c.id] || domainOverride[c.id] || c.guessedDomain || "";
      return !!dom;
    });

    if (targets.length === 0) {
      setAutoVerifyProgress({ done: 0, total: 0, found: 0, phase: "推測可能な候補なし" });
      setAutoVerifyRunning(false);
      return;
    }

    setAutoVerifyProgress({ done: 0, total: targets.length, found: 0, phase: "メアド推測＋検証中..." });
    let found = 0;

    for (let i = 0; i < targets.length; i++) {
      if (autoVerifyAbort.current) break;
      const c = targets[i];
      const domain = domainMap[c.id] || domainOverride[c.id] || c.guessedDomain || "";
      const email = await guessEmailSingle(c, domain);
      if (email) found++;
      setAutoVerifyProgress({ done: i + 1, total: targets.length, found, phase: "メアド推測＋検証中..." });
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    setAutoVerifyProgress(prev => ({ ...prev, phase: "完了" }));
    setAutoVerifyRunning(false);
  };

  // 検索結果が出たら自動でメアド推測を開始（emailモード時のみ）
  const autoVerifyTriggered = React.useRef(false);
  React.useEffect(() => {
    // 候補が新しくセットされた時のみ発火（空→有への遷移）
    if (candidates.length > 0 && !autoVerifyTriggered.current && !autoVerifyRunning) {
      autoVerifyTriggered.current = true;

      if (approachMode === "linkedin") {
        // ── LinkedIn モード: メアド推測スキップ → 全件を「LinkedIn送信待ち」でCRM登録 ──
        const toAdd = candidates.filter(c => !crm.find(x => x.id === c.id));
        if (toAdd.length > 0) {
          setCrm(prev => {
            const next = [...prev];
            toAdd.forEach(c => {
              if (!next.find(x => x.id === c.id)) {
                const liUrl = c.linkedinUrl || c.linkedin || "";
                next.push({
                  ...c,
                  linkedin:    liUrl,
                  linkedinUrl: liUrl,
                  status:      "LinkedIn送信待ち",
                  addedAt:     new Date().toISOString(),
                  clicks: 0, opens: 0, gaData: null, notes: "",
                  subject: "", messageBody: "", trackingId: null,
                  sourceIntent:   intentQuery,
                  sourceContext:  targetingContext,
                });
              }
            });
            return next;
          });
          setAdded(prev => {
            const next = { ...prev };
            toAdd.forEach(c => { next[c.id] = "✓ LinkedIn待ち"; });
            return next;
          });
        }
      } else {
        // ── Email モード: 既存の自動メアド推測 ──
        const timer = setTimeout(() => runAutoVerifyAll(candidates), 800);
        return () => clearTimeout(timer);
      }
    }
    // 候補がクリアされたらフラグリセット
    if (candidates.length === 0) {
      autoVerifyTriggered.current = false;
    }
  }, [candidates.length, approachMode]); // eslint-disable-line

  // ── CRM 登録（sourceIntent/sourceContext/contextSummary 付き） ──
  const addToCrm = (candidate) => {
    if (crm.find(c => c.id === candidate.id)) {
      setAdded(prev => ({ ...prev, [candidate.id]: "既存" }));
      return;
    }
    // linkedinUrl / linkedin どちらにあっても両フィールドに統一して保持
    const liUrl = candidate.linkedinUrl || candidate.linkedin || "";
    setCrm(prev => [...prev, {
      ...candidate,
      linkedin:    liUrl,
      linkedinUrl: liUrl,
      status:      approachMode === "linkedin" ? "LinkedIn送信待ち" :
                   candidate._verifyStatus === "valid" ? "ready" :
                   candidate.email ? "unverified" :
                   "未送信",
      addedAt:     new Date().toISOString(),
      clicks: 0, opens: 0, gaData: null, notes: "",
      subject: "", messageBody: "", trackingId: null,
      sourceIntent: intentQuery,
      sourceContext: targetingContext,
      contextSummary: candidate.contextSummary || "",
    }]);
    setAdded(prev => ({
      ...prev,
      [candidate.id]: approachMode === "linkedin" ? "✓ LinkedIn待ち" : "✓ 追加",
    }));
  };

  // ── 一括CRM追加 ──
  const bulkAddToCrm = () => {
    setBulkAdding(true);
    let count = 0;
    candidates.forEach(candidate => {
      if (!crm.find(c => c.id === candidate.id) && !added[candidate.id]) {
        addToCrm(candidate);
        count++;
      }
    });
    setTimeout(() => setBulkAdding(false), 500);
  };

  const getDomain = (candidate) => domainOverride[candidate.id] ?? candidate.guessedDomain ?? "";

  // ── コンテキスト充実度メーター ──
  const contextRichness = React.useMemo(() => {
    const ctx = targetingContext.trim();
    if (!ctx) return 0;
    const len = ctx.length;
    if (len < 20) return 1;
    if (len < 60) return 2;
    if (len < 150) return 3;
    if (len < 300) return 4;
    return 5;
  }, [targetingContext]);

  const richnessLabels = ["未入力", "最低限", "基本", "良好", "詳細", "最高精度"];
  const richnessColors = ["#999", "#E24B4A", "#D4AC0D", "#27AE60", "#1D9E75", "#0E6F5E"];

  return (
    <div>
      {/* モード切替 */}
      <div style={{ display: "flex", gap: 8, marginBottom: "1rem", alignItems: "center" }}>
        <button onClick={() => setMode("intent")}
          style={{ fontSize: 13, padding: "7px 16px", borderRadius: 8, background: mode === "intent" ? "#185FA5" : "transparent", color: mode === "intent" ? "#fff" : "var(--color-text-secondary)", border: mode === "intent" ? "none" : "0.5px solid var(--color-border-secondary)", fontWeight: mode === "intent" ? 500 : 400, cursor: "pointer" }}>
          インテント＋コンテキスト検索
        </button>
        <button onClick={() => setMode("apollo")}
          style={{ fontSize: 13, padding: "7px 16px", borderRadius: 8, background: mode === "apollo" ? "#185FA5" : "transparent", color: mode === "apollo" ? "#fff" : "var(--color-text-secondary)", border: mode === "apollo" ? "none" : "0.5px solid var(--color-border-secondary)", fontWeight: mode === "apollo" ? 500 : 400, cursor: "pointer" }}>
          Apollo 検索（従来）
        </button>
        <button onClick={() => setMode("scraper")}
          style={{ fontSize: 13, padding: "7px 16px", borderRadius: 8, background: mode === "scraper" ? "#7C3AED" : "transparent", color: mode === "scraper" ? "#fff" : "var(--color-text-secondary)", border: mode === "scraper" ? "none" : "0.5px solid var(--color-border-secondary)", fontWeight: mode === "scraper" ? 500 : 400, cursor: "pointer" }}>
          🤖 Apolloスクレイパー（大量取得）
        </button>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: 4 }}>
          意図＋背景を入力するほど、AIが高精度にターゲットを絞り込みます
        </span>
      </div>

      {/* ── アプローチ手法トグル ── */}
      <Card style={{
        marginBottom: "1rem", padding: "0.75rem 1rem",
        background: approachMode === "linkedin"
          ? "linear-gradient(135deg, #EEF5FB 0%, #E8F2FA 100%)"
          : "linear-gradient(135deg, #F0FAF5 0%, #F7FCF9 100%)",
        border: `0.5px solid ${approachMode === "linkedin" ? "#0A66C2" : "#1D9E75"}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>
              アプローチ手法
            </p>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setApproachMode("email")}
                style={{
                  fontSize: 12, padding: "5px 14px", borderRadius: 100, cursor: "pointer",
                  background: approachMode === "email" ? "#1D9E75" : "transparent",
                  color: approachMode === "email" ? "#fff" : "var(--color-text-secondary)",
                  border: approachMode === "email" ? "none" : "0.5px solid var(--color-border-secondary)",
                  fontWeight: approachMode === "email" ? 500 : 400,
                  transition: "all .15s",
                }}>
                📧 メール
              </button>
              <button
                onClick={() => setApproachMode("linkedin")}
                style={{
                  fontSize: 12, padding: "5px 14px", borderRadius: 100, cursor: "pointer",
                  background: approachMode === "linkedin" ? "#0A66C2" : "transparent",
                  color: approachMode === "linkedin" ? "#fff" : "var(--color-text-secondary)",
                  border: approachMode === "linkedin" ? "none" : "0.5px solid var(--color-border-secondary)",
                  fontWeight: approachMode === "linkedin" ? 500 : 400,
                  transition: "all .15s",
                }}>
                💼 LinkedIn
              </button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: approachMode === "linkedin" ? "#0A66C2" : "#085041", lineHeight: 1.6, maxWidth: 380 }}>
            {approachMode === "linkedin" ? (
              <>
                <strong>LinkedIn モード:</strong> メアド推測をスキップし、検索後に全候補を
                「<strong>LinkedIn送信待ち</strong>」ステータスで直接CRMに保存します。
                「メール送信」タブ → LinkedIn サブタブから一括送信できます。
              </>
            ) : (
              <>
                <strong>メールモード:</strong> 検索後に自動でメアドを推測・検証し、
                valid なものだけをCRMに追加します。
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ─── Apollo 従来モード ─── */}
      {mode === "apollo" && (
        <SearchTab settings={settings} crm={crm} setCrm={setCrm} prefill={prefill} />
      )}

      {/* ─── Apolloスクレイパーモード ─── */}
      {mode === "scraper" && (
        <div>
          <Card style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)", border: "0.5px solid #7C3AED" }}>
            <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "#4C1D95" }}>🤖 Apolloスクレイパー — ワンクリック大量取得</p>
            <p style={{ margin: 0, fontSize: 11, color: "#6D28D9", lineHeight: 1.6 }}>
              検索条件を入力して「Chrome拡張に送信」を押すだけ。拡張機能がApolloを自動操作し、全ページのリードを取得→Sales-Masterに自動送信します。
            </p>
          </Card>

          {/* 検索条件フォーム */}
          <Section title="検索条件（Chrome拡張に送信）">
            <Card>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: "block", marginBottom: 4 }}>役職（カンマ区切り）</label>
                  <textarea rows={3} placeholder={"CEO, Founder, CTO\nHead of Finance\nDirector of Operations"}
                    value={scraperQuery.titles}
                    onChange={e => setScraperQuery(q => ({ ...q, titles: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, fontFamily: "inherit", resize: "vertical" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: "block", marginBottom: 4 }}>業界（カンマ区切り）</label>
                  <textarea rows={3} placeholder={"Financial Services\nCryptocurrency\nOnline Gambling"}
                    value={scraperQuery.industries}
                    onChange={e => setScraperQuery(q => ({ ...q, industries: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, fontFamily: "inherit", resize: "vertical" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: "block", marginBottom: 4 }}>国・地域（カンマ区切り）</label>
                  <input placeholder="United Kingdom, Singapore, Malta"
                    value={scraperQuery.countries}
                    onChange={e => setScraperQuery(q => ({ ...q, countries: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: "block", marginBottom: 4 }}>キーワード（任意）</label>
                  <input placeholder="crypto payment, OTC, stablecoin"
                    value={scraperQuery.keywords}
                    onChange={e => setScraperQuery(q => ({ ...q, keywords: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8 }} />
                </div>
              </div>
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: "block", marginBottom: 4 }}>最大ページ数（1ページ≒25件）</label>
                  <select value={scraperQuery.maxPages}
                    onChange={e => setScraperQuery(q => ({ ...q, maxPages: e.target.value }))}
                    style={{ fontSize: 12, padding: "6px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8 }}>
                    {[1,2,5,10,20,40].map(n => <option key={n} value={n}>{n}ページ（最大{n*25}件）</option>)}
                  </select>
                </div>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginTop: 16 }}>
                  <input type="checkbox" checked={autoCleanAfter} onChange={e => setAutoCleanAfter(e.target.checked)} />
                  取得後にメール自動検証（推奨）
                </label>
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  onClick={sendScraperQuery}
                  disabled={scraperSending || scraperPolling || (!scraperQuery.titles.trim() && !scraperQuery.industries.trim())}
                  style={{
                    padding: "10px 24px", fontSize: 13, fontWeight: 600, borderRadius: 8,
                    background: scraperSending ? "#999" : scraperPolling ? "#6D28D9" : "#7C3AED",
                    color: "#fff", border: "none",
                    cursor: (scraperSending || scraperPolling) ? "default" : "pointer",
                    opacity: (!scraperQuery.titles.trim() && !scraperQuery.industries.trim()) ? 0.5 : 1,
                  }}>
                  {scraperSending ? "⏳ Apify起動中..." : scraperPolling ? "🔄 スクレイプ実行中..." : "🚀 Apifyで自動取得開始"}
                </button>
                {scraperPolling && (
                  <button onClick={() => { clearInterval(scraperPollingRef.current); scraperPollingRef.current = null; setScraperPolling(false); }}
                    style={{ padding: "10px 16px", fontSize: 12, borderRadius: 8, background: "#FEE2E2", color: "#991B1B", border: "none", cursor: "pointer" }}>
                    ⏹ 監視停止
                  </button>
                )}
              </div>
            </Card>
          </Section>

          {/* ステータス表示 */}
          {scraperSent && (
            <div style={{ marginBottom: 12 }}>

              {/* Apify実行中 */}
              {scraperPolling && apifyStatus === "RUNNING" && (
                <div style={{ padding: "12px 16px", borderRadius: 8, background: "#EDE9FE", border: "0.5px solid #C4B5FD", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#7C3AED", display: "inline-block" }} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: "#4C1D95" }}>Apifyがバックグラウンドでスクレイプ中...</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: "#6D28D9", lineHeight: 1.6 }}>
                    Apolloを自動検索してリードを取得しています。完了後に自動でインポートされます。<br />
                    {apifyRunId && <span style={{ fontFamily: "monospace", fontSize: 11 }}>Run ID: {apifyRunId}</span>}
                  </p>
                </div>
              )}

              {/* Apify失敗 */}
              {apifyStatus === "FAILED" && (
                <div style={{ padding: "12px 16px", borderRadius: 8, background: "#FEE2E2", border: "0.5px solid #FCA5A5", marginBottom: 8 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#991B1B" }}>
                    ❌ Apify実行に失敗しました。条件を確認して再試行してください。
                  </p>
                </div>
              )}

              {/* 自動クリーニング進捗 */}
              {autoCleanRunning && autoCleanProgress && (
                <div style={{ padding: "12px 16px", borderRadius: 8, background: "#E6F1FB", border: "0.5px solid #ADC8E8" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, fontWeight: 500, color: "#0C447C" }}>
                    <span>🔍 メール自動検証中...</span>
                    <span>{autoCleanProgress.done} / {autoCleanProgress.total}件</span>
                  </div>
                  <div style={{ height: 6, background: "#BDD6EF", borderRadius: 100, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 100, width: `${autoCleanProgress.total ? (autoCleanProgress.done / autoCleanProgress.total) * 100 : 0}%`, background: "#185FA5", transition: "width .2s" }} />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#378ADD" }}>
                    ✓ 有効: {autoCleanProgress.valid}件 · ✗ 無効: {autoCleanProgress.invalid}件
                  </div>
                </div>
              )}

              {/* 完了 */}
              {!scraperPolling && !autoCleanRunning && scraperResult && apifyStatus === "SUCCEEDED" && (
                <div style={{ padding: "12px 16px", borderRadius: 8, background: "#D1FAE5", border: "0.5px solid #6EE7B7" }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#065F46" }}>
                    ✅ 完了！ リスト管理タブで確認してください
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#047857" }}>
                    取得件数: {scraperResult.itemCount}件
                    {autoCleanProgress && ` → 有効メール: ${autoCleanProgress.valid}件（ready）/ 無効: ${autoCleanProgress.invalid}件`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 使い方ガイド */}
          {!scraperSent && (
            <Card style={{ background: "#FAFAF9" }}>
              <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>📋 使い方</p>
              {[
                "上記フォームに検索条件（役職・業界・国）を入力",
                "「🚀 Apifyで自動取得開始」を押す",
                "ApifyがバックグラウンドでApolloをスクレイプ（URLコピー不要）",
                "完了後に自動でSales-Masterにインポート",
                "自動でメール検証 → リスト管理タブに「ready」で追加",
              ].map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, background: "#7C3AED", color: "#fff", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* ─── Intent + Context 検索モード ─── */}
      {mode === "intent" && (
        <div>
          {/* ステータスバー */}
          <Card style={{
            marginBottom: "1rem", padding: "0.625rem 1rem",
            background: serperOk === false ? "#FEF9E7" : "linear-gradient(135deg, #F0F4FA 0%, #F7F9FC 100%)",
            border: `0.5px solid ${serperOk === false ? "#D4AC0D" : "var(--color-border-tertiary)"}`,
            display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
          }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>
                {serperOk === false ? "⚠️ Railway 未接続" : "🎯 意図＋コンテキスト ベース X-Ray 検索"}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>
                意図とコンテキストの両方をAIが解析 → 最適な X-Ray クエリを自動生成 → 検索結果をAIが精査・スコアリング
              </p>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, background: "#E6F1FB", color: "#185FA5" }}>Claude + Serper</span>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, background: "#E1F5EE", color: "#085041" }}>2段階AI精査</span>
            </div>
          </Card>

          {/* ── 検索フォーム ── */}
          <Section title="検索条件">
            <Card>
              {/* (a) 検索意図 */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", display: "block", marginBottom: 4 }}>
                  誰を探していますか？
                  <span style={{ fontSize: 11, fontWeight: 400, color: "var(--color-text-tertiary)", marginLeft: 6 }}>（検索意図）</span>
                </label>
                <input
                  type="text"
                  value={intentQuery}
                  onChange={e => setIntentQuery(e.target.value)}
                  placeholder="例: SaaS企業のCFO、Web3スタートアップのCTO、製造業の購買部長"
                  style={{
                    width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 12px",
                    border: "0.5px solid var(--color-border-secondary)", borderRadius: 8,
                    background: "var(--color-background-primary)", color: "var(--color-text-primary)",
                    fontFamily: "inherit",
                  }}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runIntentSearch(); } }}
                />
              </div>

              {/* (b) ターゲティングコンテキスト */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)" }}>
                    ターゲティングの背景・条件
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--color-text-tertiary)", marginLeft: 6 }}>（詳しいほど精度UP）</span>
                  </label>
                  {/* コンテキスト充実度メーター */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ display: "flex", gap: 2 }}>
                      {[0,1,2,3,4].map(i => (
                        <div key={i} style={{
                          width: 16, height: 4, borderRadius: 2,
                          background: i < contextRichness ? richnessColors[contextRichness] : "#E0E0E0",
                          transition: "background 0.3s ease",
                        }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 10, color: richnessColors[contextRichness], fontWeight: 500 }}>
                      {richnessLabels[contextRichness]}
                    </span>
                  </div>
                </div>
                <textarea
                  value={targetingContext}
                  onChange={e => setTargetingContext(e.target.value)}
                  rows={4}
                  placeholder={`背景や条件を自由に記述してください。詳しいほどAIの精査精度が上がります。\n\n例:\n・業界: FinTech / 仮想通貨決済に関連する企業\n・規模: 従業員50〜500名、Series A〜B\n・課題: レガシーな決済手数料が高く、コスト削減を検討している\n・地域: 東南アジア（シンガポール、ベトナム中心）\n・除外: 大手銀行系列は除く`}
                  style={{
                    width: "100%", boxSizing: "border-box", fontSize: 13, padding: "10px 12px",
                    border: "0.5px solid var(--color-border-secondary)", borderRadius: 8,
                    background: "var(--color-background-primary)", color: "var(--color-text-primary)",
                    fontFamily: "inherit", lineHeight: 1.65, resize: "vertical",
                  }}
                />
                {!targetingContext.trim() && (
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
                    💡 コンテキスト未入力でも検索可能ですが、入力するとAIが結果を精査し、関連性の低い候補を除外します
                  </p>
                )}
              </div>

              {/* (c) 取得件数 + 検索ボタン */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", display: "block", marginBottom: 4 }}>
                    取得件数
                  </label>
                  <select
                    value={limit}
                    onChange={e => setLimit(Number(e.target.value))}
                    style={{
                      fontSize: 13, padding: "8px 12px", borderRadius: 8,
                      border: "0.5px solid var(--color-border-secondary)",
                      background: "var(--color-background-primary)", color: "var(--color-text-primary)",
                      fontFamily: "inherit", cursor: "pointer", minWidth: 100,
                    }}>
                    {[5, 10, 20, 50, 100].map(n => (
                      <option key={n} value={n}>{n}件</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={runIntentSearch}
                  disabled={intentLoading || !intentQuery.trim()}
                  style={{
                    padding: "9px 24px", fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: "pointer",
                    background: intentLoading ? "#999" : "#185FA5", color: "#fff", border: "none",
                    display: "flex", alignItems: "center", gap: 6,
                    opacity: (!intentQuery.trim()) ? 0.5 : 1,
                    transition: "all 0.2s ease",
                  }}>
                  {intentLoading ? (
                    <>
                      <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                      AI精査中...
                    </>
                  ) : "🎯 インテント検索を実行"}
                </button>
              </div>

              {/* 生成されたクエリ表示 */}
              {generatedQuery && (
                <div style={{
                  marginTop: 14, padding: "8px 12px",
                  background: "var(--color-background-secondary)",
                  borderRadius: 6, borderLeft: "3px solid #185FA5",
                }}>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 500 }}>AI生成クエリ</p>
                  <p style={{ margin: "3px 0 0", fontSize: 12, fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{generatedQuery}</p>
                </div>
              )}

              {/* 検索メタ情報 */}
              {searchMeta && (
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, background: "#E6F1FB", color: "#0C447C" }}>
                    Serper取得: {searchMeta.totalRaw}件
                  </span>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, background: searchMeta.contextUsed ? "#D5F5E3" : "#F1EFE8", color: searchMeta.contextUsed ? "#1E8449" : "#444441" }}>
                    {searchMeta.contextUsed ? `AI精査後: ${searchMeta.totalFiltered}件` : `精査スキップ（コンテキスト未入力）: ${searchMeta.totalFiltered}件`}
                  </span>
                </div>
              )}

              {intentError && (
                <p style={{ color: "var(--color-text-danger)", fontSize: 13, marginTop: 10 }}>{intentError}</p>
              )}
            </Card>
          </Section>

          {/* ── 候補リスト ── */}
          {candidates.length > 0 && (
            <Section title={`検索結果 — ${candidates.length}件`}
              right={
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {!autoVerifyRunning && (
                    <button
                      onClick={() => runAutoVerifyAll(candidates)}
                      disabled={autoVerifyRunning || !candidates.some(c => !c.email && c.guessedDomain)}
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer", background: "#FAEEDA", color: "#633806", border: "0.5px solid #D4AC0D" }}>
                      📧 全件メアド推測を再実行
                    </button>
                  )}
                  {autoVerifyRunning && (
                    <button
                      onClick={() => { autoVerifyAbort.current = true; }}
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer", background: "#FDEDEC", color: "#922B21", border: "0.5px solid #E24B4A" }}>
                      ⏹ 中止
                    </button>
                  )}
                  <button
                    onClick={bulkAddToCrm}
                    disabled={bulkAdding}
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                      background: approachMode === "linkedin" ? "#0A66C2" : "#E6F1FB",
                      color: approachMode === "linkedin" ? "#fff" : "#185FA5",
                      border: approachMode === "linkedin" ? "none" : "0.5px solid #185FA5" }}>
                    {bulkAdding ? "追加中..." : approachMode === "linkedin" ? "💼 全件LinkedIn待ちで追加" : "全件CRMに追加"}
                  </button>
                </div>
              }>

              {/* 自動メアド推測プログレスバー */}
              {(autoVerifyRunning || autoVerifyProgress.done > 0) && (
                <Card style={{ marginBottom: 12, padding: "10px 14px", background: autoVerifyRunning ? "linear-gradient(135deg, #FFF9E6 0%, #FFFDF5 100%)" : "#F0FAF5", border: `0.5px solid ${autoVerifyRunning ? "#D4AC0D" : "#1D9E75"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                      {autoVerifyRunning ? (
                        <>
                          <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #D4AC0D", borderTopColor: "#633806", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                          {autoVerifyProgress.phase || "メアド自動推測＋検証中..."}
                        </>
                      ) : "✅ メアド推測＋検証 完了"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                      {autoVerifyProgress.total > 0 ? `${autoVerifyProgress.done}/${autoVerifyProgress.total}件処理 · ✓${autoVerifyProgress.found}件発見` : "対象なし"}
                    </span>
                  </div>
                  {autoVerifyProgress.total > 0 && (
                    <div style={{ height: 4, background: "#E0E0E0", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 2,
                        background: autoVerifyRunning ? "linear-gradient(90deg, #D4AC0D, #F4D03F)" : "#1D9E75",
                        width: `${autoVerifyProgress.total ? (autoVerifyProgress.done / autoVerifyProgress.total * 100) : 0}%`,
                        transition: "width 0.3s ease",
                      }} />
                    </div>
                  )}
                  {!autoVerifyRunning && autoVerifyProgress.found > 0 && (
                    <p style={{ margin: "6px 0 0", fontSize: 11, color: "#1E8449" }}>
                      ✓ {autoVerifyProgress.found}件の有効メアドを発見。「全件CRMに追加」で一括登録できます。
                    </p>
                  )}
                  {!autoVerifyRunning && autoVerifyProgress.done > 0 && autoVerifyProgress.found === 0 && (
                    <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--color-text-secondary)" }}>
                      有効なメアドは見つかりませんでした。ドメインを手動で修正して再推測できます。
                    </p>
                  )}
                </Card>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {candidates.map((candidate, idx) => {
                  const gs = guessState[candidate.id] || {};
                  const addedStatus = added[candidate.id];
                  const isAdded = !!addedStatus;
                  const hasEmail = !!candidate.email;
                  const domain = getDomain(candidate);

                  return (
                    <Card key={candidate.id} style={{
                      border: hasEmail ? "1px solid #1D9E75" : isAdded ? "0.5px solid var(--color-border-tertiary)" : undefined,
                      background: hasEmail ? "#F0FAF5" : undefined,
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1, minWidth: 0 }}>
                          {/* 順位バッジ */}
                          <div style={{ position: "relative" }}>
                            <Avatar name={candidate.name} />
                            {candidate.relevanceScore != null && (
                              <span style={{
                                position: "absolute", top: -4, right: -4,
                                fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 100,
                                background: candidate.relevanceScore >= 8 ? "#1D9E75" : candidate.relevanceScore >= 5 ? "#D4AC0D" : "#999",
                                color: "#fff", lineHeight: 1.4,
                              }}>
                                {candidate.relevanceScore}
                              </span>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                              <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>
                                <span style={{ color: "var(--color-text-tertiary)", fontSize: 11, marginRight: 4 }}>#{idx + 1}</span>
                                {candidate.name}
                              </p>
                              {candidate._verifyStatus === "valid" && (
                                <span style={{ fontSize: 10, fontWeight: 500, padding: "1px 7px", borderRadius: 100, background: "#D5F5E3", color: "#1E8449" }}>valid</span>
                              )}
                            </div>
                            <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>
                              {candidate.title}{candidate.title && candidate.company ? " · " : ""}{candidate.company}
                            </p>

                            {/* contextSummary バッジ */}
                            {candidate.contextSummary && (
                              <div style={{
                                marginTop: 5, padding: "4px 8px", borderRadius: 6,
                                background: "linear-gradient(135deg, #EEF2FF 0%, #F0FFFE 100%)",
                                border: "0.5px solid #C7D2FE",
                                fontSize: 11, color: "#3730A3", lineHeight: 1.5,
                                display: "flex", alignItems: "flex-start", gap: 4,
                              }}>
                                <span style={{ flexShrink: 0, fontSize: 12 }}>🧠</span>
                                <span>{candidate.contextSummary}</span>
                              </div>
                            )}

                            <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              {/* LinkedIn モード: LinkedInURLをメインに表示 */}
                              {approachMode === "linkedin" ? (
                                <>
                                  {(candidate.linkedinUrl || candidate.linkedin) ? (
                                    <a href={candidate.linkedinUrl || candidate.linkedin} target="_blank" rel="noreferrer"
                                      style={{ fontSize: 11, color: "#0A66C2", fontWeight: 500, display: "flex", alignItems: "center", gap: 3 }}>
                                      💼 {candidate.linkedinUrl || candidate.linkedin}
                                    </a>
                                  ) : (
                                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>LinkedIn URL なし</span>
                                  )}
                                  {candidate.email && (
                                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{candidate.email}</span>
                                  )}
                                </>
                              ) : (
                                <>
                                  {candidate.email ? (
                                    <span style={{ fontSize: 11, color: "var(--color-text-info)" }}>{candidate.email}</span>
                                  ) : (
                                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>メアド未特定</span>
                                  )}
                                  {candidate.linkedinUrl && (
                                    <a href={candidate.linkedinUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>LinkedIn ↗</a>
                                  )}
                                </>
                              )}
                            </div>

                            {/* メアド推測UI（emailモード時のみ） */}
                            {!hasEmail && approachMode === "email" && (
                              <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                <input type="text" placeholder="ドメイン (例: acme.com)" value={domain}
                                  onChange={e => setDomainOverride(prev => ({ ...prev, [candidate.id]: e.target.value }))}
                                  style={{ fontSize: 12, padding: "4px 8px", width: 180, borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}
                                />
                                <button onClick={() => guessEmail(candidate)} disabled={gs.loading} style={{ fontSize: 12, padding: "5px 12px", cursor: "pointer" }}>
                                  {gs.loading ? "推測中..." : domain.trim() ? "メアド推測" : "AI推測"}
                                </button>
                                {gs.error && <span style={{ fontSize: 11, color: "var(--color-text-danger)" }}>{gs.error}</span>}
                              </div>
                            )}

                            {/* 推測結果サマリー */}
                            {gs.result && !hasEmail && (
                              <div style={{ marginTop: 6, padding: "6px 10px", background: "var(--color-background-secondary)", borderRadius: 6, fontSize: 11, color: "var(--color-text-secondary)" }}>
                                {gs.result.verifiedEmail
                                  ? <span style={{ color: "#1D9E75", fontWeight: 500 }}>✓ {gs.result.verifiedEmail} (SMTP検証済)</span>
                                  : gs.result.bestGuess
                                  ? <span style={{ color: "#E89820", fontWeight: 500 }}>? {gs.result.bestGuess} (推測のみ・{gs.result.provider}は検証不可)</span>
                                  : <span>有効なメアドが見つかりませんでした ({gs.result.allResults?.length || 0}パターン試行)</span>}
                                {gs.result.note && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-text-tertiary)" }}>({gs.result.note})</span>}
                              </div>
                            )}
                            {gs.result && (
                              <details style={{ marginTop: 4 }}>
                                <summary style={{ fontSize: 11, color: "var(--color-text-tertiary)", cursor: "pointer" }}>試行したパターン {gs.result.allResults.length}件</summary>
                                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                  {gs.result.allResults.map(r => (
                                    <span key={r.email} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: r.valid ? "#D5F5E3" : "var(--color-background-secondary)", color: r.valid ? "#1E8449" : "var(--color-text-tertiary)" }}>
                                      {r.email} {r.valid ? "✓" : ""}
                                    </span>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>

                        {/* CRM 追加ボタン */}
                        <div style={{ flexShrink: 0 }}>
                          {isAdded ? (
                            <span style={{
                              fontSize: 12, padding: "5px 12px", borderRadius: 8, fontWeight: 500,
                              background: addedStatus?.includes("LinkedIn") ? "#E8F4FD" : "#D5F5E3",
                              color: addedStatus?.includes("LinkedIn") ? "#0A66C2" : "#1E8449",
                            }}>{addedStatus}</span>
                          ) : (
                            <button onClick={() => addToCrm(candidate)} style={{ fontSize: 12, padding: "6px 12px", cursor: "pointer",
                              background: approachMode === "linkedin" ? "#0A66C2" : undefined,
                              color: approachMode === "linkedin" ? "#fff" : undefined,
                              border: approachMode === "linkedin" ? "none" : undefined,
                            }}>
                              {approachMode === "linkedin"
                                ? "💼 LinkedIn待ちに追加"
                                : hasEmail ? "+ CRM に追加" : "+ メアドなしで追加"}
                            </button>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* Spinner animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// App.jsx の変更点:
//   SearchTab → IntentSearchTab に差し替え
//
// App() の render 部分で以下を変更:
//
//   変更前:
//     {tab === 1 && <SearchTab settings={settings} crm={crm} setCrm={setCrmWithSync} prefill={searchPrefill} />}
//
//   変更後:
//     {tab === 1 && <IntentSearchTab settings={settings} crm={crm} setCrm={setCrmWithSync} prefill={searchPrefill} />}
//
// ※ IntentSearchTab 内で mode==="apollo" の場合に既存 SearchTab を呼び出すため、
//    既存 SearchTab コンポーネントは削除せずそのまま残してください。
// ════════════════════════════════════════════════════════════

function countFilter(crm, filter) {
  if (filter.type === "all")    return crm.length;
  if (filter.type === "status") return crm.filter(c => c.status === filter.value).length;
  if (filter.type === "plan")   return crm.filter(c => !!c.gaData?.planStatus).length;
  if (filter.type === "flag") {
    if (filter.field === "multiOpen") return crm.filter(c => (c.opens || 0) >= 2).length;
    return crm.filter(c => !!c[filter.field]).length;
  }
  if (filter.type === "ga") return crm.filter(c => (c.gaData?.[filter.gaField] || 0) >= filter.gaMin).length;
  return 0;
}

function applyFilter(crm, filter) {
  if (filter.type === "all")    return crm;
  if (filter.type === "status") return crm.filter(c => c.status === filter.value);
  if (filter.type === "plan")   return crm.filter(c => !!c.gaData?.planStatus);
  if (filter.type === "flag") {
    if (filter.field === "multiOpen") return crm.filter(c => (c.opens || 0) >= 2);
    return crm.filter(c => !!c[filter.field]);
  }
  if (filter.type === "ga") return crm.filter(c => (c.gaData?.[filter.gaField] || 0) >= filter.gaMin);
  return crm;
}

// ════════════════════════════════════════════════════════════
// Tab: リスト管理
// ════════════════════════════════════════════════════════════
function ListTab({ crm, setCrm }) {
  const [filterIdx, setFilterIdx] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", company: "", email: "", linkedin: "", country: "日本", industry: "" });

  // ── CSVインポート ──
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState(null);
  const csvInputRef = useRef(null);

  // ── メアド編集（インライン） ──
  const [editingEmailId, setEditingEmailId] = useState(null);
  const [editingEmailValue, setEditingEmailValue] = useState("");
  const [reverifyingId, setReverifyingId] = useState(null);

  // メアド保存 + ステータス unverified にリセット + 検証ワーカーキック
  const saveEmailEdit = (contact) => {
    const newEmail = (editingEmailValue || "").toLowerCase().trim();
    setEditingEmailId(null);
    if (newEmail === (contact.email || "")) return;  // 変更なし

    // 簡易バリデーション
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      alert("メールアドレスの形式が正しくありません");
      return;
    }

    // 重複チェック（自分自身は除外）
    const dup = crm.find(c => c.id !== contact.id && (c.email || "").toLowerCase() === newEmail);
    if (newEmail && dup) {
      alert(`このメールアドレスは既に登録されています: ${dup.name || dup.id}`);
      return;
    }

    // email 更新 + ステータスを unverified にリセット
    setCrm(prev => prev.map(c =>
      c.id === contact.id ? { ...c, email: newEmail, status: newEmail ? "unverified" : c.status } : c
    ));

    // 検証ワーカーをキック
    if (newEmail) {
      setReverifyingId(contact.id);
      setTimeout(() => {
        fetch(`${RAILWAY}/webhook/verify-trigger`, { method: "POST" })
          .then(r => r.json())
          .then(d => console.log("re-verify trigger:", d))
          .catch(err => console.warn("verify-trigger 失敗:", err.message))
          .finally(() => setTimeout(() => setReverifyingId(null), 2000));
      }, 1500);
    }
  };

  // ── 一括クリーニング（検証）──
  const [cleaning, setCleaning] = useState(false);
  const [cleanProgress, setCleanProgress] = useState(null);

  // ── Chrome拡張ポーリング ──
  const [extPolling, setExtPolling] = useState(false);
  const [extResult, setExtResult] = useState(null);
  const extPollingRef = useRef(null);

  // ── Apify Webhookバックグラウンド検証ステータス ──
  const [verifyStatus, setVerifyStatus] = useState(null); // { workerRunning, unverifiedCount }
  const verifyStatusRef = useRef(null);

  // ── Xアカウント一括特定 ──
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [xFinding, setXFinding] = useState(false);
  const [xFindResult, setXFindResult] = useState(null); // { found, total }

  const update = (id, k, v) => setCrm(prev => prev.map(c => c.id === id ? { ...c, [k]: v } : c));
  const remove = id => setCrm(prev => prev.filter(c => c.id !== id));

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSelectAll = (ids) => setSelectedIds(prev =>
    prev.size === ids.length ? new Set() : new Set(ids)
  );

  const findXAccounts = async () => {
    const targets = crm
      .filter(c => selectedIds.has(c.id))
      .map(c => ({ id: c.id, name: c.name, company: c.company || "", title: c.title || "" }));
    if (targets.length === 0) return;
    setXFinding(true);
    setXFindResult(null);
    try {
      const res = await fetch(`${RAILWAY}/search/find-x-accounts-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const data = await res.json();
      const matches = data.matches || [];
      if (matches.length > 0) {
        setCrm(prev => prev.map(c => {
          const m = matches.find(x => x.id === c.id);
          return m ? { ...c, xUrl: m.matchUrl } : c;
        }));
      }
      setXFindResult({ found: matches.length, total: targets.length });
    } catch (err) {
      alert("Xアカウント特定に失敗しました: " + err.message);
    } finally {
      setXFinding(false);
    }
  };

  const activeFilter = FILTER_OPTIONS[filterIdx];
  const filtered = applyFilter(crm, activeFilter);

  // ── Railwayの検証ワーカー状態を15秒ごとにポーリング ──
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${RAILWAY}/webhook/verify-status`);
        if (res.ok) {
          const data = await res.json();
          setVerifyStatus(data);
        }
      } catch {}
    };
    poll();
    verifyStatusRef.current = setInterval(poll, 15000);
    return () => clearInterval(verifyStatusRef.current);
  }, []);

  // ────────────────────────────────────────────
  // Chrome拡張ポーリング: 5秒ごとに /leads/pending を確認
  // ────────────────────────────────────────────
  const startExtPolling = () => {
    if (extPollingRef.current) return;
    setExtPolling(true);
    setExtResult(null);

    extPollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${RAILWAY}/leads/pending`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.leads && data.leads.length > 0) {
          setCrm(prev => {
            const existingEmails   = new Set(prev.map(c => (c.email || "").toLowerCase()).filter(Boolean));
            const existingLinkedIn = new Set(prev.map(c => (c.linkedinUrl || c.linkedin || "").toLowerCase()).filter(Boolean));
            let added = 0, skipped = 0;
            const newContacts = [];

            for (const lead of data.leads) {
              const emailKey = (lead.email || "").toLowerCase();
              const liKey    = (lead.linkedinUrl || "").toLowerCase();
              if ((emailKey && existingEmails.has(emailKey)) ||
                  (liKey    && existingLinkedIn.has(liKey))) {
                skipped++;
                continue;
              }
              newContacts.push({
                ...lead,
                linkedin: lead.linkedinUrl || "",
                notes: "", clicked: false, opens: 0,
                sentAt: null, subject: "", messageBody: "", trackingId: null, gaData: null,
              });
              if (emailKey) existingEmails.add(emailKey);
              if (liKey)    existingLinkedIn.add(liKey);
              added++;
            }

            setExtResult(prev => ({
              added:   (prev?.added  || 0) + added,
              skipped: (prev?.skipped || 0) + skipped,
            }));

            return newContacts.length > 0 ? [...prev, ...newContacts] : prev;
          });
        }
      } catch (err) {
        console.warn("Chrome拡張ポーリングエラー:", err.message);
      }
    }, 5000);
  };

  const stopExtPolling = () => {
    if (extPollingRef.current) {
      clearInterval(extPollingRef.current);
      extPollingRef.current = null;
    }
    setExtPolling(false);
  };

  // アンマウント時にポーリング停止
  useEffect(() => {
    return () => {
      if (extPollingRef.current) clearInterval(extPollingRef.current);
    };
  }, []);

  // ────────────────────────────────────────────
  // CSVパース・インポート
  // ────────────────────────────────────────────
  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    // ヘッダー行の正規化（BOM除去・クォート除去）
    const rawHeaders = lines[0].split(",").map(h =>
      h.trim().replace(/^["']|["']$/g, "").replace(/^\uFEFF/, "")
    );

    // Apollo / Magically / ExportApollo 系の代表的なカラム名をマッピング
    // ヘッダーの大小文字・スペース・アンダースコア違いを吸収
    const normalize = s => String(s || "").toLowerCase().replace(/[\s_-]+/g, "");
    const normalizedHeaders = rawHeaders.map(normalize);
    const colIndex = (candidates) => {
      for (const c of candidates) {
        const target = normalize(c);
        const i = normalizedHeaders.findIndex(h => h === target);
        if (i >= 0) return i;
      }
      return -1;
    };

    const COL = {
      firstName:   colIndex(["First Name", "first_name", "firstname", "FirstName"]),
      lastName:    colIndex(["Last Name",  "last_name",  "lastname",  "LastName"]),
      fullName:    colIndex(["Name", "Full Name", "fullname"]),
      title:       colIndex(["Title", "Job Title", "job_title", "JobTitle"]),
      company:     colIndex(["Company", "Company Name", "company_name", "Organization", "CompanyName"]),
      email:       colIndex(["Verified Email", "verified_email", "Email", "Work Email", "Email Address", "email_address", "WorkEmail"]),
      domain:      colIndex(["Website", "Company Website", "website", "domain", "CompanyWebsite"]),
      linkedin:    colIndex(["LinkedIn Url", "Person Linkedin Url", "linkedin_url", "LinkedIn URL", "LinkedIn", "PersonLinkedinUrl", "LinkedInUrl"]),
      country:     colIndex(["Country", "country"]),
      industry:    colIndex(["Industry", "industry"]),
    };

    const getCell = (cols, idx) => {
      if (idx < 0 || idx >= cols.length) return "";
      return cols[idx].trim().replace(/^["']|["']$/g, "");
    };

    return lines.slice(1).map(line => {
      // シンプルなCSVスプリット（クォート内のカンマ考慮）
      const cols = [];
      let cur = "";
      let inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === "," && !inQ) { cols.push(cur); cur = ""; }
        else cur += ch;
      }
      cols.push(cur);

      const firstName = getCell(cols, COL.firstName);
      const lastName  = getCell(cols, COL.lastName);
      const fullName  = getCell(cols, COL.fullName);
      const name = [firstName, lastName].filter(Boolean).join(" ").trim()
                || fullName
                || "（名前未設定）";

      return {
        name,
        title:      getCell(cols, COL.title),
        company:    getCell(cols, COL.company),
        email:      getCell(cols, COL.email).toLowerCase().trim(),
        domain:     getCell(cols, COL.domain),
        linkedinUrl: getCell(cols, COL.linkedin),
        country:    getCell(cols, COL.country) || "不明",
        industry:   getCell(cols, COL.industry) || "指定なし",
      };
    }).filter(r => r.email || r.linkedinUrl); // メアドかLinkedInのどちらかがあるもの
  };

  // CSV ファイルを実際にパース＆インポートする共通処理
  const processCsvFile = (file) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      alert("CSV ファイル（.csv）を指定してください");
      return;
    }
    setCsvImporting(true);
    setCsvResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseCSV(ev.target.result);

        // 既存CRMとの重複チェック（email と linkedinUrl）
        const existingEmails  = new Set(crm.map(c => (c.email || "").toLowerCase()).filter(Boolean));
        const existingLinkedIn = new Set(crm.map(c => (c.linkedinUrl || c.linkedin || "").toLowerCase()).filter(Boolean));

        let added = 0, skipped = 0;
        const newContacts = [];

        for (const row of parsed) {
          const emailKey = row.email?.toLowerCase() || "";
          const liKey    = row.linkedinUrl?.toLowerCase() || "";

          if ((emailKey && existingEmails.has(emailKey)) ||
              (liKey    && existingLinkedIn.has(liKey))) {
            skipped++;
            continue;
          }

          const id = "csv_" + crypto.randomUUID();
          newContacts.push({
            id,
            name:        row.name,
            title:       row.title       || "",
            company:     row.company     || "",
            email:       row.email       || "",
            linkedin:    row.linkedinUrl || "",
            linkedinUrl: row.linkedinUrl || "",
            country:     row.country     || "不明",
            industry:    row.industry    || "指定なし",
            domain:      row.domain      || "",
            status:      "unverified",   // 未検証ステータス
            notes:       "", clicked: false, opens: 0,
            sentAt: null, subject: "", messageBody: "", trackingId: null, gaData: null,
            addedAt: new Date().toISOString(),
          });

          if (emailKey)  existingEmails.add(emailKey);
          if (liKey)     existingLinkedIn.add(liKey);
          added++;
        }

        if (newContacts.length > 0) {
          setCrm(prev => [...prev, ...newContacts]);
          // Supabase upsert が完了するのを待ってから検証ワーカーをキック
          setTimeout(() => {
            fetch(`${RAILWAY}/webhook/verify-trigger`, { method: "POST" })
              .then(r => r.json())
              .then(d => console.log("verify-trigger:", d))
              .catch(err => console.warn("verify-trigger 失敗:", err.message));
          }, 1500);
        }
        setCsvResult({ added, skipped, total: parsed.length, fileName: file.name });
      } catch (err) {
        alert("CSVパースエラー: " + err.message);
      } finally {
        setCsvImporting(false);
        if (csvInputRef.current) csvInputRef.current.value = "";
      }
    };
    reader.onerror = () => {
      alert("ファイルの読み込みに失敗しました");
      setCsvImporting(false);
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleCsvImport = (e) => {
    processCsvFile(e.target.files?.[0]);
  };

  // ── ドラッグ&ドロップでの CSV インポート ──
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    const onDragEnter = (e) => {
      e.preventDefault();
      // ファイル系のドラッグのみ反応
      if (!e.dataTransfer?.types?.includes("Files")) return;
      dragCounterRef.current++;
      if (dragCounterRef.current === 1) setIsDragging(true);
    };
    const onDragLeave = (e) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    };
    const onDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) processCsvFile(file);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crm]);  // crm を依存に入れて重複判定を最新にする (processCsvFile は同 crm closure を共有)

  // ────────────────────────────────────────────
  // 一括クリーニング
  //   メアドあり → SMTP検証
  //   メアドなし → ドメイン推測 → メアド推測 → SMTP検証
  // ────────────────────────────────────────────
  const handleBulkClean = async () => {
    const targets = crm.filter(c => c.status === "unverified" || c.status === "未送信");
    if (targets.length === 0) {
      alert("未検証・未送信のリードがありません");
      return;
    }
    const withEmail = targets.filter(c => c.email);
    const noEmail   = targets.filter(c => !c.email);
    if (!window.confirm(`${targets.length}件を処理します（メアド検証: ${withEmail.length}件、メアド推測: ${noEmail.length}件）。続行しますか？`)) return;

    setCleaning(true);
    const total = targets.length;
    setCleanProgress({ done: 0, total, valid: 0, invalid: 0 });
    let valid = 0, invalid = 0, done = 0;

    // ── Phase 1: メアドなし → ドメイン推測 → guess-and-verify ──
    if (noEmail.length > 0) {
      // ドメインがない分をまとめてGeminiに投げる
      const needDomain = noEmail.filter(c => !(c.domain || c.guessedDomain));
      let domainMap = {};
      if (needDomain.length > 0) {
        try {
          const r = await fetch(`${RAILWAY}/search/guess-domains`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              candidates: needDomain.map(c => ({
                id: c.id, name: c.name,
                title: c.title || "", company: c.company || "",
                linkedinUrl: c.linkedin || c.linkedinUrl || "",
                rawTitle: (c.rawTitle || "").slice(0, 150),
                rawSnippet: (c.rawSnippet || "").slice(0, 120),
              })),
            }),
          });
          if (r.ok) {
            const d = await r.json();
            domainMap = d.domainMap || {};
            setCrm(prev => prev.map(c => domainMap[c.id] ? { ...c, guessedDomain: domainMap[c.id] } : c));
          }
        } catch (e) { console.warn("ドメイン推測エラー:", e.message); }
      }

      for (let i = 0; i < noEmail.length; i++) {
        const contact = noEmail[i];
        const domain = domainMap[contact.id] || contact.domain || contact.guessedDomain || "";
        if (!domain) {
          invalid++;
          done++;
          setCleanProgress({ done, total, valid, invalid });
          continue;
        }
        const nameParts = (contact.name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName  = nameParts.slice(1).join(" ") || nameParts[0] || "";
        try {
          const r = await fetch(`${RAILWAY}/email/guess-and-verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ firstName, lastName, domain, name: contact.name, candidateId: contact.id }),
          });
          if (r.ok) {
            const d = await r.json();
            const email = d.verifiedEmail || d.bestGuess || null;
            if (email) {
              valid++;
              const newStatus = d.verifiedEmail ? "ready" : "unverified";
              setCrm(prev => prev.map(c => c.id === contact.id ? { ...c, email, status: newStatus } : c));
            } else {
              invalid++;
            }
          } else { invalid++; }
        } catch (e) { console.warn("guess-and-verify エラー:", contact.name, e.message); invalid++; }
        done++;
        setCleanProgress({ done, total, valid, invalid });
        if (i < noEmail.length - 1) await new Promise(r => setTimeout(r, 200));
      }
    }

    // ── Phase 2: メアドあり → SMTP検証 ──
    for (let i = 0; i < withEmail.length; i++) {
      const contact = withEmail[i];
      let newStatus = "invalid";
      try {
        const r = await fetch(`${RAILWAY}/email/verify-single`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: contact.email }),
        });
        if (r.ok) {
          const d = await r.json();
          newStatus = d.unverifiable ? "unverified" : (d.valid ? "ready" : "invalid");
        }
      } catch (e) { console.warn("verify-single エラー:", contact.email, e.message); }
      if (newStatus === "ready") valid++;
      else invalid++;
      setCrm(prev => prev.map(c => c.id === contact.id ? { ...c, status: newStatus } : c));
      done++;
      setCleanProgress({ done, total, valid, invalid });
      if (i < withEmail.length - 1) await new Promise(r => setTimeout(r, 150));
    }

    setCleaning(false);
  };

  const handleAdd = () => {
    if (!form.email) { alert("メールアドレスは必須です"); return; }
    const newContact = {
      id: "manual_" + Date.now(),
      name: form.name || "（名前未設定）", title: form.title || "", company: form.company || "",
      email: form.email, linkedin: form.linkedin || "", country: form.country || "日本",
      industry: form.industry || "指定なし",
      status: "未送信", notes: "", clicked: false, opens: 0,
      sentAt: null, subject: "", messageBody: "", trackingId: null, gaData: null,
      addedAt: new Date().toISOString(),
    };
    setCrm(prev => [...prev, newContact]);
    setForm({ name: "", title: "", company: "", email: "", linkedin: "", country: "日本", industry: "" });
    setShowAddForm(false);
  };

  const unverifiedCount = crm.filter(c => c.status === "unverified" || c.status === "未送信").length;

  const statusFilters = FILTER_OPTIONS.filter(f => f.type === "all" || f.type === "status");
  const gaFilters     = FILTER_OPTIONS.filter(f => f.type === "flag" || f.type === "ga" || f.type === "plan");

  return (
    <div>
      {/* ── ドラッグ&ドロップ オーバーレイ ── */}
      {isDragging && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(24, 95, 165, 0.85)",
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
          backdropFilter: "blur(4px)",
        }}>
          <div style={{
            padding: "32px 48px", borderRadius: 16,
            background: "#fff",
            border: "3px dashed #185FA5",
            textAlign: "center", maxWidth: 520,
          }}>
            <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 12 }}>📥</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#0C447C", marginBottom: 6 }}>
              CSV ファイルをドロップしてインポート
            </div>
            <div style={{ fontSize: 13, color: "#378ADD" }}>
              Apollo / Magically / ExportApollo の CSV 出力に対応
            </div>
          </div>
        </div>
      )}

      {/* ── ツールバー ── */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>フィルター:</span>
              {statusFilters.map((f) => {
                const idx = FILTER_OPTIONS.indexOf(f);
                return (
                  <button key={f.label} onClick={() => setFilterIdx(idx)}
                    style={{ fontSize: 12, padding: "4px 10px", background: filterIdx === idx ? "var(--color-background-secondary)" : undefined, border: filterIdx === idx ? "1px solid var(--color-border-secondary)" : undefined, fontWeight: filterIdx === idx ? 500 : 400 }}>
                    {f.label} ({countFilter(crm, f)})
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>行動:</span>
              {gaFilters.map((f) => {
                const idx   = FILTER_OPTIONS.indexOf(f);
                const count = countFilter(crm, f);
                return (
                  <button key={f.label} onClick={() => setFilterIdx(idx)}
                    style={{ fontSize: 12, padding: "4px 10px", background: filterIdx === idx ? "#EEEDFE" : count > 0 ? "var(--color-background-secondary)" : undefined, color: filterIdx === idx ? "#3C3489" : count > 0 ? "var(--color-text-primary)" : "var(--color-text-tertiary)", border: filterIdx === idx ? "1px solid #CECBF6" : "0.5px solid var(--color-border-tertiary)", fontWeight: filterIdx === idx ? 500 : 400, opacity: count === 0 ? 0.6 : 1 }}>
                    {f.label} ({count})
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap", alignItems: "center" }}>
            {/* ── Chrome拡張 受信ボタン ── */}
            <button
              onClick={extPolling ? stopExtPolling : startExtPolling}
              style={{
                fontSize: 12, padding: "6px 14px",
                background: extPolling ? "#7C3AED" : "#4F46E5",
                color: "#fff", border: "none", borderRadius: 8, fontWeight: 500,
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
              }}>
              {extPolling
                ? <><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#A78BFA", animation: "pulse 1s infinite" }} />🔌 拡張機能受信中（停止）</>
                : "🔌 拡張機能から受信"}
            </button>
            {/* ── CSVインポートボタン ── */}
            <label style={{
              fontSize: 12, padding: "6px 14px",
              background: csvImporting ? "var(--color-background-secondary)" : "#185FA5",
              color: csvImporting ? "var(--color-text-secondary)" : "#fff",
              border: "none", borderRadius: 8, cursor: csvImporting ? "default" : "pointer",
              fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5,
              opacity: csvImporting ? 0.7 : 1,
            }}>
              {csvImporting ? "📥 読み込み中..." : "📥 CSVインポート"}
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                disabled={csvImporting}
                onChange={handleCsvImport}
              />
            </label>
            {/* ── 一括クリーニングボタン ── */}
            <button
              onClick={handleBulkClean}
              disabled={cleaning || unverifiedCount === 0}
              style={{
                fontSize: 12, padding: "6px 14px",
                background: cleaning ? "var(--color-background-secondary)" :
                            unverifiedCount > 0 ? "#27500A" : undefined,
                color: cleaning ? "var(--color-text-secondary)" :
                       unverifiedCount > 0 ? "#fff" : undefined,
                border: unverifiedCount === 0 ? "0.5px solid var(--color-border-tertiary)" : "none",
                borderRadius: 8, fontWeight: 500,
                opacity: (cleaning || unverifiedCount === 0) ? 0.6 : 1,
                cursor: (cleaning || unverifiedCount === 0) ? "default" : "pointer",
              }}>
              {cleaning
                ? `🔍 検証中 ${cleanProgress?.done}/${cleanProgress?.total}件...`
                : `🧹 未検証リストをクリーニング${unverifiedCount > 0 ? ` (${unverifiedCount}件)` : ""}`}
            </button>
            {/* ── Xアカウント一括特定ボタン ── */}
            <button
              onClick={findXAccounts}
              disabled={xFinding || selectedIds.size === 0}
              style={{
                fontSize: 12, padding: "6px 14px",
                background: xFinding ? "var(--color-background-secondary)" :
                            selectedIds.size > 0 ? "#000" : undefined,
                color: xFinding ? "var(--color-text-secondary)" :
                       selectedIds.size > 0 ? "#fff" : undefined,
                border: selectedIds.size === 0 ? "0.5px solid var(--color-border-tertiary)" : "none",
                borderRadius: 8, fontWeight: 500,
                opacity: (xFinding || selectedIds.size === 0) ? 0.6 : 1,
                cursor: (xFinding || selectedIds.size === 0) ? "default" : "pointer",
              }}>
              {xFinding
                ? "🎯 特定中..."
                : `𝕏 Xアカウント一括特定${selectedIds.size > 0 ? ` (${selectedIds.size}件)` : ""}`}
            </button>
            <button onClick={() => setShowAddForm(v => !v)} style={{ fontSize: 12, padding: "6px 14px" }}>
              {showAddForm ? "キャンセル" : "+ 手動で追加"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Apify Webhookバックグラウンド検証ステータス ── */}
      {verifyStatus && (verifyStatus.workerRunning || verifyStatus.unverifiedCount > 0) && (
        <div style={{
          marginBottom: 12, padding: "10px 16px", borderRadius: 8,
          background: verifyStatus.workerRunning ? "#E6F1FB" : "#F5F0FF",
          border: `0.5px solid ${verifyStatus.workerRunning ? "#ADC8E8" : "#C4B5FD"}`,
          display: "flex", alignItems: "center", gap: 10, fontSize: 13,
        }}>
          {verifyStatus.workerRunning ? (
            <>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#185FA5", flexShrink: 0 }} />
              <span style={{ color: "#0C447C" }}>
                🔍 バックグラウンドでメール検証中...
                <strong style={{ marginLeft: 6 }}>未検証: {verifyStatus.unverifiedCount}件</strong>
                <span style={{ fontSize: 11, color: "#378ADD", marginLeft: 8 }}>（自動で ready に更新されます）</span>
              </span>
            </>
          ) : (
            <>
              <span style={{ color: "#4C1D95" }}>
                🔬 未検証リード: <strong>{verifyStatus.unverifiedCount}件</strong>
                <span style={{ fontSize: 11, color: "#6D28D9", marginLeft: 8 }}>（「🧹 クリーニング」ボタンで検証できます）</span>
              </span>
            </>
          )}
        </div>
      )}

      {/* ── Chrome拡張 受信結果バナー ── */}
      {extPolling && (
        <div style={{
          marginBottom: 12, padding: "10px 14px", borderRadius: 8,
          background: "#EDE9FE", border: "0.5px solid #C4B5FD",
          fontSize: 13, color: "#4C1D95",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#7C3AED", flexShrink: 0 }} />
          Chrome拡張からのリードを待機中... Apollo画面で拡張機能を実行してください。
          {extResult && extResult.added > 0 && (
            <strong style={{ marginLeft: 8 }}>✅ {extResult.added}件追加済み</strong>
          )}
        </div>
      )}
      {!extPolling && extResult && extResult.added > 0 && (
        <div style={{
          marginBottom: 12, padding: "10px 14px", borderRadius: 8,
          background: "#EDE9FE", color: "#4C1D95", fontSize: 13,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>🔌 拡張機能から <strong>{extResult.added}件</strong> 追加、スキップ（重複）: {extResult.skipped}件</span>
          <button onClick={() => setExtResult(null)} style={{ fontSize: 11, background: "none", border: "none", cursor: "pointer", color: "inherit" }}>✕</button>
        </div>
      )}

      {/* ── Xアカウント特定 結果バナー ── */}
      {xFindResult && (
        <div style={{
          marginBottom: 12, padding: "10px 14px", borderRadius: 8,
          background: xFindResult.found > 0 ? "#000" : "#F1EFE8",
          color: xFindResult.found > 0 ? "#fff" : "#444441",
          fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>
            𝕏 Xアカウント特定完了 — マッチ: <strong>{xFindResult.found}件</strong> / 対象 {xFindResult.total}件
            {xFindResult.found > 0 && " — 各リードに𝕏リンクが追加されました"}
          </span>
          <button onClick={() => setXFindResult(null)}
            style={{ fontSize: 11, background: "none", border: "none", cursor: "pointer", color: "inherit", padding: "0 4px" }}>✕</button>
        </div>
      )}

      {/* ── CSV インポート結果バナー ── */}
      {csvResult && (
        <div style={{
          marginBottom: 12, padding: "10px 14px", borderRadius: 8,
          background: csvResult.added > 0 ? "#EAF3DE" : "#F1EFE8",
          color: csvResult.added > 0 ? "#27500A" : "#444441",
          fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>
            ✅ CSVインポート完了 — 新規追加: <strong>{csvResult.added}件</strong>、
            スキップ（重複）: {csvResult.skipped}件 / 合計 {csvResult.total}件
            {csvResult.added > 0 && " — ステータス「unverified」で追加されました"}
          </span>
          <button onClick={() => setCsvResult(null)}
            style={{ fontSize: 11, background: "none", border: "none", cursor: "pointer", color: "inherit", padding: "0 4px" }}>✕</button>
        </div>
      )}

      {/* ── クリーニング進捗バー ── */}
      {cleaning && cleanProgress && (
        <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 8, background: "#E6F1FB", border: "0.5px solid #ADC8E8" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, color: "#0C447C", fontWeight: 500 }}>
            <span>🔍 メール検証中...</span>
            <span>{cleanProgress.done} / {cleanProgress.total}件</span>
          </div>
          <div style={{ height: 6, background: "#BDD6EF", borderRadius: 100, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 100,
              width: `${(cleanProgress.done / cleanProgress.total) * 100}%`,
              background: "#185FA5", transition: "width .2s",
            }} />
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#378ADD" }}>
            ✓ 有効: {cleanProgress.valid}件 &nbsp;·&nbsp; ✗ 無効: {cleanProgress.invalid}件
          </div>
        </div>
      )}

      {/* ── クリーニング完了バナー ── */}
      {!cleaning && cleanProgress && cleanProgress.done === cleanProgress.total && cleanProgress.total > 0 && (
        <div style={{
          marginBottom: 12, padding: "10px 14px", borderRadius: 8,
          background: "#EAF3DE", color: "#27500A", fontSize: 13,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>
            ✅ クリーニング完了 — 送信待ち（ready）: <strong>{cleanProgress.valid}件</strong>、
            無効（invalid）: {cleanProgress.invalid}件 / 合計 {cleanProgress.total}件
          </span>
          <button onClick={() => setCleanProgress(null)}
            style={{ fontSize: 11, background: "none", border: "none", cursor: "pointer", color: "inherit", padding: "0 4px" }}>✕</button>
        </div>
      )}

      {showAddForm && (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 12px", fontWeight: 500, fontSize: 14 }}>連絡先を手動追加</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>名前</label><input placeholder="山田 太郎" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }} /></div>
            <div><label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>メールアドレス *</label><input type="email" placeholder="example@company.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }} /></div>
            <div><label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>役職</label><input placeholder="CEO" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }} /></div>
            <div><label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>会社名</label><input placeholder="株式会社〇〇" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }} /></div>
            <div><label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>LinkedIn URL（任意）</label><input placeholder="https://linkedin.com/in/..." value={form.linkedin} onChange={e => setForm(f => ({ ...f, linkedin: e.target.value }))} style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }} /></div>
            <div><label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>業界（任意）</label><input placeholder="SaaS / ソフトウェア" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }} /></div>
          </div>
          <div style={{ marginTop: 14 }}><button onClick={handleAdd} style={{ padding: "7px 20px" }}>追加する</button></div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card><p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: 0 }}>{activeFilter.type === "all" ? "リストが空です。「手動で追加」または企業検索タブから追加してください。" : `「${activeFilter.label}」に該当するリストがありません。`}</p></Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* ── 全選択チェックボックス ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px" }}>
            <input
              type="checkbox"
              checked={selectedIds.size === filtered.length && filtered.length > 0}
              onChange={() => toggleSelectAll(filtered.map(p => p.id))}
              style={{ cursor: "pointer", width: 14, height: 14 }}
            />
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {selectedIds.size > 0 ? `${selectedIds.size}件選択中` : "全選択"}
            </span>
          </div>
          {filtered.map(p => (
            <Card key={p.id}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(p.id)}
                  onChange={() => toggleSelect(p.id)}
                  style={{ cursor: "pointer", marginTop: 3, width: 14, height: 14, flexShrink: 0 }}
                />
                <Avatar name={p.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{p.name}</p>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{p.title} · {p.company}</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <ScoreBadge score={calcScore(p)} />
                      <select value={p.status} onChange={e => update(p.id, "status", e.target.value)} style={{ fontSize: 12, padding: "3px 6px" }}>
                        {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                      </select>
                      <button onClick={() => remove(p.id)} style={{ fontSize: 11, color: "var(--color-text-danger)", border: "0.5px solid var(--color-border-danger)", padding: "3px 8px" }}>削除</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {/* メアド: クリックで編集可能 */}
                    {editingEmailId === p.id ? (
                      <input
                        autoFocus
                        type="email"
                        value={editingEmailValue}
                        placeholder="メアドを入力（空欄で削除）"
                        onChange={e => setEditingEmailValue(e.target.value)}
                        onBlur={() => saveEmailEdit(p)}
                        onKeyDown={e => {
                          if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
                          if (e.key === "Escape") { setEditingEmailId(null); }
                        }}
                        style={{
                          fontSize: 11, padding: "2px 6px",
                          border: "1px solid #185FA5", borderRadius: 4,
                          minWidth: 220, background: "#fff",
                        }}
                      />
                    ) : (
                      <span
                        onClick={() => { setEditingEmailId(p.id); setEditingEmailValue(p.email || ""); }}
                        title={p.email ? "クリックして編集" : "クリックしてメアドを入力"}
                        style={{
                          fontSize: 11,
                          color: p.email ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                          cursor: "pointer",
                          padding: "1px 4px",
                          borderRadius: 4,
                          borderBottom: "1px dashed transparent",
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderBottom = "1px dashed var(--color-text-secondary)"}
                        onMouseLeave={e => e.currentTarget.style.borderBottom = "1px dashed transparent"}
                      >
                        {p.email || "✏️ メアド未入力（クリックで追加）"}
                      </span>
                    )}
                    {reverifyingId === p.id && (
                      <span style={{ fontSize: 10, color: "#7C3AED" }}>🔍 再検証中...</span>
                    )}
                    {p.linkedin && <a href={p.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>LinkedIn ↗</a>}
                    {p.xUrl && (
                      <a href={p.xUrl} target="_blank" rel="noreferrer"
                        style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#000", padding: "1px 7px", borderRadius: 4, textDecoration: "none", letterSpacing: "-0.5px" }}>
                        𝕏
                      </a>
                    )}
                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{p.industry} · {p.country}</span>
                    {p.status === "unverified" && <span style={{ fontSize: 11, background: "#F5F0FF", color: "#6B21A8", padding: "2px 7px", borderRadius: 4, fontWeight: 500 }}>🔬 未検証</span>}
                    {p.status === "ready"      && <span style={{ fontSize: 11, background: "#DCFCE7", color: "#166534", padding: "2px 7px", borderRadius: 4, fontWeight: 500 }}>✅ 送信待ち</span>}
                    {p.status === "invalid"    && <span style={{ fontSize: 11, background: "#FEE2E2", color: "#991B1B", padding: "2px 7px", borderRadius: 4, fontWeight: 500 }}>❌ 無効</span>}
                    {p.clicked && <span style={{ fontSize: 11, background: "#FAEEDA", color: "#633806", padding: "2px 6px", borderRadius: 4 }}>🔗 クリック済</span>}
                    {(p.opens || 0) >= 2 && <span style={{ fontSize: 11, background: "#E6F1FB", color: "#0C447C", padding: "2px 6px", borderRadius: 4 }}>📩 {p.opens}回開封</span>}
                    {p.gaData?.sessions >= 1 && <span style={{ fontSize: 11, background: "#EAF3DE", color: "#27500A", padding: "2px 6px", borderRadius: 4 }}>🌐 サイト訪問 {p.gaData.sessions}回</span>}
                    {p.gaData?.pageViews >= 2 && <span style={{ fontSize: 11, background: "#E6F1FB", color: "#185FA5", padding: "2px 6px", borderRadius: 4 }}>📄 {p.gaData.pageViews}ページ閲覧</span>}
                    {p.gaData?.scrolledUsers >= 1 && <span style={{ fontSize: 11, background: "#F1EFE8", color: "#444441", padding: "2px 6px", borderRadius: 4 }}>📜 スクロール済み</span>}
                    {p.gaData?.conversions >= 1 && <CvBadge />}
                    {p.gaData?.planStatus && <PlanBadge planStatus={p.gaData.planStatus} planScore={p.gaData.planScore} />}
                  </div>
                  <textarea placeholder="メモを入力..." value={p.notes || ""} onChange={e => update(p.id, "notes", e.target.value)} rows={1}
                    style={{ marginTop: 8, width: "100%", boxSizing: "border-box", fontSize: 12, resize: "vertical", fontFamily: "inherit", padding: "6px 8px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6, background: "var(--color-background-secondary)", color: "var(--color-text-primary)" }} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// AI訴求生成コンポーネント（カテゴリ別、A/Bテスト連携）
// ════════════════════════════════════════════════════════════
function AICopyPanel({ settings, crm, onApply, onSendToABTest }) {
  const [selCategory, setSelCategory] = useState(null);
  const [patCount, setPatCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [variants, setVariants] = useState([]);
  const [selVariant, setSelVariant] = useState(null);
  const [checkedVariants, setCheckedVariants] = useState(new Set());
  const [thinkLog, setThinkLog] = useState([]);
  const [error, setError] = useState("");

  const category = AI_COPY_CATEGORIES.find(c => c.key === selCategory);
  const targets = category ? crm.filter(category.filter) : [];

  const catStats = crm.length > 0 ? AI_COPY_CATEGORIES.map(cat => ({
    ...cat,
    count: crm.filter(cat.filter).length,
    avgScore: (() => {
      const members = crm.filter(cat.filter);
      return members.length ? Math.round(members.reduce((s, c) => s + calcScore(c), 0) / members.length) : 0;
    })(),
  })) : AI_COPY_CATEGORIES.map(cat => ({ ...cat, count: 0, avgScore: 0 }));

  function buildPrompt(cat, targets) {
    const samples = targets.slice(0, 3).map(t =>
      `・${t.name}（${t.title || "役職不明"}）/ ${t.company || "会社不明"} / 業界:${t.industry || "不明"} / フェーズ:${inferPhase(t)} / スコア:${calcScore(t)}pt / 開封:${t.opens || 0}回 / 訪問:${t.gaData?.sessions || 0}回 / status:${t.status}`
    ).join("\n");
    const avgScore = targets.length
      ? Math.round(targets.reduce((s, t) => s + calcScore(t), 0) / targets.length)
      : 0;

    // セグメント内のプラン分布を集計(Sandbox が多いか、未送信が多いかなど)
    const phaseDist = {};
    targets.forEach(t => { const p = inferPhase(t); phaseDist[p] = (phaseDist[p] || 0) + 1; });

    return `You are a world-class B2B sales copywriter. Based on the information below, generate ${patCount} high-converting cold email subject lines and body copies IN ENGLISH.

${buildBusinessProfile(settings)}

[TARGET SEGMENT]
Segment: ${cat.label}
Description: ${cat.desc}
Recipients: ${targets.length} / Avg score: ${avgScore}pt
Phase distribution: ${JSON.stringify(phaseDist)}

[SAMPLE RECIPIENTS]
${samples || "(no data)"}

[MESSAGING STRATEGY]
${cat.strategy}

[GENERATION RULES]
- Write ENTIRELY IN ENGLISH — no Japanese, no mixed language
- Use {{name}} and {{company}} as placeholders
- Subject: Max 50 characters. Maximize open rate — use curiosity, personalization, or a specific number
- Body: 120–180 words. One clear CTA. Conversational and direct.
- Vary the angle across patterns (scarcity, social proof, loss aversion, curiosity, ROI, personalization, etc.)
- Reference our service specifics naturally:
    • For Web3 / crypto / DeFi / stablecoin companies: emphasize cost reduction (effective rate as low as 0.19% vs legacy 1.5%+$0.25/tx), multi-chain support, automated tax/accounting reporting
    • For online casinos / iGaming: emphasize unlimited volume (Enterprise), compliance, fast settlement
    • For OTC desks: emphasize high-volume handling, real-time reporting, low effective rate
    • For Seed/early-stage: emphasize Sandbox (free up to $50K) → Professional ($1,980/mo, up to $500K)
    • For Series A/B: emphasize Corporate ($9,800/mo, up to $5M, 0.19% effective rate)
- The segment phase (${cat.key}) determines urgency and CTA:
    • cold/warm → drive to free Sandbox signup or LP visit
    • engaged/sandbox → push upgrade to Professional or schedule demo
    • replied/negotiating → close with specific plan ROI or limited offer
- Strictly avoid any keywords in the exclusion list if provided
- Prioritize keywords from the emphasis list if provided

[OUTPUT FORMAT] (${patCount} patterns, nothing else)
===PATTERN_START===
ANGLE:[hook angle in 10 words or less]
PRED_OPEN:[predicted open rate % as number only]
PRED_CTR:[predicted CTR % as number only]
SUBJECT:[subject line]
BODY:
[email body]
===PATTERN_END===`;
  }

  function parseVariants(text) {
    return text.split("===PATTERN_START===").slice(1).map((b, idx) => {
      const end = b.indexOf("===PATTERN_END===");
      const c   = end >= 0 ? b.slice(0, end) : b;
      const angle    = (c.match(/ANGLE:\s*(.+)/)     || [])[1]?.trim() || "訴求";
      const predOpen = parseFloat((c.match(/PRED_OPEN:\s*(\d+\.?\d*)/) || [])[1]) || 0;
      const predCtr  = parseFloat((c.match(/PRED_CTR:\s*(\d+\.?\d*)/)  || [])[1]) || 0;
      const subject  = (c.match(/SUBJECT:\s*(.+)/)   || [])[1]?.trim() || "";
      const bm       = c.match(/BODY:\s*([\s\S]+)/);
      const body     = bm ? bm[1].replace(/===PATTERN_END===/g, "").trim() : "";
      return { id: `v_${Date.now()}_${idx}`, label: `${angle}`, angle, predOpen, predCtr, subject, body };
    }).filter(v => v.subject && v.body);
  }

  async function generate() {
    if (!category) { alert("カテゴリを選択してください"); return; }
    if (targets.length === 0) { alert("このカテゴリに該当するユーザーがいません"); return; }
    setGenerating(true);
    setVariants([]); setSelVariant(null); setCheckedVariants(new Set()); setError("");

    const steps = [
      { label: "セグメント分析", text: `「${category.label}」: ${targets.length}名 / 平均スコア: ${Math.round(targets.reduce((s, t) => s + calcScore(t), 0) / targets.length)}pt` },
      { label: "訴求戦略決定",  text: category.strategy },
      { label: "Claude API 呼び出し", text: `${patCount}パターンをストリーミング生成中...` },
    ];
    setThinkLog(steps.map((s, i) => ({ ...s, state: i === 0 ? "active" : "pending" })));
    for (let i = 0; i < steps.length - 1; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 600 : 700));
      setThinkLog(prev => prev.map((s, idx) =>
        idx === i ? { ...s, state: "done" } : idx === i + 1 ? { ...s, state: "active" } : s
      ));
    }

    try {
      const full = await callClaude({ prompt: buildPrompt(category, targets), maxTokens: 1200, stream: true });
      const parsed = parseVariants(full);
      if (!parsed.length) throw new Error("パターンの解析に失敗しました。再生成してください。");
      setVariants(parsed);
      setThinkLog(prev => prev.map(s => ({ ...s, state: "done" })));
    } catch (e) {
      setError("エラー: " + e.message);
      setThinkLog(prev => prev.map(s => ({ ...s, state: s.state === "done" ? "done" : "idle" })));
    }
    setGenerating(false);
  }

  const scColor = (v) => {
    if (v >= 40) return { bg: "#EAF3DE", color: "#27500A" };
    if (v >= 30) return { bg: "#FAEEDA", color: "#633806" };
    return { bg: "#F1EFE8", color: "#444441" };
  };

  const toggleCheck = (id) => {
    setCheckedVariants(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const checkedList = variants.filter(v => checkedVariants.has(v.id));

  return (
    <div>
      <Section title="ターゲットカテゴリを選択">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {catStats.map(cat => (
            <div key={cat.key}
              onClick={() => { setSelCategory(cat.key); setVariants([]); setSelVariant(null); setError(""); setCheckedVariants(new Set()); }}
              style={{
                padding: "0.875rem 1rem", borderRadius: 10, cursor: "pointer",
                border: selCategory === cat.key ? `2px solid ${cat.color.color}` : "0.5px solid var(--color-border-tertiary)",
                background: selCategory === cat.key ? cat.color.bg : "var(--color-background-primary)",
                transition: "all .15s", opacity: cat.count === 0 ? 0.5 : 1,
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: selCategory === cat.key ? cat.color.color : "var(--color-text-primary)" }}>{cat.label}</span>
                <span style={{ fontSize: 11, fontWeight: 500, padding: "1px 7px", borderRadius: 100, background: cat.color.bg, color: cat.color.color }}>{cat.count}名</span>
              </div>
              <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.5 }}>{cat.desc}</p>
              {cat.avgScore > 0 && <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>平均スコア {cat.avgScore}pt</p>}
            </div>
          ))}
        </div>
      </Section>

      {selCategory && targets.length > 0 && (
        <>
          <Card style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 2px" }}>
                  対象: <span style={{ color: category?.color.color }}>{category?.label}</span> — {targets.length}名
                </p>
                <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0 }}>{category?.strategy}</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>生成数:</span>
                {[3, 5, 7].map(n => (
                  <button key={n} onClick={() => setPatCount(n)}
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 100, background: patCount === n ? "#185FA5" : "transparent", color: patCount === n ? "#fff" : "var(--color-text-secondary)", border: patCount === n ? "none" : "0.5px solid var(--color-border-secondary)" }}>
                    {n}パターン
                  </button>
                ))}
                <button onClick={generate} disabled={generating}
                  style={{ padding: "7px 16px", background: generating ? undefined : "var(--color-text-primary)", color: "var(--color-background-primary)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: generating ? "default" : "pointer", opacity: generating ? 0.5 : 1 }}>
                  {generating ? "生成中..." : "AI で生成"}
                </button>
              </div>
            </div>
          </Card>

          {thinkLog.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              {thinkLog.map((s, i) => (
                <div key={i} style={{
                  padding: "8px 12px", borderLeft: `2px solid ${s.state === "done" ? "#1D9E75" : s.state === "active" ? "#378ADD" : "var(--color-border-tertiary)"}`,
                  marginBottom: 6, borderRadius: "0 6px 6px 0",
                  background: "var(--color-background-secondary)",
                  fontSize: 12, lineHeight: 1.6,
                  color: s.state === "done" ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                }}>
                  <strong style={{ fontSize: 11 }}>{s.label}</strong><br />{s.text}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FCEBEB", color: "#791F1F", fontSize: 13, marginBottom: "1rem" }}>{error}</div>
          )}

          {variants.length > 0 && (
            <Section title={`生成された訴求バリアント — ${category?.label}`}
              right={checkedList.length >= 2 && onSendToABTest ? (
                <button onClick={() => onSendToABTest(checkedList, category)}
                  style={{ fontSize: 12, padding: "6px 14px", background: "#3C3489", color: "#fff", border: "none", borderRadius: 8 }}>
                  選択した {checkedList.length} パターンでA/Bテスト →
                </button>
              ) : variants.length >= 2 ? (
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>☐ を2つ以上チェックで A/Bテスト可</span>
              ) : null}>
              {variants.map((v, i) => {
                const oc = scColor(v.predOpen), cc = scColor(v.predCtr);
                const checked = checkedVariants.has(v.id);
                return (
                  <div key={v.id}
                    style={{
                      padding: "1rem", borderRadius: 10, marginBottom: 8,
                      border: selVariant === i ? "1.5px solid #378ADD" : checked ? "1.5px solid #3C3489" : "0.5px solid var(--color-border-tertiary)",
                      background: selVariant === i ? "#E6F1FB" : checked ? "#EEEDFE" : "var(--color-background-primary)",
                      transition: "all .15s",
                    }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleCheck(v.id)} style={{ cursor: "pointer" }} />
                        <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 6, background: "#EEEDFE", color: "#3C3489" }}>{v.angle}</span>
                      </div>
                      <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 7px", borderRadius: 100, background: oc.bg, color: oc.color }}>開封 {v.predOpen}%</span>
                        <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 7px", borderRadius: 100, background: cc.bg, color: cc.color }}>CTR {v.predCtr}%</span>
                      </div>
                    </div>
                    <div onClick={() => setSelVariant(selVariant === i ? null : i)} style={{ cursor: "pointer" }}>
                      <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 5px" }}>{v.subject}</p>
                      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.6 }}>
                        {v.body.slice(0, 160)}{v.body.length > 160 ? "..." : ""}
                      </p>
                    </div>

                    {selVariant === i && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                        <div style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>件名（編集可）</label>
                          <textarea defaultValue={v.subject} rows={2}
                            onChange={ev => { variants[i].subject = ev.target.value; }}
                            style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 13, padding: "7px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, background: "var(--color-background-primary)", resize: "vertical" }} />
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>本文（編集可）</label>
                          <textarea defaultValue={v.body} rows={5}
                            onChange={ev => { variants[i].body = ev.target.value; }}
                            style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 13, padding: "7px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, background: "var(--color-background-primary)", resize: "vertical", lineHeight: 1.65 }} />
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button onClick={() => onApply(v.subject, v.body)} style={{ fontSize: 12, padding: "6px 14px", background: "var(--color-text-primary)", color: "var(--color-background-primary)", border: "none", borderRadius: 8 }}>
                            メール送信タブに反映
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>
          )}
        </>
      )}

      {selCategory && targets.length === 0 && (
        <Card>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: 0 }}>
            このカテゴリに該当するユーザーがいません。リストにデータを追加してください。
          </p>
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab: メール送信（PDCA prefill 対応 / campaign 対応）
// ════════════════════════════════════════════════════════════
function EmailTab({ settings, crm, setCrm, prefill, onClearPrefill, onNavigateTo }) {
  // ── チャンネル切替: "email" | "linkedin" ──
  const [channel, setChannel] = useState("email");

  // ── メール送信 state ──
  const [groupIdx, setGroupIdx] = useState(1);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [selected, setSelected] = useState([]);
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState([]);
  const [sendSummary, setSendSummary] = useState(null);
  const [genLoading, setGenLoading] = useState(false);
  const [showAICopy, setShowAICopy] = useState(false);
  const [quota, setQuota] = useState(null);

  // ── LinkedIn 送信 state ──
  const [liGroupIdx, setLiGroupIdx] = useState(0);
  const [liMessage, setLiMessage] = useState("");
  const [liGenLoading, setLiGenLoading] = useState(false);
  const [liSelected, setLiSelected] = useState([]);
  const [liSending, setLiSending] = useState(false);
  const [liResults, setLiResults] = useState([]);
  const [liPreview, setLiPreview] = useState(false);
  const [liStatus, setLiStatus] = useState(null); // Unipile 設定状況

  // prefill: PDCAタブ or AICopyPanel からの流し込み
  useEffect(() => {
    if (prefill?.subject)      setSubject(prefill.subject);
    if (prefill?.body)         setBody(prefill.body);
    if (prefill?.campaignName) setCampaignName(prefill.campaignName);
    if (prefill?.segmentLabel) {
      // EMAIL_GROUPS の中から一致するラベルを探す
      const idx = EMAIL_GROUPS.findIndex(g => g.label === prefill.segmentLabel);
      if (idx >= 0) setGroupIdx(idx);
    }
    if (prefill?.subject || prefill?.body || prefill?.segmentLabel) {
      if (onClearPrefill) onClearPrefill();
    }
  }, [prefill?.subject, prefill?.body, prefill?.segmentLabel, prefill?.campaignName]);

  // 送信残量の確認
  useEffect(() => {
    fetch(`${LOCAL_SEND}/health`).then(r => r.json()).then(d => setQuota(d.quota)).catch(() => {});
  }, []);

  // Unipile (LinkedIn) 設定状況確認
  useEffect(() => {
    fetch(`${RAILWAY}/linkedin/status`)
      .then(r => r.json())
      .then(d => setLiStatus(d))
      .catch(() => {});
  }, []);

  const targets = crm.filter(EMAIL_GROUPS[groupIdx].filter);

  const handleGroupChange = (idx) => { setGroupIdx(idx); setSelected([]); };
  const toggleSelect = id => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const selectAll = () => setSelected(targets.map(t => t.id));
  const clearAll  = () => setSelected([]);

  const generateMessage = async () => {
    if (!settings.myService) { alert("設定タブで自社情報を入力してください"); return; }
    setGenLoading(true);
    try {
      const text = await callClaude({
        prompt: `以下の情報をもとに、B2B営業のコールドメールの件名と本文を日本語で作成してください。

${buildBusinessProfile(settings)}

要件:
- 件名は30文字以内、開封率を最大化するキーワードを含める
- 本文は120〜180文字程度、1つのCTAに絞る
- 押し付けがましくなく、相手への価値提供(具体的な数字や差別化ポイント)を軸にする
- {{name}}と{{company}}はプレースホルダーとして使用
- 上記プロファイルの「訴求で強調したいキーワード」があれば盛り込み、「使ってはいけない表現」は絶対に使わない
- LP URLを自然に含める({{name}}さま限定、のような誘導でも可)

以下のフォーマットで返してください（それ以外のテキストは不要）:
件名: [件名]
本文:
[本文]`,
        maxTokens: 800,
      });
      const sm = text.match(/件名[:：]\s*(.+)/);
      const bm = text.match(/本文[:：]\s*([\s\S]+)/);
      if (sm) setSubject(sm[1].trim());
      if (bm) setBody(bm[1].trim());
    } catch (e) { alert("メッセージ生成に失敗しました: " + e.message); }
    setGenLoading(false);
  };

  const openPreview = () => {
    if (!subject || !body) { alert("件名と本文を入力してください"); return; }
    if (selected.length === 0) { alert("送信先を選択してください"); return; }
    setPreview(true); setResults([]); setSendSummary(null);
  };

  const sendEmails = async () => {
    setSending(true);
    const selectedTargets = targets.filter(t => selected.includes(t.id));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10分

    try {
      const autoCampaign = campaignName || `${EMAIL_GROUPS[groupIdx].label} ${new Date().toISOString().slice(5,16)}`;
      let res;
      try {
        res = await fetch(`${LOCAL_SEND}/send-emails`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            campaignName: autoCampaign,
            segment: EMAIL_GROUPS[groupIdx].label,
            variants: [{ label: "single", angle: "single", subject, body, predOpen: 0, predCtr: 0 }],
            recipients: selectedTargets.map(t => ({
              name: t.name, email: t.email, company: t.company, id: t.id,
              industry: t.industry, country: t.country, title: t.title,
            })),
          }),
        });
      } catch (fetchErr) {
        // ネットワークエラー = ローカルサーバーが起動していない
        clearTimeout(timeoutId);
        alert(
          "❌ ローカル送信サーバーに接続できません\n\n" +
          "ターミナルで以下を実行してください:\n" +
          "  node server_local.js\n\n" +
          "起動後にもう一度「送信開始」を押してください。"
        );
        setSending(false);
        setPreview(false);
        return;
      }
      clearTimeout(timeoutId);

      // レスポンスがJSONでない場合（HTMLエラーページ等）を先に検出
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const raw = await res.text();
        throw new Error(`サーバーが不正なレスポンスを返しました (${res.status})。ローカルサーバーのログを確認してください。\n\n${raw.slice(0, 200)}`);
      }

      if (!res.ok) { const errText = await res.text(); throw new Error(`サーバーエラー: ${res.status} — ${errText}`); }
      const data = await res.json();

      const newResults = data.results.map(r => {
        const target = selectedTargets.find(t => t.email === r.email);
        if (r.ok && target) {
          setCrm(prev => prev.map(c => c.id === target.id ? {
            ...c,
            status: "送信済み",
            sentAt: new Date().toISOString(),
            subject, messageBody: body,
            trackingId: r.trackingId,
            campaignId: r.campaignId,
            variantId: r.variantId,
          } : c));
        }
        return { id: target?.id, name: target?.name, email: r.email, ok: r.ok, error: r.error };
      });
      setResults(newResults);
      setSendSummary({ campaignName: data.campaignName, campaignId: data.campaignId, variants: data.variants });
      setQuota(data.quota);
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === "AbortError") alert("送信がタイムアウトしました。サーバーの状態を確認してください。");
      else alert("送信失敗: " + e.message);
    }
    setSending(false);
    setPreview(false);
    setSelected([]);
  };

  const firstTarget = targets.find(t => t.id === selected[0]);

  // ── LinkedIn: メッセージ生成 ──
  const generateLinkedInMessage = async () => {
    if (!settings.myService) { alert("設定タブで自社情報を入力してください"); return; }
    setLiGenLoading(true);
    try {
      const text = await callClaude({
        prompt: `以下の情報をもとに、LinkedIn コネクションリクエストに添えるメッセージを日本語で作成してください。

${buildBusinessProfile(settings)}

【ルール】
- 300文字以内（厳守）
- 押し付けがましくなく、価値提供・共通点から入る
- CTAは「お繋がりできれば幸いです」程度の低摩擦に留める
- プレースホルダー不要。汎用的な書き方にする
- 本文のみ返す（説明文・Markdown不要）`,
        maxTokens: 400,
      });
      setLiMessage(text.trim().slice(0, 300));
    } catch (e) { alert("生成失敗: " + e.message); }
    setLiGenLoading(false);
  };

  // ── LinkedIn: 送信実行 ──
  const sendLinkedInMessages = async () => {
    const liTargets = crm.filter(LINKEDIN_GROUPS[liGroupIdx].filter).filter(t => liSelected.includes(t.id));
    if (!liTargets.length) return;
    setLiSending(true);
    const newResults = [];
    for (const t of liTargets) {
      try {
        const res = await fetch(`${RAILWAY}/linkedin/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipientId: t.id,
            name: t.name, title: t.title, company: t.company,
            linkedinUrl: t.linkedin || t.linkedinUrl,
            messageBody: liMessage,
            industry: t.industry, country: t.country,
            settings,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          setCrm(prev => prev.map(c => c.id === t.id ? {
            ...c,
            status:      "送信済み",
            sentAt:      new Date().toISOString(),
            messageBody: data.messageUsed,
            trackingId:  data.trackingId,
          } : c));
          newResults.push({ id: t.id, name: t.name, ok: true, trackingId: data.trackingId, messageUsed: data.messageUsed });
        } else {
          newResults.push({ id: t.id, name: t.name, ok: false, error: data.error });
        }
      } catch (e) {
        newResults.push({ id: t.id, name: t.name, ok: false, error: e.message });
      }
      await new Promise(r => setTimeout(r, 600)); // Unipile レート制限対策
    }
    setLiResults(prev => [...prev, ...newResults]);
    setLiSending(false);
    setLiPreview(false);
    setLiSelected([]);
  };

  return (
    <div>
      {/* ════ チャンネル切替タブ ════ */}
      <div style={{ display: "flex", gap: 0, marginBottom: "1.25rem", borderBottom: "1px solid var(--color-border-tertiary)" }}>
        {[
          { key: "email",    label: "📧 メール送信" },
          { key: "linkedin", label: "💼 LinkedIn送信" },
        ].map(({ key, label }) => {
          const liPending = crm.filter(c => c.status === "LinkedIn送信待ち").length;
          return (
            <button key={key} onClick={() => setChannel(key)}
              style={{
                fontSize: 13, padding: "8px 20px", border: "none", cursor: "pointer",
                borderBottom: channel === key
                  ? `2px solid ${key === "linkedin" ? "#0A66C2" : "#185FA5"}`
                  : "2px solid transparent",
                background: "transparent",
                color: channel === key
                  ? (key === "linkedin" ? "#0A66C2" : "#185FA5")
                  : "var(--color-text-secondary)",
                fontWeight: channel === key ? 500 : 400,
              }}>
              {label}
              {key === "linkedin" && liPending > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 100, background: "#0A66C2", color: "#fff" }}>
                  {liPending}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ════ LinkedIn 送信チャンネル ════ */}
      {channel === "linkedin" && (
        <div>
          {/* Unipile ステータスバー */}
          <Card style={{
            marginBottom: "1rem", padding: "0.625rem 1rem",
            background: liStatus?.configured ? "#EEF5FB" : "#FEF9E7",
            border: `0.5px solid ${liStatus?.configured ? "#0A66C2" : "#D4AC0D"}`,
            display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>{liStatus?.configured ? "💼" : "⚠️"}</span>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: liStatus?.configured ? "#0A66C2" : "#7D6608" }}>
                  {liStatus?.configured ? "Unipile (LinkedIn) 接続済み" : "Unipile 未設定"}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>
                  {liStatus?.configured
                    ? `Account ID: ${liStatus.accountId} · ${liStatus.baseUrl}`
                    : (liStatus?.hint || "Railway の環境変数に UNIPILE_API_KEY と UNIPILE_ACCOUNT_ID を設定してください")}
                </p>
              </div>
            </div>
            {liStatus?.configured && (
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: "#E8F4FD", color: "#0A66C2", fontWeight: 500 }}>
                LinkedIn API Active
              </span>
            )}
          </Card>

          {/* グループ選択 */}
          <Section title="送信グループ">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {LINKEDIN_GROUPS.map((g, i) => {
                const cnt = crm.filter(g.filter).length;
                return (
                  <button key={i} onClick={() => { setLiGroupIdx(i); setLiSelected([]); }}
                    style={{
                      fontSize: 12, padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                      background: liGroupIdx === i ? "#0A66C2" : "transparent",
                      color: liGroupIdx === i ? "#fff" : "var(--color-text-secondary)",
                      border: liGroupIdx === i ? "none" : "0.5px solid var(--color-border-secondary)",
                    }}>
                    {g.label}
                    <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>({cnt})</span>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* メッセージ作成 */}
          <Section title="招待状メッセージ（300文字以内）">
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{
                  fontSize: 12, fontWeight: 500,
                  color: liMessage.length > 285 ? "#E24B4A" : liMessage.length > 240 ? "#D4AC0D" : "var(--color-text-secondary)",
                }}>
                  {liMessage.length} / 300文字
                  {liMessage.length > 285 && " ⚠ 上限まで残り僅か"}
                </span>
                <button onClick={generateLinkedInMessage} disabled={liGenLoading}
                  style={{ fontSize: 12, padding: "6px 14px" }}>
                  {liGenLoading ? "生成中..." : "✨ AIで自動生成"}
                </button>
              </div>
              <textarea
                value={liMessage}
                onChange={e => setLiMessage(e.target.value.slice(0, 300))}
                rows={5}
                placeholder="LinkedIn コネクションリクエストに添えるメッセージを入力（300文字以内）&#10;&#10;例: 初めてご連絡いたします。[会社名]の[担当者名]と申します。貴社の取り組みに大変共感しており、ぜひお繋がりさせていただければ幸いです。"
                style={{
                  width: "100%", boxSizing: "border-box", resize: "vertical",
                  fontFamily: "inherit", fontSize: 14, padding: "8px 10px",
                  border: `0.5px solid ${liMessage.length > 285 ? "#E24B4A" : "var(--color-border-secondary)"}`,
                  borderRadius: 8,
                  background: "var(--color-background-primary)", color: "var(--color-text-primary)",
                }}
              />
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
                💡 送信時にサーバー側でさらに300文字以内に最適化されます。クリック計測URLも文字数許容内で自動付加されます。
              </p>
            </Card>
          </Section>

          {/* 送信先選択 */}
          {(() => {
            const liTargets = crm.filter(LINKEDIN_GROUPS[liGroupIdx].filter);
            const toggleLi  = id => setLiSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

            // LinkedIn URL を CRM に直接保存するヘルパー
            const saveLiUrl = (id, url) => {
              const trimmed = url.trim();
              setCrm(prev => prev.map(c => c.id === id ? {
                ...c,
                linkedin:    trimmed,  // DB保存フィールド
                linkedinUrl: trimmed,  // 表示・検索用フィールド
                // URL が入ったらステータスも LinkedIn送信待ちに昇格
                status: trimmed && c.status !== "送信済み" ? "LinkedIn送信待ち" : c.status,
              } : c));
              // URL が入ったら自動でチェックON
              if (trimmed && !liSelected.includes(id)) {
                setLiSelected(prev => [...prev, id]);
              }
            };

            // 全選択：URL がある人だけ選択
            const selectAllWithUrl = () =>
              setLiSelected(liTargets.filter(t => !!(t.linkedin || t.linkedinUrl)).map(t => t.id));

            return (
              <Section
                title={`送信先リスト — ${liTargets.length}件`}
                right={
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <button onClick={selectAllWithUrl} style={{ fontSize: 11, padding: "3px 10px" }}>
                      URLありを全選択
                    </button>
                    <button onClick={() => setLiSelected([])} style={{ fontSize: 11, padding: "3px 10px" }}>
                      クリア
                    </button>
                    <button
                      onClick={() => { setLiResults([]); setLiPreview(true); }}
                      disabled={liSelected.length === 0 || !liMessage.trim()}
                      style={{
                        fontSize: 12, padding: "6px 16px",
                        background: "#0A66C2", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer",
                        opacity: (liSelected.length === 0 || !liMessage.trim()) ? 0.5 : 1,
                      }}>
                      💼 {liSelected.length}件に送信
                    </button>
                  </div>
                }
              >
                {liTargets.length === 0 ? (
                  <Card>
                    <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0 }}>
                      対象リードがいません。「企業検索」タブで候補を追加するか、
                      CRM でメアド未取得のリードが自動的にここに表示されます。
                    </p>
                  </Card>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* URL なし件数バナー */}
                    {(() => {
                      const noUrl = liTargets.filter(t => !(t.linkedin || t.linkedinUrl)).length;
                      return noUrl > 0 ? (
                        <div style={{
                          padding: "8px 12px", borderRadius: 8,
                          background: "#FEF9E7", border: "0.5px solid #D4AC0D",
                          fontSize: 12, color: "#7D6608",
                          display: "flex", alignItems: "center", gap: 8,
                        }}>
                          <span>💡</span>
                          <span>
                            <strong>{noUrl}件</strong>はLinkedIn URLが未入力です。
                            各行のURL欄に貼り付けると自動でチェックが入り、送信対象になります。
                          </span>
                        </div>
                      ) : null;
                    })()}

                    {liTargets.map(t => {
                      const isSel    = liSelected.includes(t.id);
                      const liUrl    = t.linkedin || t.linkedinUrl || "";
                      const result   = liResults.find(r => r.id === t.id);
                      const hasLiUrl = !!liUrl;

                      return (
                        <Card key={t.id} style={{
                          border: result?.ok   ? "1px solid #0A66C2"
                            : isSel            ? "1px solid #0A66C2"
                            : !hasLiUrl        ? "1px dashed #D4AC0D"
                            : undefined,
                          background: result?.ok ? "#EEF5FB"
                            : isSel            ? "#F0F8FF"
                            : !hasLiUrl        ? "#FFFDF4"
                            : undefined,
                        }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            {/* チェックボックス: URL があれば有効 */}
                            <input
                              type="checkbox"
                              checked={isSel}
                              disabled={!hasLiUrl}
                              onChange={() => toggleLi(t.id)}
                              style={{ cursor: hasLiUrl ? "pointer" : "not-allowed", flexShrink: 0, marginTop: 3 }}
                            />
                            <Avatar name={t.name} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {/* 名前・役職・会社 */}
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{t.name}</p>
                                <Badge status={t.status} />
                                {!t.email && (
                                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4,
                                    background: "#FEF9E7", color: "#7D6608", border: "0.5px solid #D4AC0D" }}>
                                    メアド未取得
                                  </span>
                                )}
                                {t.clicked && (
                                  <span style={{ fontSize: 10, background: "#FAEEDA", color: "#633806", padding: "2px 6px", borderRadius: 4 }}>
                                    🔗 クリック済み
                                  </span>
                                )}
                              </div>
                              <p style={{ margin: "2px 0 6px", fontSize: 12, color: "var(--color-text-secondary)" }}>
                                {t.title}{t.title && t.company ? " · " : ""}{t.company}
                              </p>

                              {/* LinkedIn URL 行 */}
                              {hasLiUrl ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <a href={liUrl} target="_blank" rel="noreferrer"
                                    style={{ fontSize: 11, color: "#0A66C2", fontWeight: 500,
                                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>
                                    💼 {liUrl}
                                  </a>
                                  <button
                                    onClick={() => {
                                      setCrm(prev => prev.map(c => c.id === t.id ? { ...c, linkedinUrl: "", linkedin: "" } : c));
                                      setLiSelected(prev => prev.filter(x => x !== t.id));
                                    }}
                                    style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, color: "#999",
                                      background: "transparent", border: "0.5px solid #ddd", cursor: "pointer" }}>
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                /* URL 未入力 → インライン入力欄 */
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  <input
                                    type="text"
                                    placeholder="LinkedIn URL を貼り付け (https://linkedin.com/in/...)"
                                    defaultValue=""
                                    onBlur={e => { if (e.target.value.trim()) saveLiUrl(t.id, e.target.value); }}
                                    onKeyDown={e => { if (e.key === "Enter") { saveLiUrl(t.id, e.target.value); e.target.blur(); } }}
                                    style={{
                                      fontSize: 12, padding: "5px 8px", borderRadius: 6, flex: 1,
                                      border: "0.5px solid #D4AC0D",
                                      background: "var(--color-background-primary)", color: "var(--color-text-primary)",
                                      fontFamily: "inherit",
                                    }}
                                  />
                                  <span style={{ fontSize: 10, color: "#7D6608", flexShrink: 0 }}>Enter で確定</span>
                                </div>
                              )}
                            </div>

                            {/* 送信結果バッジ */}
                            {result && (
                              <span style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 8, fontWeight: 500, flexShrink: 0,
                                background: result.ok ? "#E8F4FD" : "#FDEDEC",
                                color:      result.ok ? "#0A66C2"  : "#922B21",
                              }}>
                                {result.ok ? "✓ 送信完了" : `✗ ${result.error}`}
                              </span>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </Section>
            );
          })()}

          {/* 送信結果サマリー */}
          {liResults.length > 0 && (
            <Card style={{ background: "#EEF5FB", border: "0.5px solid #0A66C2", marginTop: "1rem" }}>
              <p style={{ margin: "0 0 4px", fontWeight: 500, fontSize: 14, color: "#0A66C2" }}>
                💼 LinkedIn 送信完了 ―
                成功 {liResults.filter(r => r.ok).length} / {liResults.length} 件
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                送信成功リードは「送信済み」ステータスに更新済みです。
                リンクがクリックされると既存のトラッキングポーリング（60秒ごと）が自動検知し、
                「返信あり」へ昇格します。
              </p>
            </Card>
          )}

          {/* 送信確認モーダル */}
          {liPreview && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
            }}>
              <Card style={{ maxWidth: 560, width: "90%", maxHeight: "80vh", overflow: "auto" }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>💼 LinkedIn 送信確認</h3>
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
                  以下の <strong>{liSelected.length}</strong> 名にコネクションリクエストを送信します。
                </p>

                {/* メッセージプレビュー */}
                <Section title="送信メッセージ（プレビュー）">
                  <Card style={{ background: "var(--color-background-secondary)" }}>
                    <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{liMessage}</p>
                    <p style={{ margin: "6px 0 0", fontSize: 10, color: "var(--color-text-tertiary)" }}>
                      ※実際の送信時はサーバー側で300文字最適化 + クリック計測URL付加が行われます
                    </p>
                  </Card>
                </Section>

                {/* 送信先リスト */}
                <Section title="送信先">
                  <div style={{ maxHeight: 200, overflow: "auto" }}>
                    {crm.filter(c => liSelected.includes(c.id)).map(t => (
                      <div key={t.id} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 13,
                      }}>
                        <Avatar name={t.name} size={24} />
                        <span style={{ fontWeight: 500 }}>{t.name}</span>
                        <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                          {t.title}{t.title && t.company ? " · " : ""}{t.company}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                  <button onClick={() => setLiPreview(false)} style={{ fontSize: 13, padding: "8px 16px" }}>
                    キャンセル
                  </button>
                  <button
                    onClick={sendLinkedInMessages}
                    disabled={liSending}
                    style={{ fontSize: 13, padding: "8px 22px", background: "#0A66C2", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
                    {liSending ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        送信中...
                      </span>
                    ) : `💼 ${liSelected.length}件に送信する`}
                  </button>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ════ メール送信チャンネル ════ */}
      {channel === "email" && (
      <div>
        <div style={{ marginBottom: "1rem", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => setShowAICopy(v => !v)}
          style={{ fontSize: 13, padding: "7px 14px", display: "flex", alignItems: "center", gap: 6 }}>
          <span>✨</span>
          {showAICopy ? "AI訴求生成を閉じる" : "カテゴリ別AI訴求生成を開く"}
        </button>
        {onNavigateTo && (
          <button onClick={() => onNavigateTo("abtest")}
            style={{ fontSize: 13, padding: "7px 14px", background: "#3C3489", color: "#fff", border: "none", borderRadius: 8 }}>
            A/Bテストタブへ →
          </button>
        )}
        {quota && (
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
            本日送信: <strong>{quota.sentToday}</strong> / {quota.dailyLimit} (残り {quota.remaining})
          </span>
        )}
      </div>

      {showAICopy && (
        <Card style={{ marginBottom: "1.5rem" }}>
          <AICopyPanel
            settings={settings} crm={crm}
            onApply={(s, b) => { setSubject(s); setBody(b); setShowAICopy(false); }}
            onSendToABTest={onNavigateTo ? (variants, category) => {
              onNavigateTo("abtest", { variants, categoryKey: category?.key, segmentLabel: null });
              setShowAICopy(false);
            } : null}
          />
        </Card>
      )}

      <Section title="メッセージ作成">
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
              送信元: <strong style={{ color: "var(--color-text-primary)" }}>{import.meta.env.VITE_FROM_EMAIL || "（.envで設定）"}</strong>
            </p>
            <button onClick={generateMessage} disabled={genLoading} style={{ fontSize: 12, padding: "6px 12px" }}>{genLoading ? "生成中..." : "AIで自動生成 ↗"}</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>キャンペーン名（任意、空欄なら自動）</label>
              <input value={campaignName} onChange={e => setCampaignName(e.target.value)}
                placeholder="例: 2026-04 SaaS CxO 初回アプローチ"
                style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>件名</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="件名を入力（{{name}}, {{company}} が使えます）" style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>本文</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={6} placeholder="本文を入力（{{name}}, {{company}} が使えます）"
                style={{ width: "100%", marginTop: 4, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", fontSize: 14, padding: "8px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
            </div>
          </div>
        </Card>
      </Section>

      <Section title="送信先グループ">
        <Card>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--color-text-secondary)" }}>グループを選ぶと対象者が絞り込まれます</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {EMAIL_GROUPS.map((g, i) => {
              const count = crm.filter(g.filter).length;
              return (
                <button key={g.label} onClick={() => handleGroupChange(i)} disabled={count === 0}
                  style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, background: groupIdx === i ? "#185FA5" : "var(--color-background-secondary)", color: groupIdx === i ? "#fff" : "var(--color-text-primary)", border: groupIdx === i ? "none" : "0.5px solid var(--color-border-tertiary)", fontWeight: groupIdx === i ? 500 : 400, opacity: count === 0 ? 0.45 : 1, cursor: count === 0 ? "default" : "pointer" }}>
                  {g.label} ({count})
                </button>
              );
            })}
          </div>
        </Card>
      </Section>

      <Section title={`送信先選択 — ${EMAIL_GROUPS[groupIdx].label} (${targets.length}件)`}>
        {/* メアドなしリードがいる場合のLinkedIn誘導バナー */}
        {(() => {
          const noEmailLeads = crm.filter(c =>
            !c.email &&
            c.status !== "送信済み" && c.status !== "クローズ" && c.status !== "見込みなし"
          );
          return noEmailLeads.length > 0 ? (
            <div style={{
              marginBottom: 12, padding: "10px 14px", borderRadius: 8,
              background: "linear-gradient(135deg, #EEF5FB 0%, #E8F2FA 100%)",
              border: "0.5px solid #0A66C2",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>💼</span>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#0A66C2" }}>
                    メアド未取得のリードが {noEmailLeads.length} 件あります
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>
                    LinkedIn送信タブから LinkedIn URL を入力して直接アプローチできます
                  </p>
                </div>
              </div>
              <button
                onClick={() => setChannel("linkedin")}
                style={{
                  fontSize: 12, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                  background: "#0A66C2", color: "#fff", border: "none", flexShrink: 0,
                }}>
                💼 LinkedIn送信へ →
              </button>
            </div>
          ) : null;
        })()}
        {targets.length === 0 ? (
          <Card><p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: 0 }}>このグループに該当する連絡先がありません。</p></Card>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <button onClick={selectAll} style={{ fontSize: 12, padding: "4px 10px" }}>すべて選択</button>
              <button onClick={clearAll}  style={{ fontSize: 12, padding: "4px 10px" }}>解除</button>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{selected.length}件選択中</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
              {targets.map(t => (
                <Card key={t.id} style={{ cursor: "pointer", border: selected.includes(t.id) ? "1px solid var(--color-border-info)" : undefined }} onClick={() => toggleSelect(t.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggleSelect(t.id)} onClick={e => e.stopPropagation()} style={{ cursor: "pointer", flexShrink: 0 }} />
                    <Avatar name={t.name} size={28} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</span>
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginLeft: 8 }}>{t.title} · {t.company}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
                      <Badge status={t.status} />
                      <ScoreBadge score={calcScore(t)} />
                      {t.gaData?.conversions >= 1 && <CvBadge />}
                      {t.gaData?.planStatus && <PlanBadge planStatus={t.gaData.planStatus} planScore={t.gaData.planScore} />}
                      <span style={{ fontSize: 12, color: "var(--color-text-info)" }}>{t.email}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button onClick={openPreview} disabled={selected.length === 0} style={{ padding: "8px 20px" }}>送信内容を確認する ({selected.length}件)</button>
            </div>
          </>
        )}
      </Section>

      {preview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "var(--color-background-primary)", borderRadius: 12, padding: "1.5rem", maxWidth: 520, width: "90%", maxHeight: "80vh", overflow: "auto" }}>
            <p style={{ margin: "0 0 1rem", fontWeight: 500, fontSize: 16 }}>送信確認</p>
            <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: 12 }}>
              <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--color-text-secondary)" }}>キャンペーン名</p>
              <p style={{ margin: 0, fontSize: 14 }}>{campaignName || `${EMAIL_GROUPS[groupIdx].label} ${new Date().toISOString().slice(5,16)}`}</p>
            </div>
            <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: 12 }}>
              <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--color-text-secondary)" }}>件名（プレビュー）</p>
              <p style={{ margin: 0, fontSize: 14 }}>{subject.replace(/\{\{name\}\}/g, firstTarget?.name || "〇〇").replace(/\{\{company\}\}/g, firstTarget?.company || "〇〇社")}</p>
            </div>
            <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: 16 }}>
              <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--color-text-secondary)" }}>本文（プレビュー）</p>
              <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{body.replace(/\{\{name\}\}/g, firstTarget?.name || "〇〇").replace(/\{\{company\}\}/g, firstTarget?.company || "〇〇社")}</p>
            </div>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 16px" }}>上記の内容で <strong>{selected.length}名</strong> に送信します。</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={sendEmails} disabled={sending} style={{ padding: "8px 20px" }}>{sending ? "送信中..." : "送信開始"}</button>
              <button onClick={() => setPreview(false)} disabled={sending} style={{ padding: "8px 16px" }}>キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <Section title="送信結果">
          {sendSummary && (
            <div style={{ marginBottom: 10, padding: "8px 12px", background: "#E6F1FB", borderRadius: 8, fontSize: 12 }}>
              ✓ キャンペーン「<strong>{sendSummary.campaignName}</strong>」作成 · 成功 {results.filter(r => r.ok).length}/{results.length}件
            </div>
          )}
          <Card>
            {results.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ fontSize: 14 }}>{r.ok ? "✓" : "✗"}</span>
                <span style={{ fontSize: 13, flex: 1 }}>{r.name}</span>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{r.email}</span>
                {r.error && <span style={{ fontSize: 11, color: "var(--color-text-danger)" }}>{r.error}</span>}
                <Badge status={r.ok ? "送信済み" : "未送信"} />
              </div>
            ))}
          </Card>
        </Section>
      )}
      </div>
      )} {/* end channel === "email" */}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab: A/Bテスト（新規）
//   - 複数variant × セグメント で一括送信
//   - 進行中キャンペーンのリーダーボード（variant別KPI）
// ════════════════════════════════════════════════════════════
function ABTestTab({ settings, crm, setCrm, prefill, onClearPrefill }) {
  const [variants, setVariants] = useState([]); // [{id, label, angle, subject, body, predOpen, predCtr}]
  const [groupIdx, setGroupIdx] = useState(1);
  const [campaignName, setCampaignName] = useState("");
  const [mode, setMode] = useState("thompson"); // "even" | "thompson"
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [selCampaignId, setSelCampaignId] = useState("");
  const [days, setDays] = useState(7);

  // prefill: AICopyPanel から variants が渡ってきた場合に展開
  useEffect(() => {
    if (prefill?.variants?.length) {
      setVariants(prefill.variants.map(v => ({
        id: v.id || `v_${Math.random().toString(36).slice(2)}`,
        label: v.label || v.angle || "variant",
        angle: v.angle || "",
        subject: v.subject || "",
        body: v.body || "",
        predOpen: v.predOpen || 0,
        predCtr: v.predCtr || 0,
      })));
    }
    if (prefill?.segmentLabel) {
      const idx = EMAIL_GROUPS.findIndex(g => g.label === prefill.segmentLabel);
      if (idx >= 0) setGroupIdx(idx);
    }
    if (prefill?.campaignName) setCampaignName(prefill.campaignName);
    if (prefill?.variants?.length || prefill?.segmentLabel || prefill?.campaignName) {
      if (onClearPrefill) onClearPrefill();
    }
  }, [prefill?.variants, prefill?.segmentLabel, prefill?.campaignName]);

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const q = new URLSearchParams();
      if (selCampaignId) q.set("campaignId", selCampaignId);
      if (days) q.set("days", days);
      const res = await fetch(`${RAILWAY}/experiments/summary?${q}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSummary(data);
    } catch (e) { alert("KPI取得失敗: " + e.message); }
    setSummaryLoading(false);
  };

  useEffect(() => { loadSummary(); /* eslint-disable-next-line */ }, [selCampaignId, days]);

  const targets = crm.filter(EMAIL_GROUPS[groupIdx].filter);
  const groupCount = targets.length;

  const addEmptyVariant = () => {
    setVariants(prev => [...prev, {
      id: `v_${Date.now()}_${prev.length}`,
      label: `variant_${prev.length + 1}`, angle: "",
      subject: "", body: "", predOpen: 0, predCtr: 0,
    }]);
  };
  const removeVariant = (id) => setVariants(prev => prev.filter(v => v.id !== id));
  const updateVariant = (id, k, v) => setVariants(prev => prev.map(x => x.id === id ? { ...x, [k]: v } : x));

  const canSend = variants.length >= 2 && variants.every(v => v.subject && v.body) && groupCount > 0;

  const runAbTest = async () => {
    if (!canSend) { alert("2つ以上のバリアント(件名・本文入力済み)と、送信先セグメントが必要です"); return; }
    const confirmMsg = `${variants.length}つのバリアントを ${groupCount}件に均等送信します。よろしいですか？`;
    if (!window.confirm(confirmMsg)) return;

    setSending(true); setSendResult(null);
    try {
      const autoCampaign = campaignName || `A/B ${new Date().toISOString().slice(5,16)} (${variants.length}var)`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 900000);
      let res;
      try {
        res = await fetch(`${LOCAL_SEND}/send-emails`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            campaignName: autoCampaign,
            segment: EMAIL_GROUPS[groupIdx].label,
            mode,
            variants,
            recipients: targets.map(t => ({
              name: t.name, email: t.email, company: t.company, id: t.id,
              industry: t.industry, country: t.country, title: t.title,
              segmentKey: segmentKeyOf(t),
            })),
          }),
        });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        alert(
          "❌ ローカル送信サーバーに接続できません\n\n" +
          "ターミナルで以下を実行してください:\n" +
          "  node server_local.js\n\n" +
          "起動後にもう一度「送信開始」を押してください。"
        );
        setSending(false);
        return;
      }
      clearTimeout(timeoutId);
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const raw = await res.text();
        throw new Error(`サーバーが不正なレスポンスを返しました (${res.status})。server_local.jsのログを確認してください。\n${raw.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      // CRM 更新
      data.results.forEach(r => {
        const target = targets.find(t => t.email === r.email);
        if (r.ok && target) {
          setCrm(prev => prev.map(c => c.id === target.id ? {
            ...c,
            status: "送信済み",
            sentAt: new Date().toISOString(),
            subject: variants.find(v => v.id === r.variantId)?.subject || c.subject,
            messageBody: variants.find(v => v.id === r.variantId)?.body || c.messageBody,
            trackingId: r.trackingId,
            campaignId: r.campaignId,
            variantId: r.variantId,
          } : c));
        }
      });
      setSendResult({
        campaignId: data.campaignId, campaignName: data.campaignName,
        totalSent: data.results.filter(r => r.ok).length,
        totalFailed: data.results.filter(r => !r.ok).length,
        byVariant: data.variants,
      });
      // 送信後に summary を自動更新
      setTimeout(loadSummary, 2000);
    } catch (e) { alert("送信失敗: " + e.message); }
    setSending(false);
  };

  // 勝者判定
  const winner = useMemo(() => {
    if (!summary?.variants || summary.variants.length < 2) return null;
    const withEnough = summary.variants.filter(v => v.sent >= 20);
    if (!withEnough.length) return null;
    // プランCV率 > CV率 > 返信率 > CTR > 開封率 の優先順
    return [...withEnough].sort((a, b) =>
      (b.planScore - a.planScore) ||
      (b.cvRate - a.cvRate) ||
      (b.replyRate - a.replyRate) ||
      (b.ctr - a.ctr) ||
      (b.openRate - a.openRate)
    )[0];
  }, [summary]);

  return (
    <div>
      <Section title="A/Bテスト — バリアント構成">
        <Card>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 10px" }}>
            2つ以上のバリアントを用意し、選択したセグメントの宛先に均等割当で送信します。
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>キャンペーン名（任意）</label>
                <input value={campaignName} onChange={e => setCampaignName(e.target.value)}
                  placeholder="例: 2026-04 CxO件名テスト"
                  style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>送信先セグメント</label>
                <select value={groupIdx} onChange={e => setGroupIdx(Number(e.target.value))} style={{ width: "100%", marginTop: 4 }}>
                  {EMAIL_GROUPS.map((g, i) => (
                    <option key={g.label} value={i} disabled={crm.filter(g.filter).length === 0}>
                      {g.label} ({crm.filter(g.filter).length}件)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                バリアント: <strong>{variants.length}</strong> / 宛先: <strong>{groupCount}</strong>件
                {variants.length >= 2 && groupCount > 0 && mode === "even" && (
                  <span> · 均等配分で各 約<strong>{Math.floor(groupCount / variants.length)}</strong>件</span>
                )}
                {variants.length >= 2 && mode === "thompson" && (
                  <span> · Thompson自動最適配分</span>
                )}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>配分:</span>
                <button onClick={() => setMode("even")}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: mode === "even" ? "#185FA5" : "transparent", color: mode === "even" ? "#fff" : "var(--color-text-secondary)", border: mode === "even" ? "none" : "0.5px solid var(--color-border-secondary)" }}>
                  均等 50:50
                </button>
                <button onClick={() => setMode("thompson")}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: mode === "thompson" ? "#3C3489" : "transparent", color: mode === "thompson" ? "#fff" : "var(--color-text-secondary)", border: mode === "thompson" ? "none" : "0.5px solid var(--color-border-secondary)" }}>
                  🎰 Thompson
                </button>
                <button onClick={addEmptyVariant} style={{ fontSize: 12, padding: "5px 12px" }}>+ バリアント追加</button>
              </div>
            </div>
            {mode === "thompson" && (
              <div style={{ padding: "8px 12px", background: "#EEEDFE", borderRadius: 6, fontSize: 11, color: "#3C3489" }}>
                💡 Thompson Sampling: 送信の都度、各バリアントの事後確率分布から1サンプル抽出 → 最高値のバリアントを選択。勝ちそうなバリアントに自然と宛先が集中し、弱いバリアントも探索を残します。CV総数が最大化されます。
              </div>
            )}

            {variants.length === 0 && (
              <Card style={{ background: "var(--color-background-secondary)", border: "0.5px dashed var(--color-border-secondary)" }}>
                <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0 }}>
                  バリアント未設定。メール送信タブのAI訴求生成パネルでバリアントをチェック→「A/Bテスト」ボタン、または右上の「＋バリアント追加」から作成できます。
                </p>
              </Card>
            )}

            {variants.map((v, i) => (
              <div key={v.id} style={{ padding: 12, borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", background: "#FAFAFA" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 100, background: "#EEEDFE", color: "#3C3489" }}>#{i + 1}</span>
                    <input value={v.label} onChange={e => updateVariant(v.id, "label", e.target.value)}
                      placeholder="ラベル (例: 好奇心型)" style={{ fontSize: 12, padding: "3px 8px", width: 180 }} />
                  </div>
                  <button onClick={() => removeVariant(v.id)} style={{ fontSize: 11, color: "var(--color-text-danger)", padding: "3px 8px" }}>削除</button>
                </div>
                <input value={v.subject} onChange={e => updateVariant(v.id, "subject", e.target.value)}
                  placeholder="件名" style={{ width: "100%", boxSizing: "border-box", marginBottom: 6, fontSize: 13 }} />
                <textarea value={v.body} onChange={e => updateVariant(v.id, "body", e.target.value)}
                  placeholder="本文" rows={4}
                  style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", resize: "vertical", fontFamily: "inherit", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6 }} />
              </div>
            ))}

            <div style={{ marginTop: 10 }}>
              <button onClick={runAbTest} disabled={!canSend || sending}
                style={{ padding: "9px 22px", background: canSend ? "#3C3489" : undefined, color: canSend ? "#fff" : undefined, border: "none", borderRadius: 8, fontSize: 13, fontWeight: 500, opacity: sending ? 0.6 : 1 }}>
                {sending ? "送信中..." : `A/Bテスト送信 (${groupCount}件 × ${variants.length}variant)`}
              </button>
            </div>

            {sendResult && (
              <div style={{ marginTop: 8, padding: "10px 14px", background: "#E1F5EE", borderRadius: 8, fontSize: 12 }}>
                ✓ <strong>{sendResult.campaignName}</strong> 送信完了。成功 {sendResult.totalSent}件 / 失敗 {sendResult.totalFailed}件<br />
                <span style={{ color: "var(--color-text-secondary)" }}>
                  バリアント別割当: {sendResult.byVariant.map(v => `${v.label}:${v.sent}件`).join(" / ")}
                </span>
              </div>
            )}
          </div>
        </Card>
      </Section>

      <Section title="キャンペーン別リーダーボード"
        right={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select value={selCampaignId} onChange={e => setSelCampaignId(e.target.value)} style={{ fontSize: 12, padding: "3px 6px" }}>
              <option value="">全キャンペーン</option>
              {(summary?.campaigns || []).map(c => <option key={c.campaignId} value={c.campaignId}>{c.name}</option>)}
            </select>
            <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ fontSize: 12, padding: "3px 6px" }}>
              {[1, 3, 7, 14, 30].map(n => <option key={n} value={n}>直近{n}日</option>)}
            </select>
            <button onClick={loadSummary} disabled={summaryLoading} style={{ fontSize: 11, padding: "3px 10px" }}>{summaryLoading ? "..." : "更新"}</button>
          </div>
        }>
        <Card>
          {!summary || summary.variants.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>
              まだ集計データがありません。A/Bテスト送信を実行するか、しばらく待ってから「更新」を押してください。
            </p>
          ) : (
            <>
              {winner && (
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "#EAF3DE", borderRadius: 8, fontSize: 12 }}>
                  🏆 <strong>暫定勝者: {winner.label}</strong>（{winner.campaignName}）—
                  開封 <strong>{winner.openRate}%</strong> / CTR <strong>{winner.ctr}%</strong> / 返信 <strong>{winner.replyRate}%</strong> / CV <strong>{winner.cvRate}%</strong> / プラン <strong>{winner.planCvRate}%</strong>
                </div>
              )}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "0.5px solid var(--color-border-secondary)" }}>
                      {["キャンペーン", "バリアント", "件名", "送信", "開封%", "CTR%", "返信%", "CV%", "プラン%", "プランPt"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500, color: "var(--color-text-secondary)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.variants.map((v, i) => {
                      const isWinner = winner && v.variantId === winner.variantId;
                      return (
                        <tr key={v.variantId} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", background: isWinner ? "#F5FBF0" : undefined }}>
                          <td style={{ padding: "6px 8px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.campaignName}</td>
                          <td style={{ padding: "6px 8px" }}>
                            <span style={{ fontSize: 11, fontWeight: 500, padding: "1px 6px", borderRadius: 6, background: "#EEEDFE", color: "#3C3489" }}>{v.label}</span>
                            {isWinner && <span style={{ fontSize: 11, marginLeft: 4 }}>🏆</span>}
                          </td>
                          <td style={{ padding: "6px 8px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>{v.subject}</td>
                          <td style={{ padding: "6px 8px" }}>{v.sent}</td>
                          <td style={{ padding: "6px 8px" }}>{v.openRate}%</td>
                          <td style={{ padding: "6px 8px" }}>{v.ctr}%</td>
                          <td style={{ padding: "6px 8px" }}>{v.replyRate}%</td>
                          <td style={{ padding: "6px 8px" }}>{v.cvRate}%</td>
                          <td style={{ padding: "6px 8px" }}>{v.planCvRate}%</td>
                          <td style={{ padding: "6px 8px", fontWeight: 500 }}>{v.planScore}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </Section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab: CRM（既存の一覧）
// ════════════════════════════════════════════════════════════
function CrmTab({ crm }) {
  const counts = STATUS_OPTIONS.reduce((acc, s) => ({ ...acc, [s]: crm.filter(c => c.status === s).length }), {});
  const totalScore = crm.reduce((s, c) => s + calcScore(c), 0);

  const exportCsv = () => {
    const header = "名前,役職,会社,業界,メール,LinkedIn,X(Twitter),ステータス,スコア,クリック,複数回開封,サイト訪問,複数ページ閲覧,スクロール,CV済み,プラン,国,キャンペーン,バリアント,検索意図,コンテキスト要約,メモ,追加日";
    const rows = crm.map(c => [
      c.name, c.title, c.company, c.industry, c.email, c.linkedin,
      c.xUrl || "—",
      c.status, calcScore(c),
      c.clicked ? "済" : "未",
      (c.opens || 0) >= 2 ? "済" : "未",
      c.gaData?.sessions >= 1 ? "済" : "未",
      c.gaData?.pageViews >= 2 ? "済" : "未",
      c.gaData?.scrolledUsers >= 1 ? "済" : "未",
      c.gaData?.conversions >= 1 ? "済" : "未",
      c.gaData?.planStatus || "—",
      c.country,
      c.campaignId || "—",
      c.variantId || "—",
      (c.sourceIntent || "").replace(/,/g, "、"),
      (c.contextSummary || "").replace(/,/g, "、"),
      (c.notes || "").replace(/,/g, "、"), c.addedAt
    ].join(","));
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "sales_crm.csv"; a.click();
  };

  return (
    <div>
      <Section title="パイプライン概要">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 8 }}>
          <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "0.75rem", textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>{crm.length}</p>
            <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>総リスト数</p>
          </div>
          <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "0.75rem", textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>{totalScore}</p>
            <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>総スコア</p>
          </div>
          {["返信あり", "商談中"].map(s => (
            <div key={s} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "0.75rem", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>{counts[s] || 0}</p>
              <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{s}</p>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 8 }}>
          {["Professional", "Corporate", "Enterprise", "クローズ"].map(s => {
            const c = STATUS_COLORS[s];
            return (
              <div key={s} style={{ background: c.bg, borderRadius: 8, padding: "0.75rem", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 500, color: c.color }}>{counts[s] || 0}</p>
                <p style={{ margin: 0, fontSize: 11, color: c.color, marginTop: 2, opacity: 0.8 }}>{s}</p>
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {["未送信", "送信済み", "開封済み", "見込みなし"].map(s => (
            <div key={s} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "0.75rem", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>{counts[s] || 0}</p>
              <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{s}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`全リスト (${crm.length}件) — スコア降順`}
        right={<button onClick={exportCsv} style={{ fontSize: 12, padding: "6px 12px" }}>CSV エクスポート</button>}>
        {crm.length === 0 ? (
          <Card><p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: 0 }}>まだデータがありません。</p></Card>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "0.5px solid var(--color-border-secondary)" }}>
                  {["名前", "会社", "業界", "メール", "スコア", "ステータス", "抽出コンテキスト", "トラッキング", "メモ"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontWeight: 500, color: "var(--color-text-secondary)", fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...crm].sort((a, b) => calcScore(b) - calcScore(a)).map(c => (
                  <tr key={c.id} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={{ padding: "8px 10px" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar name={c.name} size={24} /><span style={{ fontWeight: 500 }}>{c.name}</span></div></td>
                    <td style={{ padding: "8px 10px", color: "var(--color-text-secondary)" }}>{c.company}</td>
                    <td style={{ padding: "8px 10px", color: "var(--color-text-secondary)", fontSize: 12 }}>{c.industry || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{c.email ? <span style={{ color: "var(--color-text-info)", fontSize: 12 }}>{c.email}</span> : <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}</td>
                    <td style={{ padding: "8px 10px" }}><ScoreBadge score={calcScore(c)} /></td>
                    <td style={{ padding: "8px 10px" }}><Badge status={c.status} /></td>
                    <td style={{ padding: "8px 10px", maxWidth: 180 }}>
                      {c.contextSummary ? (
                        <span title={`意図: ${c.sourceIntent || "—"}\nコンテキスト: ${c.sourceContext || "—"}`}
                          style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "linear-gradient(135deg, #EEF2FF 0%, #F0FFFE 100%)", border: "0.5px solid #C7D2FE", color: "#3730A3", cursor: "help", display: "inline-block", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          🧠 {c.contextSummary}
                        </span>
                      ) : c.sourceIntent ? (
                        <span title={`意図: ${c.sourceIntent}`} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "#F1EFE8", color: "#666", cursor: "help" }}>🔍 意図検索</span>
                      ) : (
                        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {c.clicked && <span style={{ fontSize: 10, background: "#FAEEDA", color: "#633806", padding: "1px 5px", borderRadius: 4 }}>🔗</span>}
                        {(c.opens || 0) >= 2 && <span style={{ fontSize: 10, background: "#E6F1FB", color: "#0C447C", padding: "1px 5px", borderRadius: 4 }}>📩×{c.opens}</span>}
                        {c.gaData?.sessions >= 1 && <span style={{ fontSize: 10, background: "#EAF3DE", color: "#27500A", padding: "1px 5px", borderRadius: 4 }}>🌐</span>}
                        {c.gaData?.pageViews >= 2 && <span style={{ fontSize: 10, background: "#E6F1FB", color: "#185FA5", padding: "1px 5px", borderRadius: 4 }}>📄{c.gaData.pageViews}P</span>}
                        {c.gaData?.scrolledUsers >= 1 && <span style={{ fontSize: 10, background: "#F1EFE8", color: "#444441", padding: "1px 5px", borderRadius: 4 }}>📜</span>}
                        {c.gaData?.conversions >= 1 && <span style={{ fontSize: 10, background: "#9FE1CB", color: "#085041", padding: "1px 5px", borderRadius: 4 }}>🎯CV</span>}
                        {c.gaData?.planStatus && (
                          <span style={{ fontSize: 10, background: STATUS_COLORS[c.gaData.planStatus]?.bg || "#F1EFE8", color: STATUS_COLORS[c.gaData.planStatus]?.color || "#444441", padding: "1px 5px", borderRadius: 4 }}>
                            💰{c.gaData.planStatus}
                          </span>
                        )}
                        {!c.clicked && !c.opens && !c.gaData?.sessions && <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>—</span>}
                      </div>
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--color-text-secondary)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab: 配信健康度(Deliverability)
//   - 送信の安全性、バウンス率、ドメイン品質、suppression リストを可視化
//   - BAN 回避のためのオペレーション状況を一元表示
// ════════════════════════════════════════════════════════════
function DeliverabilityTab() {
  const [safety, setSafety]             = useState(null);
  const [domainQuality, setDomainQuality] = useState(null);
  const [suppressions, setSuppressions] = useState(null);
  const [localHealth, setLocalHealth]   = useState(null);
  const [loading, setLoading]           = useState(false);
  const [refreshedAt, setRefreshedAt]   = useState(null);

  const [manualEmail, setManualEmail]   = useState("");
  const [manualReason, setManualReason] = useState("manual");
  const [manualResult, setManualResult] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const [s, dq, sp, lh] = await Promise.all([
        fetch(`${RAILWAY}/send-safety`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${RAILWAY}/domain-quality`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${RAILWAY}/suppressions`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${LOCAL_SEND}/health`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setSafety(s); setDomainQuality(dq); setSuppressions(sp); setLocalHealth(lh);
      setRefreshedAt(new Date().toLocaleTimeString("ja-JP"));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const addSuppression = async () => {
    if (!manualEmail) return;
    try {
      const r = await fetch(`${RAILWAY}/email/suppress`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: manualEmail, reason: manualReason, source: "manual_ui" }),
      });
      if (!r.ok) throw new Error(await r.text());
      setManualResult(`✓ ${manualEmail} を suppress リストに追加しました`);
      setManualEmail("");
      refresh();
    } catch (e) { setManualResult(`✗ ${e.message}`); }
  };

  const safetyColor = safety?.safety === "halt" ? { bg: "#FCEBEB", color: "#791F1F", label: "🛑 停止" }
    : safety?.safety === "warn" ? { bg: "#FAEEDA", color: "#633806", label: "⚠️ 警告" }
    : { bg: "#E1F5EE", color: "#085041", label: "✓ 正常" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>
          {refreshedAt && `最終更新: ${refreshedAt}  ·  60秒ごとに自動更新`}
        </p>
        <button onClick={refresh} disabled={loading} style={{ fontSize: 12, padding: "5px 12px" }}>
          {loading ? "更新中..." : "手動更新"}
        </button>
      </div>

      {/* 上段: 大きなサマリー */}
      <Section title="送信安全性">
        <Card style={{ background: safetyColor.bg, borderLeft: `3px solid ${safetyColor.color}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>状態</p>
              <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 500, color: safetyColor.color }}>{safetyColor.label}</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>24hバウンス率</p>
              <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 500, color: safetyColor.color }}>
                {safety ? `${safety.bounceRate}%` : "—"}
              </p>
              <p style={{ margin: "1px 0 0", fontSize: 10, color: "var(--color-text-tertiary)" }}>
                {safety && `警告 ${(safety.thresholds.warn * 100).toFixed(0)}% / 停止 ${(safety.thresholds.halt * 100).toFixed(0)}%`}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>24hバウンス件数</p>
              <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 500 }}>{safety?.recentBounce24h ?? "—"}</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>累計送信数</p>
              <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 500 }}>{safety?.totalSent ?? "—"}</p>
            </div>
          </div>
          {safety?.safety === "halt" && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#791F1F", lineHeight: 1.6 }}>
              ⚠️ 送信は自動停止中です。バウンスが落ち着くまで新規送信リクエストは拒否されます。
              次回送信までに低品質ドメインを<strong>suppress</strong>または<strong>CRMから除外</strong>してください。
            </p>
          )}
          {safety?.safety === "warn" && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#633806", lineHeight: 1.6 }}>
              バウンス率が警告域です。大量送信を続けると SendGrid のスパムスコアが下がる可能性があります。
              下の「問題ドメイン」を確認してください。
            </p>
          )}
        </Card>
      </Section>

      {/* ローカル送信サーバ / 本日送信残量 */}
      <Section title="送信プロバイダー">
        <Card>
          {localHealth ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
              <div>
                <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>プロバイダ</p>
                <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 500 }}>{localHealth.provider}</p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>From</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, wordBreak: "break-all" }}>{localHealth.fromEmail}</p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>本日送信</p>
                <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 500 }}>
                  {localHealth.quota?.sentToday || 0} / {localHealth.quota?.dailyLimit}
                </p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>残り送信可能</p>
                <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 500, color: (localHealth.quota?.remaining || 0) < 100 ? "#922B21" : "#1E8449" }}>
                  {localHealth.quota?.remaining || 0}
                </p>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>
              ローカル送信サーバー(localhost:3002)に接続できません。<code>node server_local.js</code> を起動してください。
            </p>
          )}
        </Card>
      </Section>

      {/* ドメイン品質 */}
      <Section title="ドメイン品質(問題ドメイン順)">
        <Card>
          <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "0 0 8px" }}>
            badScore = バウンス率 + 苦情率×3。5件以上送信済みで <strong>badScore ≥ 0.5</strong> のドメインは、Apollo検索の自動除外対象になります。
          </p>
          {!domainQuality || domainQuality.domains.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>まだドメイン統計がありません。</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "0.5px solid var(--color-border-secondary)" }}>
                    {["ドメイン", "送信", "バウンス", "苦情", "バウンス率", "苦情率", "badScore"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500, color: "var(--color-text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {domainQuality.domains.slice(0, 30).map(d => {
                    const blocked = d.sent >= 5 && d.badScore >= 0.5;
                    return (
                      <tr key={d.domain} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", background: blocked ? "#FCEBEB" : undefined }}>
                        <td style={{ padding: "6px 8px", fontWeight: blocked ? 500 : 400 }}>
                          {d.domain}
                          {blocked && <span style={{ fontSize: 10, marginLeft: 6, padding: "1px 5px", background: "#791F1F", color: "#fff", borderRadius: 4 }}>BLOCKED</span>}
                        </td>
                        <td style={{ padding: "6px 8px" }}>{d.sent}</td>
                        <td style={{ padding: "6px 8px", color: d.bounced > 0 ? "#922B21" : undefined }}>{d.bounced}</td>
                        <td style={{ padding: "6px 8px", color: d.complaint > 0 ? "#922B21" : undefined }}>{d.complaint}</td>
                        <td style={{ padding: "6px 8px" }}>{d.bounceRate}%</td>
                        <td style={{ padding: "6px 8px" }}>{d.complaintRate}%</td>
                        <td style={{ padding: "6px 8px", fontWeight: 500, color: d.badScore >= 0.5 ? "#922B21" : d.badScore >= 0.2 ? "#633806" : undefined }}>
                          {d.badScore.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {domainQuality.domains.length > 30 && (
                <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "8px 0 0" }}>
                  残り {domainQuality.domains.length - 30} ドメインは省略
                </p>
              )}
            </div>
          )}
        </Card>
      </Section>

      {/* Suppression リスト */}
      <Section title={`Suppression リスト (${suppressions?.count || 0}件)`}>
        <Card>
          <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "0 0 8px" }}>
            これらのアドレスは次回以降の送信・Apollo検索から自動で除外されます。<br />
            <strong>SendGrid webhook</strong>(`/webhook/sendgrid`)を設定している場合、bounce/spamreport/unsubscribe は自動で登録されます。
          </p>

          <div style={{ padding: "10px 12px", background: "var(--color-background-secondary)", borderRadius: 6, marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 500, margin: "0 0 6px" }}>手動追加</p>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input value={manualEmail} onChange={e => setManualEmail(e.target.value)}
                placeholder="email@example.com" type="email"
                style={{ flex: 1, minWidth: 200, fontSize: 12, padding: "5px 8px" }} />
              <select value={manualReason} onChange={e => setManualReason(e.target.value)} style={{ fontSize: 12, padding: "5px 8px" }}>
                <option value="manual">manual (手動除外)</option>
                <option value="bounce">bounce</option>
                <option value="hard_bounce">hard_bounce</option>
                <option value="complaint">complaint</option>
                <option value="unsubscribe">unsubscribe</option>
              </select>
              <button onClick={addSuppression} disabled={!manualEmail} style={{ fontSize: 12, padding: "5px 14px" }}>追加</button>
            </div>
            {manualResult && <p style={{ margin: "6px 0 0", fontSize: 11, color: manualResult.startsWith("✓") ? "#1D9E75" : "#922B21" }}>{manualResult}</p>}
          </div>

          {!suppressions || suppressions.list.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>Suppression リストは空です。</p>
          ) : (
            <div style={{ overflowX: "auto", maxHeight: 400 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "0.5px solid var(--color-border-secondary)" }}>
                    {["email", "reason", "source", "登録日時"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500, color: "var(--color-text-secondary)", position: "sticky", top: 0, background: "var(--color-background-primary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suppressions.list.slice().reverse().map(s => {
                    const reasonColor = /bounce/i.test(s.reason) ? "#922B21" : /complaint|spam/i.test(s.reason) ? "#633806" : "var(--color-text-secondary)";
                    return (
                      <tr key={s.email + s.at} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                        <td style={{ padding: "5px 8px", wordBreak: "break-all" }}>{s.email}</td>
                        <td style={{ padding: "5px 8px", color: reasonColor }}>{s.reason}</td>
                        <td style={{ padding: "5px 8px", color: "var(--color-text-tertiary)" }}>{s.source}</td>
                        <td style={{ padding: "5px 8px", color: "var(--color-text-tertiary)", fontSize: 11 }}>{s.at ? new Date(s.at).toLocaleString("ja-JP") : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      {/* 運用ガイド */}
      <Section title="運用の指針">
        <Card style={{ background: "#F7F9FC" }}>
          <div style={{ fontSize: 12, lineHeight: 1.8, color: "var(--color-text-secondary)" }}>
            <p style={{ margin: "0 0 6px" }}><strong>SendGrid BAN 回避の三原則</strong></p>
            <ol style={{ margin: "0 0 8px", paddingLeft: 18 }}>
              <li>バウンス率 &lt; 5% を死守(このタブの「24hバウンス率」を監視)</li>
              <li>苦情率 &lt; 0.08% を死守(ドメイン品質テーブルの苦情列をチェック)</li>
              <li>suppression 済みには絶対に送らない(自動で除外される)</li>
            </ol>
            <p style={{ margin: "8px 0 6px" }}><strong>SendGrid Webhook 設定</strong></p>
            <p style={{ margin: "0 0 8px", paddingLeft: 18 }}>
              SendGrid ダッシュボード → Settings → Mail Settings → Event Webhook で<br />
              <code style={{ background: "var(--color-background-secondary)", padding: "1px 6px", borderRadius: 3 }}>{RAILWAY}/webhook/sendgrid</code><br />
              を HTTP POST URL に登録し、「Bounced」「Spam Reports」「Unsubscribed」「Dropped」「Blocked」にチェックを入れてください。
            </p>
            <p style={{ margin: "8px 0 6px" }}><strong>ドメイン認証</strong></p>
            <p style={{ margin: "0 0 0", paddingLeft: 18 }}>
              送信元ドメインには必ず <strong>SPF / DKIM / DMARC</strong> を設定。これがないと大量送信はほぼ全てスパム行きです。
            </p>
          </div>
        </Card>
      </Section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab: PDCA（旧・最適化レポートの全面改修）
//   - 「事実 → 仮説 → ネクストアクション」を構造化してAIに出させる
//   - 各ネクストアクションに「実行」ボタン（該当タブに prefill 遷移）
//   - Experiments API から variant KPI を取得し、CRM集計と合わせて判断材料にする
// ════════════════════════════════════════════════════════════
function PDCATab({ crm, settings, onNavigateTo }) {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null); // { facts, hypotheses, nextActions }
  const [error, setError] = useState("");
  const [gaData, setGaData] = useState(null);
  const [gaDays, setGaDays] = useState(30);
  const [expSummary, setExpSummary] = useState(null);
  const [thinkLog, setThinkLog] = useState([]);
  // マトリクス: 「業界別」「役職別」「フェーズ別」でvariant勝者を表示
  const [matrixGroupBy, setMatrixGroupBy] = useState("industry"); // industry | titleGroup | country | phase | segmentKey
  const [matrixData, setMatrixData] = useState(null);
  // 学習ループ
  const [weightsInfo, setWeightsInfo] = useState(null);
  const [learningBusy, setLearningBusy] = useState(false);
  const [learningResult, setLearningResult] = useState(null);

  // CRM サマリ（計算）
  const stats = useMemo(() => {
    const sent = crm.filter(c => c.status !== "未送信").length;
    const opened = crm.filter(c => ["開封済み","返信あり","商談中","Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(c.status)).length;
    const clicked = crm.filter(c => c.clicked).length;
    const replied = crm.filter(c => ["返信あり","商談中","Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(c.status)).length;
    const converted = crm.filter(c => ["Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(c.status)).length;
    const totalScore = crm.reduce((s, c) => s + calcScore(c), 0);

    const groupBy = (key, normalizer) => {
      const map = {};
      crm.forEach(c => {
        const raw = normalizer ? normalizer(c) : (c[key] || "不明");
        const k = raw || "不明";
        if (!map[k]) map[k] = { count: 0, opened: 0, clicked: 0, replied: 0, converted: 0, score: 0 };
        map[k].count++;
        map[k].score += calcScore(c);
        if (["開封済み","返信あり","商談中","Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(c.status)) map[k].opened++;
        if (c.clicked) map[k].clicked++;
        if (["返信あり","商談中","Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(c.status)) map[k].replied++;
        if (["Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(c.status)) map[k].converted++;
      });
      return Object.entries(map).filter(([_, v]) => v.count >= 3)
        .map(([k, v]) => ({
          name: k, ...v,
          openRate: pct(v.opened, v.count), ctr: pct(v.clicked, v.count),
          replyRate: pct(v.replied, v.count), cvRate: pct(v.converted, v.count),
        }))
        .sort((a, b) => b.score - a.score);
    };

    return {
      sent, opened, clicked, replied, converted, totalScore,
      openRate: pct(opened, sent), ctr: pct(clicked, sent),
      replyRate: pct(replied, sent), cvRate: pct(converted, sent),
      byIndustry:   groupBy("industry"),
      byTitle:      groupBy("title"),
      byTitleGroup: groupBy(null, (c) => normalizeTitle(c.title)),
      byCountry:    groupBy("country"),
      byPhase:      groupBy(null, (c) => inferPhase(c)),
    };
  }, [crm]);

  const fetchGa = async () => {
    try {
      const res = await fetch(`${RAILWAY}/ga/report?days=${gaDays}`);
      if (!res.ok) return;
      setGaData(await res.json());
    } catch {}
  };

  const fetchExp = async () => {
    try {
      const res = await fetch(`${RAILWAY}/experiments/summary?days=${gaDays}`);
      if (!res.ok) return;
      setExpSummary(await res.json());
    } catch {}
  };

  const fetchMatrix = async (groupBy = matrixGroupBy) => {
    try {
      const res = await fetch(`${RAILWAY}/experiments/matrix?groupBy=${groupBy}&days=${gaDays}&minSent=10`);
      if (!res.ok) return;
      setMatrixData(await res.json());
    } catch {}
  };

  const fetchWeights = async () => {
    try {
      const res = await fetch(`${RAILWAY}/learning/weights`);
      if (!res.ok) return;
      setWeightsInfo(await res.json());
    } catch {}
  };

  const runLearning = async () => {
    setLearningBusy(true); setLearningResult(null);
    try {
      const res = await fetch(`${RAILWAY}/learning/update-weights`, { method: "POST" });
      const data = await res.json();
      setLearningResult(data);
      if (data.ok) {
        // グローバル重みも更新
        LEARNED_WEIGHTS = data.weights || LEARNED_WEIGHTS;
        LEARNED_WEIGHTS_UPDATED_AT = data.updatedAt;
        setWeightsInfo({ weights: data.weights, updatedAt: data.updatedAt });
      }
    } catch (e) { setLearningResult({ ok: false, reason: e.message }); }
    setLearningBusy(false);
  };

  useEffect(() => { fetchGa(); fetchExp(); fetchMatrix(matrixGroupBy); fetchWeights(); /* eslint-disable-next-line */ }, [gaDays]);
  useEffect(() => { fetchMatrix(matrixGroupBy); /* eslint-disable-next-line */ }, [matrixGroupBy]);

  const runAnalysis = async () => {
    if (stats.sent < 5) { setError("送信済みが5件未満です。データが積まれてから再実行してください。"); return; }
    setLoading(true); setError(""); setPlan(null);

    const steps = [
      { label: "事実データ収集", text: `CRM ${crm.length}件 / 送信 ${stats.sent}件 / 実験 ${expSummary?.variants.length || 0} variants を対象` },
      { label: "セグメント別KPI算出", text: `業界×${stats.byIndustry.length} / 役職×${stats.byTitle.length} / 国×${stats.byCountry.length} バケット` },
      { label: "Claude で仮説・打ち手を推論", text: "事実→仮説→ネクストアクションの構造化JSONで生成中..." },
    ];
    setThinkLog(steps.map((s, i) => ({ ...s, state: i === 0 ? "active" : "pending" })));
    for (let i = 0; i < 2; i++) {
      await new Promise(r => setTimeout(r, 500));
      setThinkLog(prev => prev.map((s, idx) => idx === i ? { ...s, state: "done" } : idx === i + 1 ? { ...s, state: "active" } : s));
    }

    // プロンプト構築
    const expCompact = (expSummary?.variants || []).slice(0, 15).map(v => ({
      campaign: v.campaignName, label: v.label, subject: v.subject,
      sent: v.sent, openRate: v.openRate, ctr: v.ctr, replyRate: v.replyRate,
      cvRate: v.cvRate, planCvRate: v.planCvRate, planScore: v.planScore,
    }));
    const gaSummary = gaData?.rows?.length ? {
      totalSessions: gaData.rows.reduce((s, r) => s + r.sessions, 0),
      totalPageViews: gaData.rows.reduce((s, r) => s + r.pageViews, 0),
      totalScrolled: gaData.rows.reduce((s, r) => s + r.scrolledUsers, 0),
      totalConversions: gaData.rows.reduce((s, r) => s + r.conversions, 0),
      topPages: gaData.rows.slice(0, 5).map(r => ({ path: r.pagePath, pv: r.pageViews, scrolled: r.scrolledUsers, cv: r.conversions })),
    } : null;

    // セグメント利用可能なラベル一覧（ネクストアクションの実行先として）
    const segmentLabels = EMAIL_GROUPS.map(g => g.label);

    const prompt = `あなたはB2B営業のPDCAコンサルタントです。以下の実績データを元に「事実」→「仮説」→「ネクストアクション」の3ブロックで構造化された改善プランを日本語で出力してください。

${buildBusinessProfile(settings)}

【CRM全体KPI】
${JSON.stringify({
  総リスト: crm.length, 送信: stats.sent,
  開封率: stats.openRate, CTR: stats.ctr, 返信率: stats.replyRate, CV率: stats.cvRate,
  総スコア: stats.totalScore,
}, null, 2)}

【業界別KPI(TOP5)】
${JSON.stringify(stats.byIndustry.slice(0, 5), null, 2)}

【役職別KPI(TOP5・正規化済み)】
${JSON.stringify(stats.byTitleGroup.slice(0, 5), null, 2)}

【フェーズ別KPI】
${JSON.stringify(stats.byPhase, null, 2)}

【国別KPI(TOP5)】
${JSON.stringify(stats.byCountry.slice(0, 5), null, 2)}

【A/Bテスト実績（variant単位）】
${JSON.stringify(expCompact, null, 2)}

【セグメント×variant マトリクス（${matrixGroupBy}軸・勝者と敗者）】
${JSON.stringify((matrixData?.matrix || []).slice(0, 8).map(m => ({
  segment: m.segment, totalSent: m.totalSent,
  winner: { label: m.winner?.label, subject: m.winner?.subject?.slice(0, 40), rate: m.winner?.[m.winningMetric] },
  runnerUps: m.variants.slice(0, 3).map(v => ({ label: v.label, rate: v[m.winningMetric], sent: v.sent })),
})), null, 2)}

【学習済み重み（直近更新: ${weightsInfo?.updatedAt || "未実行"}）】
${JSON.stringify(weightsInfo?.weights || "未実行", null, 2)}

【GA4 サイト行動（直近${gaDays}日）】
${JSON.stringify(gaSummary, null, 2)}

【出力ルール】
- JSON 1個のみ。他のテキスト一切不要。Markdownコードブロックも付けない。
- factsは具体的数値を含める（例: 「SaaS×CxO×coldフェーズでの variant「好奇心型」の開封率が42%で、同セグメントの「損失回避型」17%の2.4倍」）
- **仮説・アクションはなるべくセグメント(業界×役職×フェーズ)の組み合わせで特定的に** 提示する。「全体で件名を変えよう」ではなく「SaaS業界のCxOには問いかけ件名が効くが、製造業のマネージャーには数値で効く」のように。
- hypotheses は各項目で evidence（根拠）と confidence（high/med/low）を必ず含める
- nextActions は3〜5個、実行可能で具体的なものに限る
- nextActions の type は以下のいずれか:
  - "retarget": ターゲティングの変更提案（検索条件を変えて新規リスト取得）
  - "rewrite":  メール文面の書き換え（件名・本文の改善案を含む）
  - "abtest":   A/Bテストでの検証（2-3パターンの案を含む。セグメント特定的な仮説を検証)
- nextActions の segmentLabel は次のいずれかから選ぶ: ${JSON.stringify(segmentLabels)}
- "reasoning" には「なぜ今これをやるべきか」を1-2文で、どのセグメントでどの仮説を検証するか明示

【出力フォーマット】
{
  "facts": ["数値を含む事実1", "事実2", "事実3", "事実4"],
  "hypotheses": [
    {"text":"仮説1", "evidence":"根拠となる事実", "confidence":"high|med|low"},
    {"text":"仮説2", "evidence":"...", "confidence":"..."}
  ],
  "nextActions": [
    {
      "type": "retarget|rewrite|abtest",
      "title": "アクション名",
      "reasoning": "なぜこれをやるべきか",
      "expectedImpact": "想定される効果（例: 開封率+5pt）",
      "segmentLabel": "対象セグメント（EMAIL_GROUPSのラベルから選択）",
      "targeting": {
        "industry": "業界名 or null",
        "titles": ["役職1","役職2"],
        "country": "国名 or null"
      },
      "variants": [
        {"label":"angle1", "angle":"訴求軸", "subject":"件名案", "body":"本文案（{{name}} {{company}} 使用可）"}
      ]
    }
  ]
}`;

    try {
      const text = await callClaude({ prompt, maxTokens: 3000, stream: true });
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("JSONの抽出に失敗しました");
      const parsed = JSON.parse(jsonMatch[0]);
      setPlan(parsed);
      setThinkLog(prev => prev.map(s => ({ ...s, state: "done" })));
    } catch (e) {
      setError("AI分析失敗: " + e.message);
      setThinkLog(prev => prev.map(s => ({ ...s, state: s.state === "done" ? "done" : "idle" })));
    }
    setLoading(false);
  };

  const confColor = (c) => c === "high" ? "#1D9E75" : c === "med" ? "#DD9A25" : "#888";
  const actionTypeMeta = {
    retarget: { label: "ターゲット変更", color: "#185FA5", bg: "#E6F1FB", icon: "🎯" },
    rewrite:  { label: "文面書き換え",   color: "#3C3489", bg: "#EEEDFE", icon: "✍️" },
    abtest:   { label: "A/Bテスト",     color: "#922B21", bg: "#FDEDEC", icon: "🧪" },
  };

  const executeAction = (action) => {
    const meta = actionTypeMeta[action.type];
    if (!meta) return;
    if (action.type === "retarget") {
      onNavigateTo("search", {
        suggestedTargeting: action.targeting,
      });
    } else if (action.type === "rewrite") {
      const v = action.variants?.[0];
      if (!v) return;
      onNavigateTo("email", {
        subject: v.subject, body: v.body,
        segmentLabel: action.segmentLabel,
        campaignName: action.title,
      });
    } else if (action.type === "abtest") {
      if (!action.variants || action.variants.length < 2) {
        alert("A/Bテスト用のバリアントが2つ以上必要です");
        return;
      }
      onNavigateTo("abtest", {
        variants: action.variants.map((v, i) => ({
          ...v, id: `pdca_${Date.now()}_${i}`,
          predOpen: v.predOpen || 0, predCtr: v.predCtr || 0,
        })),
        segmentLabel: action.segmentLabel,
        campaignName: action.title,
      });
    }
  };

  return (
    <div>
      <Section title="KPIサマリー"
        right={
          <select value={gaDays} onChange={e => setGaDays(Number(e.target.value))} style={{ fontSize: 12, padding: "3px 6px" }}>
            {[7, 14, 30, 90].map(n => <option key={n} value={n}>直近{n}日</option>)}
          </select>
        }>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
          {[
            { label: "送信数", value: stats.sent },
            { label: "開封率", value: stats.openRate + "%" },
            { label: "CTR", value: stats.ctr + "%" },
            { label: "返信率", value: stats.replyRate + "%" },
            { label: "契約率", value: stats.cvRate + "%" },
          ].map(m => (
            <div key={m.label} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "0.75rem", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>{m.value}</p>
              <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{m.label}</p>
            </div>
          ))}
        </div>
      </Section>

      {expSummary && expSummary.variants.length > 0 && (
        <Section title="実験（A/Bテスト）サマリー">
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
              <div style={{ textAlign: "center" }}><p style={{ fontSize: 18, margin: 0, fontWeight: 500 }}>{expSummary.campaigns.length}</p><p style={{ fontSize: 11, margin: 0, color: "var(--color-text-secondary)" }}>キャンペーン</p></div>
              <div style={{ textAlign: "center" }}><p style={{ fontSize: 18, margin: 0, fontWeight: 500 }}>{expSummary.variants.length}</p><p style={{ fontSize: 11, margin: 0, color: "var(--color-text-secondary)" }}>バリアント</p></div>
              <div style={{ textAlign: "center" }}><p style={{ fontSize: 18, margin: 0, fontWeight: 500 }}>{expSummary.variants.reduce((s, v) => s + v.sent, 0)}</p><p style={{ fontSize: 11, margin: 0, color: "var(--color-text-secondary)" }}>総送信</p></div>
              <div style={{ textAlign: "center" }}><p style={{ fontSize: 18, margin: 0, fontWeight: 500 }}>{expSummary.variants.reduce((s, v) => s + v.planScore, 0)}</p><p style={{ fontSize: 11, margin: 0, color: "var(--color-text-secondary)" }}>総プランPt</p></div>
            </div>
          </Card>
        </Section>
      )}

      {/* セグメント×variant マトリクス */}
      <Section title="セグメント × バリアント マトリクス"
        right={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>軸:</span>
            {[
              { key: "industry", label: "業界" },
              { key: "titleGroup", label: "役職" },
              { key: "phase", label: "フェーズ" },
              { key: "country", label: "国" },
              { key: "segmentKey", label: "業界×役職×フェーズ" },
            ].map(op => (
              <button key={op.key} onClick={() => setMatrixGroupBy(op.key)}
                style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: matrixGroupBy === op.key ? "#185FA5" : "transparent", color: matrixGroupBy === op.key ? "#fff" : "var(--color-text-secondary)", border: matrixGroupBy === op.key ? "none" : "0.5px solid var(--color-border-secondary)" }}>
                {op.label}
              </button>
            ))}
          </div>
        }>
        <Card>
          {!matrixData || !matrixData.matrix?.length ? (
            <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>
              このセグメント軸でまだ十分なデータがありません(最低10件)。送信を続けると自動で表示されます。
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "0.5px solid var(--color-border-secondary)" }}>
                    {["セグメント", "送信", "開封率", "CV率", "プランPt", "勝者variant", "勝者件名", "勝者レート", "敗者"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500, color: "var(--color-text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixData.matrix.map(m => {
                    const losers = m.variants.filter(v => v.variantId !== m.winner?.variantId).slice(0, 2);
                    return (
                      <tr key={m.segment} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 500 }}>{m.segment}</td>
                        <td style={{ padding: "6px 8px" }}>{m.totalSent}</td>
                        <td style={{ padding: "6px 8px" }}>{m.openRate}%</td>
                        <td style={{ padding: "6px 8px" }}>{m.cvRate}%</td>
                        <td style={{ padding: "6px 8px", fontWeight: 500 }}>{m.totalPlanScore}</td>
                        <td style={{ padding: "6px 8px" }}>
                          <span style={{ fontSize: 11, fontWeight: 500, padding: "1px 6px", borderRadius: 6, background: "#EAF3DE", color: "#27500A" }}>🏆 {m.winner?.label}</span>
                        </td>
                        <td style={{ padding: "6px 8px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>{m.winner?.subject}</td>
                        <td style={{ padding: "6px 8px" }}><strong>{m.winner?.[m.winningMetric]}%</strong> <span style={{ color: "var(--color-text-tertiary)" }}>({m.winningMetric})</span></td>
                        <td style={{ padding: "6px 8px", color: "var(--color-text-tertiary)", fontSize: 11 }}>
                          {losers.map(l => `${l.label}:${l[m.winningMetric]}%`).join(", ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "8px 0 0" }}>
                💡 このマトリクスは「どのセグメントで、どのメッセージが効いたか」を示します。セグメントごとに勝ちメッセージが違う場合、次は<strong>セグメント別の文面</strong>で送ることで CV率が跳ね上がります。
              </p>
            </div>
          )}
        </Card>
      </Section>

      {/* 学習ループ */}
      <Section title="学習ループ(スコア重みの自動更新)"
        right={
          <button onClick={runLearning} disabled={learningBusy}
            style={{ fontSize: 12, padding: "6px 14px", background: "#185FA5", color: "#fff", border: "none", borderRadius: 8 }}>
            {learningBusy ? "学習中..." : "勝ちパターンから重みを更新"}
          </button>
        }>
        <Card>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 8px", lineHeight: 1.7 }}>
            送信実績の中から「CV に至った contact」と「至らなかった contact」を比較し、<br />
            業界・役職・国ごとに <strong>lift (勝ち率 ÷ ベース率)</strong> を計算してスコア重みに反映します。<br />
            これにより「次にリスト化すべき属性」が自動で優先されるようになります。
          </p>

          {weightsInfo?.updatedAt ? (
            <div style={{ padding: "8px 12px", background: "var(--color-background-secondary)", borderRadius: 6, marginBottom: 10 }}>
              <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "0 0 6px" }}>
                最終更新: <strong>{new Date(weightsInfo.updatedAt).toLocaleString("ja-JP")}</strong>
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, fontSize: 11 }}>
                {["industry", "title", "country"].map(axis => {
                  const w = weightsInfo.weights?.[axis] || {};
                  const entries = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 5);
                  return (
                    <div key={axis}>
                      <strong style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase" }}>{axis}</strong>
                      {entries.length === 0 ? (
                        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--color-text-tertiary)" }}>—</p>
                      ) : entries.map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 11 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{k}</span>
                          <span style={{ color: v >= 1.5 ? "#1D9E75" : v < 0.7 ? "#E24B4A" : "var(--color-text-secondary)", fontWeight: v >= 1.5 || v < 0.7 ? 500 : 400 }}>×{v}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: 0 }}>まだ学習が実行されていません。CV が3件以上蓄積してから実行してください。</p>
          )}

          {learningResult && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: learningResult.ok ? "#E1F5EE" : "#FCEBEB", color: learningResult.ok ? "#085041" : "#791F1F", fontSize: 12 }}>
              {learningResult.ok ? (
                <>
                  ✓ 学習完了 — 勝ち事例 <strong>{learningResult.stats?.winners}</strong>件 / 全 <strong>{learningResult.stats?.total}</strong>件から重みを更新しました。
                  スコアは次回の検索・ランキングから反映されます。
                </>
              ) : (
                <>❌ 学習失敗: {learningResult.reason}</>
              )}
            </div>
          )}
        </Card>
      </Section>

      <Section title="PDCA 分析 — 思考回路を明示" right={
        <button onClick={runAnalysis} disabled={loading || stats.sent < 5} style={{ fontSize: 12, padding: "6px 14px", background: "var(--color-text-primary)", color: "var(--color-background-primary)", border: "none", borderRadius: 8 }}>
          {loading ? "分析中..." : stats.sent < 5 ? `データ不足 (送信${stats.sent}/5)` : "事実→仮説→ネクストアクションを生成"}
        </button>
      }>
        {thinkLog.length > 0 && !plan && (
          <div style={{ marginBottom: "1rem" }}>
            {thinkLog.map((s, i) => (
              <div key={i} style={{
                padding: "8px 12px", borderLeft: `2px solid ${s.state === "done" ? "#1D9E75" : s.state === "active" ? "#378ADD" : "var(--color-border-tertiary)"}`,
                marginBottom: 6, borderRadius: "0 6px 6px 0",
                background: "var(--color-background-secondary)",
                fontSize: 12, lineHeight: 1.6,
                color: s.state === "done" ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              }}>
                <strong style={{ fontSize: 11 }}>{s.label}</strong><br />{s.text}
              </div>
            ))}
          </div>
        )}

        {error && <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FCEBEB", color: "#791F1F", fontSize: 13, marginBottom: "1rem" }}>{error}</div>}

        {!plan && !loading && (
          <Card><p style={{ color: "var(--color-text-tertiary)", fontSize: 13, margin: 0 }}>
            ボタンを押すと、送信実績・A/Bテスト結果・GA4データを総合分析し、「事実→仮説→ネクストアクション」を構造化して出力します。各ネクストアクションはワンクリックで該当タブへ流し込めます。
          </p></Card>
        )}

        {plan && (
          <>
            {/* 事実 */}
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 4, height: 16, background: "#185FA5", borderRadius: 2 }} />
                事実 <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>— データが示していること</span>
              </p>
              <Card style={{ borderLeft: "3px solid #185FA5" }}>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
                  {plan.facts.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </Card>
            </div>

            {/* 仮説 */}
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 4, height: 16, background: "#3C3489", borderRadius: 2 }} />
                仮説 <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>— 事実からの推論</span>
              </p>
              <Card style={{ borderLeft: "3px solid #3C3489" }}>
                {plan.hypotheses.map((h, i) => (
                  <div key={i} style={{ padding: "8px 0", borderBottom: i < plan.hypotheses.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, flex: 1 }}>{h.text}</p>
                      <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 100, background: confColor(h.confidence) + "22", color: confColor(h.confidence), flexShrink: 0 }}>
                        確信度 {h.confidence}
                      </span>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--color-text-secondary)" }}>
                      <strong>根拠:</strong> {h.evidence}
                    </p>
                  </div>
                ))}
              </Card>
            </div>

            {/* ネクストアクション */}
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 4, height: 16, background: "#1D9E75", borderRadius: 2 }} />
                ネクストアクション <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>— 今すぐ実行できる打ち手</span>
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {plan.nextActions.map((a, i) => {
                  const meta = actionTypeMeta[a.type] || { label: a.type, color: "#444", bg: "#F1EFE8", icon: "•" };
                  return (
                    <Card key={i} style={{ borderLeft: `3px solid ${meta.color}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 100, background: meta.bg, color: meta.color }}>
                              {meta.icon} {meta.label}
                            </span>
                            {a.segmentLabel && <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>→ {a.segmentLabel}</span>}
                          </div>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{a.title}</p>
                        </div>
                        <button onClick={() => executeAction(a)} style={{ fontSize: 12, padding: "6px 14px", background: meta.color, color: "#fff", border: "none", borderRadius: 8, flexShrink: 0 }}>
                          実行 →
                        </button>
                      </div>
                      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                        <strong>理由:</strong> {a.reasoning}
                      </p>
                      {a.expectedImpact && (
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
                          <strong>想定効果:</strong> {a.expectedImpact}
                        </p>
                      )}
                      {a.targeting && (a.targeting.industry || a.targeting.titles?.length || a.targeting.country) && (
                        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--color-text-tertiary)" }}>
                          ターゲット: {a.targeting.industry || "—"} × {a.targeting.titles?.join(", ") || "—"} × {a.targeting.country || "—"}
                        </p>
                      )}
                      {a.variants && a.variants.length > 0 && (
                        <details style={{ marginTop: 6 }}>
                          <summary style={{ fontSize: 11, color: "var(--color-text-secondary)", cursor: "pointer" }}>
                            バリアント案 {a.variants.length}件 を見る
                          </summary>
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                            {a.variants.map((v, vi) => (
                              <div key={vi} style={{ padding: "6px 10px", background: "var(--color-background-secondary)", borderRadius: 6, fontSize: 12 }}>
                                <p style={{ margin: "0 0 2px", fontWeight: 500 }}>{v.angle && `[${v.angle}] `}{v.subject}</p>
                                <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{v.body}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </Section>

      {/* 既存の業界別・役職別テーブル */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: "1.5rem" }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 0.75rem" }}>業界別スコア</p>
          <Card style={{ padding: "0.5rem 1rem" }}>
            {stats.byIndustry.length === 0 ? <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: "0.5rem 0" }}>データなし</p> : stats.byIndustry.map(v => (
              <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{v.count}件</span>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>返信{v.replyRate}%</span>
                <ScoreBadge score={v.score} />
              </div>
            ))}
          </Card>
        </div>
        <div>
          <p style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 0.75rem" }}>役職別スコア</p>
          <Card style={{ padding: "0.5rem 1rem" }}>
            {stats.byTitle.length === 0 ? <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: "0.5rem 0" }}>データなし</p> : stats.byTitle.map(v => (
              <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ fontSize: 13, flex: 1 }}>{v.name}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{v.count}件</span>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>返信{v.replyRate}%</span>
                <ScoreBadge score={v.score} />
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Supabase ヘルパー
// ════════════════════════════════════════════════════════════
function supabase(url, key) {
  const headers = { "Content-Type": "application/json", "apikey": key, "Authorization": `Bearer ${key}` };
  return {
    async getSettings() {
      const res = await fetch(`${url}/rest/v1/settings?id=eq.default&select=data`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      return rows[0]?.data || null;
    },
    async saveSettings(data) {
      const res = await fetch(`${url}/rest/v1/settings`, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ id: "default", data, updated_at: new Date().toISOString() })
      });
      if (!res.ok) throw new Error(await res.text());
    },
    async getContacts() {
      const res = await fetch(`${url}/rest/v1/crm_contacts?select=*&order=added_at.asc`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      // DB カラム → アプリ内フィールド名へ正規マッピング
      return rows.map(c => ({
        id:          c.id,
        name:        c.name        || "",
        title:       c.title       || "",
        company:     c.company     || "",
        industry:    c.industry    || "",
        email:       c.email       || "",
        linkedin:    c.linkedin    || "",
        linkedinUrl: c.linkedin    || "",   // 両フィールドに展開
        country:     c.country     || "",
        status:      c.status      || "未送信",
        score:       c.score       || 0,
        clicked:     c.clicked     || false,
        opens:       c.opens       || 0,
        gaData:      c.ga_data     || null,
        notes:       c.notes       || "",
        subject:     c.subject     || "",
        messageBody: c.message_body || "",
        trackingId:  c.tracking_id || null,
        sentAt:      c.sent_at     || null,
        addedAt:     c.added_at    || null,
        // DB に存在しないフィールドはデフォルト値で補完
        campaignId:  null,
        variantId:   null,
        clicks:      0,
      }));
    },
    async upsertContact(c) {
      // テーブルに存在するカラムだけを送信（余分なフィールドは 42703 エラーになる）
      const body = {
        id:           c.id,
        name:         c.name         || null,
        title:        c.title        || null,
        company:      c.company      || null,
        industry:     c.industry     || null,
        email:        c.email        || null,
        linkedin:     c.linkedinUrl  || c.linkedin || null,
        country:      c.country      || null,
        status:       c.status       || "未送信",
        score:        calcScore(c),
        clicked:      c.clicked      || false,
        opens:        c.opens        || 0,
        ga_data:      c.gaData       || null,
        notes:        c.notes        || null,
        subject:      c.subject      || null,
        message_body: c.messageBody  || null,
        tracking_id:  c.trackingId   || null,
        sent_at:      c.sentAt       || null,
        added_at:     c.addedAt      || new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      };
      const res = await fetch(`${url}/rest/v1/crm_contacts`, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    async deleteContact(id) {
      const res = await fetch(`${url}/rest/v1/crm_contacts?id=eq.${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error(await res.text());
    },
  };
}

function dbFromSettings(settings) {
  if (!settings.supabaseUrl || !settings.supabaseKey) return null;
  return supabase(settings.supabaseUrl, settings.supabaseKey);
}

// ════════════════════════════════════════════════════════════
// Root
// ════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState(0);
  const [settings, setSettings] = useState({
    apolloKey:   import.meta.env.VITE_APOLLO_KEY   || "",
    fromEmail:   import.meta.env.VITE_FROM_EMAIL   || "",
    gmailPass:   import.meta.env.VITE_GMAIL_PASS   || "",
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || "",
    supabaseKey: import.meta.env.VITE_SUPABASE_KEY || "",
  });
  const [crm, setCrm] = useState([]);
  const [trackingActive, setTrackingActive] = useState(false);
  const [lastPolled, setLastPolled] = useState(null);
  const [dbStatus, setDbStatus] = useState(null);
  const [dbLoading, setDbLoading] = useState(false);
  const pollingRef = useRef(null);

  // 汎用 prefill: 各タブへ受け渡すデータ
  const [emailPrefill, setEmailPrefill] = useState({});
  const [abtestPrefill, setAbtestPrefill] = useState({});
  const [searchPrefill, setSearchPrefill] = useState({});

  const { sendPageView, sendScroll } = useGA4Tracking();
  const TAB_KEYS  = ["settings", "search", "list", "email", "abtest", "crm", "pdca", "deliverability"];
  const TAB_PATHS = TAB_KEYS.map(k => "/" + k);
  const scrollFiredRef = useRef({});

  const navigateTo = (tabKey, prefillData) => {
    const idx = TAB_KEYS.indexOf(tabKey);
    if (idx < 0) return;
    if (tabKey === "email" && prefillData)  setEmailPrefill(prefillData);
    if (tabKey === "abtest" && prefillData) setAbtestPrefill(prefillData);
    if (tabKey === "search" && prefillData) setSearchPrefill(prefillData);
    setTab(idx);
    sendPageView(TAB_PATHS[idx], TABS[idx]);
  };

  const handleTabChange = (i) => {
    setTab(i);
    sendPageView(TAB_PATHS[i], TABS[i]);
  };

  useEffect(() => {
    const pagePath = TAB_PATHS[tab];
    const handleScroll = () => {
      if (scrollFiredRef.current[pagePath]) return;
      const el  = document.documentElement;
      const pct = (el.scrollTop + el.clientHeight) / el.scrollHeight * 100;
      if (pct >= 90) { scrollFiredRef.current[pagePath] = true; sendScroll(pagePath); }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [tab, sendScroll]); // eslint-disable-line

  useEffect(() => { sendPageView(TAB_PATHS[0], TABS[0]); }, []); // eslint-disable-line

  useEffect(() => {
    const url = settings.supabaseUrl;
    const key = settings.supabaseKey;
    if (!url || !key) return;
    setDbLoading(true);
    const db = supabase(url, key);
    Promise.all([db.getSettings(), db.getContacts()])
      .then(([savedSettings, contacts]) => {
        if (savedSettings) setSettings(prev => ({ ...prev, ...savedSettings, supabaseUrl: url, supabaseKey: key }));
        if (contacts?.length) {
          // getContacts() が既にアプリ内フィールド名にマッピング済み
          setCrm(contacts);
        }
        setDbStatus({ ok: true });
      })
      .catch(e => setDbStatus({ ok: false, msg: e.message }))
      .finally(() => setDbLoading(false));
  }, [settings.supabaseUrl, settings.supabaseKey]);

  // 起動時 + 15分ごと: 学習重みをサーバーから取得
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${RAILWAY}/learning/weights`);
        if (r.ok) {
          const d = await r.json();
          LEARNED_WEIGHTS = d.weights || LEARNED_WEIGHTS;
          LEARNED_WEIGHTS_UPDATED_AT = d.updatedAt || null;
        }
      } catch {}
    };
    load();
    const iv = setInterval(load, 15 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  // ── DB sync ──
  // settingsRef で常に最新の settings を参照（クロージャの古い値を防ぐ）
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const syncContact = useCallback(async (contact) => {
    const db = dbFromSettings(settingsRef.current);
    if (!db) {
      console.warn("DB未設定のためスキップ:", contact.name);
      return;
    }
    try {
      await db.upsertContact(contact);
      setDbStatus(prev => ({ ...prev, ok: true, lastSync: new Date().toISOString() }));
      console.log("✅ DB保存成功:", contact.name, contact.id);
    } catch (e) {
      console.error("❌ DB sync error:", e.message, "| contact:", contact.name, contact.id);
      setDbStatus({ ok: false, msg: `DB保存エラー: ${e.message}` });
    }
  }, []);

  const deleteContact = useCallback(async (id) => {
    const db = dbFromSettings(settingsRef.current);
    if (!db) return;
    try { await db.deleteContact(id); }
    catch (e) { console.error("DB delete error:", e.message); }
  }, []);

  // CRM 更新 + DB 同期。updater 関数の外で副作用を発火する
  const setCrmWithSync = useCallback((updater) => {
    setCrm(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;

      // 副作用は setTimeout で updater の外に追い出す
      setTimeout(() => {
        next.forEach(c => {
          const old = prev.find(p => p.id === c.id);
          // 新規 or 変更があった場合のみ upsert
          if (!old || JSON.stringify(old) !== JSON.stringify(c)) {
            syncContact(c);
          }
        });
        prev.forEach(p => {
          if (!next.find(c => c.id === p.id)) deleteContact(p.id);
        });
      }, 0);

      return next;
    });
  }, [syncContact, deleteContact]);

  const saveSettingsToDb = async () => {
    const db = dbFromSettings(settings);
    if (!db) { setDbStatus({ ok: false, msg: ".envにSUPABASE_URLとSUPABASE_KEYを設定してください" }); return; }
    try {
      const { apolloKey, fromEmail, gmailPass, supabaseUrl, supabaseKey, ...companyInfo } = settings;
      await db.saveSettings(companyInfo);
      setDbStatus({ ok: true });
    } catch (e) { setDbStatus({ ok: false, msg: e.message }); }
  };

  // トラッキングポーリング（既存ロジックを維持）
  useEffect(() => {
    const hasSent = crm.some(c => c.status !== "未送信" && c.trackingId);
    if (hasSent && !pollingRef.current) {
      setTrackingActive(true);
      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${RAILWAY}/track/status`);
          if (!res.ok) return;
          const statusMap = await res.json();
          setLastPolled(new Date().toLocaleTimeString("ja-JP"));

          // dollar-biz Supabase からプラン状態を同期(5回に1回 = 5分ごと)
          let planSyncResults = {};
          if (!pollingRef._syncCounter) pollingRef._syncCounter = 0;
          pollingRef._syncCounter++;
          if (pollingRef._syncCounter % 5 === 0) {
            try {
              const emails = crm.filter(c => c.email).map(c => c.email.toLowerCase());
              if (emails.length > 0) {
                const psRes = await fetch(`${RAILWAY}/plan-sync`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ emails }),
                });
                if (psRes.ok) {
                  const psData = await psRes.json();
                  planSyncResults = psData.results || {};
                }
              }
            } catch {}
          }

          setCrm(prev => {
            const next = prev.map(c => {
              const s = statusMap[c.id];
              let updated = { ...c };

              // ── tracker.js 由来のステータス更新 ──
              if (s) {
                if (s.clicked && !c.clicked) updated.clicked = true;
                if (typeof s.opens === "number" && s.opens > (c.opens || 0)) updated.opens = s.opens;
                if (s.opened && c.status === "送信済み") updated.status = "開封済み";
                if (s.replied && !["返信あり","商談中","Professional","Corporate","Enterprise","Lifetime","クローズ"].includes(c.status)) {
                  updated.status = "返信あり";
                }
                if (s.planStatus && s.planConvertedAt) {
                  const currentPlanScore = PLAN_CONFIG[c.status]?.score || 0;
                  if (s.planScore > currentPlanScore) {
                    updated.status = s.planStatus;
                  }
                }
                // Dashboard到達CV(convertedAt あり、プラン未契約) = Sandbox 自動昇格
                if (s.convertedAt && !s.planStatus) {
                  const currentScore = PLAN_CONFIG[c.status]?.score || SCORE_WEIGHTS[c.status] || 0;
                  const sandboxScore = PLAN_CONFIG["Sandbox"]?.score || 50;
                  if (currentScore < sandboxScore) {
                    updated.status = "Sandbox";
                  }
                }
                const prevGa = c.gaData || {};
                updated.gaData = {
                  ...prevGa,
                  sessions:        Math.max(s.sessions      ?? 0, prevGa.sessions      || 0),
                  pageViews:       Math.max(s.pageViews     ?? 0, prevGa.pageViews     || 0),
                  scrolledUsers:   Math.max(s.scrolledUsers ?? 0, prevGa.scrolledUsers || 0),
                  conversions:     Math.max((s.ga4Conversions ?? s.conversions ?? 0), prevGa.conversions || 0),
                  planStatus:      (s.planScore || 0) >= (prevGa.planScore || 0) && s.planStatus
                    ? s.planStatus : prevGa.planStatus || null,
                  planScore:       Math.max(s.planScore || 0, prevGa.planScore || 0),
                  planConvertedAt: s.planConvertedAt || prevGa.planConvertedAt || null,
                };
              }

              // ── Supabase profiles.plan 由来のプラン同期(上書き優先) ──
              if (c.email) {
                const ps = planSyncResults[c.email.toLowerCase()];
                if (ps && ps.status) {
                  const currentScore = PLAN_CONFIG[updated.status]?.score || SCORE_WEIGHTS[updated.status] || 0;
                  if (ps.score > currentScore) {
                    updated.status = ps.status;
                    // gaData にもプラン情報を反映
                    updated.gaData = {
                      ...(updated.gaData || {}),
                      planStatus: ps.status,
                      planScore: ps.score,
                      planConvertedAt: updated.gaData?.planConvertedAt || new Date().toISOString(),
                    };
                  }
                }
              }

              return updated;
            });
            next.forEach((c, i) => {
              if (JSON.stringify(c) !== JSON.stringify(prev[i])) syncContact(c);
            });
            return next;
          });
        } catch {}
      }, 60000);
    }
    if (!hasSent && pollingRef.current) {
      clearInterval(pollingRef.current); pollingRef.current = null; setTrackingActive(false);
    }
    return () => {};
  }, [crm]); // eslint-disable-line

  useEffect(() => { return () => { if (pollingRef.current) clearInterval(pollingRef.current); }; }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)", fontFamily: "var(--font-sans)" }}>
      <div style={{ background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0 1.5rem" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "#185FA5", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 10L5 4L8 8L10 6L12 10H2Z" fill="white" /></svg>
            </div>
            <span style={{ fontWeight: 500, fontSize: 15 }}>Sales Automation — PDCA</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {dbLoading && <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>DB読み込み中...</span>}
            {!dbLoading && dbStatus && (
              <span
                onClick={() => !dbStatus.ok && dbStatus.msg && alert(`DB保存エラー詳細:\n\n${dbStatus.msg}\n\nブラウザの開発者ツール → Console タブも確認してください。`)}
                title={dbStatus.ok
                  ? (dbStatus.lastSync ? `最終同期: ${dbStatus.lastSync}` : "DB接続済み")
                  : (dbStatus.msg || "DB未接続")}
                style={{ fontSize: 11, color: dbStatus.ok ? "var(--color-text-success)" : "var(--color-text-danger)", display: "flex", alignItems: "center", gap: 4, cursor: dbStatus.ok ? "default" : "pointer" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: dbStatus.ok ? "#1D9E75" : "#E24B4A", display: "inline-block" }} />
                {dbStatus.ok ? `DB同期中${dbStatus.lastSync ? "" : ""}` : "⚠ DB保存エラー（クリックで詳細）"}
              </span>
            )}
            {!dbStatus && settingsRef?.current?.supabaseUrl && (
              <span style={{ fontSize: 11, color: "#D4AC0D", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#D4AC0D", display: "inline-block" }} />
                DB未接続
              </span>
            )}
            {trackingActive && (
              <span style={{ fontSize: 11, color: "var(--color-text-success)", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1D9E75", display: "inline-block" }} />
                トラッキング中{lastPolled ? ` · ${lastPolled}` : ""}
              </span>
            )}
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
              CRMリスト: {crm.length}件 · 総スコア: {crm.reduce((s, c) => s + calcScore(c), 0)}pt
            </span>
          </div>
        </div>
      </div>
      <div style={{ background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex" }}>
          {TABS.map((t, i) => (
            <button key={t} onClick={() => handleTabChange(i)}
              style={{ fontSize: 13, padding: "0 16px", height: 40, border: "none", borderBottom: i === tab ? "2px solid #185FA5" : "2px solid transparent", background: "transparent", color: i === tab ? "#185FA5" : "var(--color-text-secondary)", fontWeight: i === tab ? 500 : 400, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap" }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "1.5rem" }}>
        {tab === 0 && <SettingsTab settings={settings} setSettings={setSettings} onSaveToDb={saveSettingsToDb} dbStatus={dbStatus} />}
        {tab === 1 && <IntentSearchTab settings={settings} crm={crm} setCrm={setCrmWithSync} prefill={searchPrefill} />}
        {tab === 2 && <ListTab crm={crm} setCrm={setCrmWithSync} />}
        {tab === 3 && (
          <EmailTab
            settings={settings} crm={crm} setCrm={setCrmWithSync}
            prefill={emailPrefill}
            onClearPrefill={() => setEmailPrefill({})}
            onNavigateTo={navigateTo}
          />
        )}
        {tab === 4 && (
          <ABTestTab
            settings={settings} crm={crm} setCrm={setCrmWithSync}
            prefill={abtestPrefill}
            onClearPrefill={() => setAbtestPrefill({})}
          />
        )}
        {tab === 5 && <CrmTab crm={crm} />}
        {tab === 6 && <PDCATab crm={crm} settings={settings} onNavigateTo={navigateTo} />}
        {tab === 7 && <DeliverabilityTab />}
      </div>
    </div>
  );
}