// ESboard MVP1 - Final app.js (Arena + Tabs + i18n + Local Profile + Supabase Auth)
console.log("[ESboard] app.js loaded");

// ===============================
// LocalStorage Keys
// ===============================
const LS_KEY_POINTS = "esboard_points_v1";
const LS_LANG = "esboard_lang_v1";
const LS_PROFILE = "esboard_profile_v1";

// ===============================
// ✅ Supabase Config (前端只用 Publishable key)
// ===============================
const SUPABASE_URL = "https://fnlrhubwmjxnfwmkcrx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vNiDiJP9Sugl8U7boD3_gg_D3VxN..."; // ✅换成完整的 publishable key

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;

  if (!window.supabase) {
    console.warn("[ESboard] supabase-js not loaded. Did you add the CDN <script> in index.html?");
    return null;
  }

  if (
    !SUPABASE_URL ||
    SUPABASE_URL.includes("PASTE_") ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_ANON_KEY.includes("PASTE_")
  ) {
    console.warn("[ESboard] Supabase URL / ANON KEY not configured.");
    return null;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

// ===============================
// Points
// ===============================
function getPoints() {
  const v = localStorage.getItem(LS_KEY_POINTS);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function renderPoints() {
  const el = document.getElementById("points");
  if (el) el.textContent = String(getPoints());
}
function setPoints(n) {
  localStorage.setItem(LS_KEY_POINTS, String(n));
  renderPoints();
}

// ===============================
// Status
// ===============================
function setStatus(text, kind = "muted") {
  const el = document.getElementById("status");
  if (!el) return;
  el.className = kind === "ok" ? "ok" : kind === "warn" ? "warn" : "muted";
  el.textContent = text || "";
}

// ===============================
// Helpers
// ===============================
function parseLast5(str) {
  const s = (str || "").trim().toUpperCase();
  if (!s) return [];
  if (s.includes(",")) {
    return s
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x === "W" || x === "L");
  }
  return s.split("").filter((ch) => ch === "W" || ch === "L");
}

function formScore(last5) {
  if (!last5.length) return 0;
  const wins = last5.filter((x) => x === "W").length;
  return wins / last5.length; // 0..1
}

// ---- deterministic random (stable per team) ----
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seeded01(seed) {
  let x = seed >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x >>>= 0;
  x ^= x << 5;
  x >>>= 0;
  return (x >>> 0) / 4294967296;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// ===============================
// Build team profile
// ===============================
function buildTeamProfile({ name, game, last5 }) {
  const base =
    game === "lol"
      ? { mechanical: 78, iq: 82, teamwork: 84, clutch: 78, adapt: 80, strat: 84 }
      : { mechanical: 82, iq: 78, teamwork: 80, clutch: 82, adapt: 78, strat: 80 };

  const seed = hashString(`${name}|${game}`);
  const r = (k) => seeded01(seed + k);
  const v = (x) => (x - 0.5) * 12; // ±6

  const form = formScore(last5);
  const form100 = Math.round(form * 100);

  return {
    name,
    game,
    mechanical: clamp(Math.round(base.mechanical + v(r(1))), 40, 99),
    iq: clamp(Math.round(base.iq + v(r(2))), 40, 99),
    teamwork: clamp(Math.round(base.teamwork + v(r(3))), 40, 99),
    clutch: clamp(Math.round(base.clutch + v(r(4))), 40, 99),
    adapt: clamp(Math.round(base.adapt + v(r(5))), 40, 99),
    strat: clamp(Math.round(base.strat + v(r(6))), 40, 99),
    form: clamp(form100, 0, 100),
    last5: last5.join("") || "N/A",
  };
}

// ===============================
// Arena weights
// ===============================
const ARENA_WEIGHTS = {
  mechanical: 0.18,
  iq: 0.18,
  teamwork: 0.16,
  clutch: 0.14,
  form: 0.16,
  adapt: 0.08,
  strat: 0.10,
};

function weightedScore(p, weights) {
  let s = 0;
  for (const k of Object.keys(weights)) s += p[k] * weights[k];
  return s; // 0..100
}

function logisticProb(diff) {
  const scale = 7.5;
  const x = diff / scale;
  const p = 1 / (1 + Math.exp(-x));
  return clamp(p, 0.05, 0.95);
}

function confidenceFromProb(pA) {
  const d = Math.abs(pA - 0.5);
  if (d >= 0.18) return "High";
  if (d >= 0.08) return "Medium";
  return "Low";
}

function topDiffReasons(a, b) {
  const keys = ["mechanical", "iq", "teamwork", "clutch", "form", "adapt", "strat"];
  const diffs = keys.map((k) => ({ k, diff: a[k] - b[k] }));
  diffs.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));

  const pretty = {
    mechanical: "Mechanical（操作/枪法）",
    iq: "Game IQ（理解/决策）",
    teamwork: "Teamwork（团队配合）",
    clutch: "Clutch（关键局抗压）",
    form: "Form（近期状态）",
    adapt: "Adapt（适应/学习）",
    strat: "Strat（战术/体系）",
  };

  return diffs.slice(0, 3).map((x) => {
    const side = x.diff > 0 ? "Team A" : "Team B";
    const val = Math.abs(x.diff);
    return `${pretty[x.k]} 差距：${side} +${val.toFixed(0)}`;
  });
}

function buildTimeline(mode, a, b, winnerSide) {
  const arena = mode === "arena";
  const w = winnerSide === "A" ? a.name : b.name;
  const l = winnerSide === "A" ? b.name : a.name;

  if (arena) {
    return [
      { phase: "Early", event: `ESboard Arena 开局：双方互相试探，${w} 通过“节奏/资源”取得小优势。` },
      { phase: "Mid", event: `中盘：关键在执行与沟通。${w} 在一次“关键交换”中扩大优势，${l} 尝试反打。` },
      { phase: "Late", event: `终盘：抗压与关键决策决定胜负。${w} 抓住对手失误完成终结。` },
    ];
  }

  if (a.game === "lol" && b.game === "lol") {
    return [
      { phase: "Early", event: "前期：线权/野区节奏与第一条资源，决定中期主动权。" },
      { phase: "Mid", event: `中期：团战/运营二选一，${w} 的决策更干净，逐步滚起雪球。` },
      { phase: "Late", event: `后期：大龙/远古龙决战，${w} 处理更稳，拿下比赛。` },
    ];
  }

  return [
    { phase: "Early", event: "开局：枪感与默认控图，决定经济走向。" },
    { phase: "Mid", event: `中段：关键翻盘局/强起局，${w} 赢下关键回合建立心理优势。` },
    { phase: "Late", event: `收尾：残局与道具执行，${w} 更稳，终结比赛。` },
  ];
}

// ===============================
// Simulate
// ===============================
function simulate({ mode, bo, teamA, teamB }) {
  const aScore = weightedScore(teamA, ARENA_WEIGHTS);
  const bScore = weightedScore(teamB, ARENA_WEIGHTS);

  const boN = Number(bo);
  const boBonusA = (boN >= 3 ? (teamA.teamwork + teamA.strat) : teamA.form) * 0.01;
  const boBonusB = (boN >= 3 ? (teamB.teamwork + teamB.strat) : teamB.form) * 0.01;

  const finalA = aScore + boBonusA;
  const finalB = bScore + boBonusB;

  const pA = logisticProb(finalA - finalB);
  const pB = 1 - pA;

  const winnerSide = pA >= 0.5 ? "A" : "B";
  const confidence = confidenceFromProb(pA);

  const reasons = [
    `Arena Score A: ${finalA.toFixed(1)} vs B: ${finalB.toFixed(1)} (BO${bo})`,
    ...topDiffReasons(teamA, teamB),
    `Form: A ${teamA.form}% (${teamA.last5}) vs B ${teamB.form}% (${teamB.last5})`,
  ];

  const summary =
    mode === "arena"
      ? `跨领域 Arena 模式：用统一属性面板模拟对抗。${
          winnerSide === "A" ? teamA.name : teamB.name
        } 略占上风（Confidence: ${confidence}）。`
      : `同游戏对战：${winnerSide === "A" ? teamA.name : teamB.name} 更可能在 BO${bo} 中赢下系列赛（Confidence: ${confidence}）。`;

  return {
    mode,
    bo: `BO${bo}`,
    summary,
    confidence,
    winProb: { A: Math.round(pA * 100), B: Math.round(pB * 100) },
    winnerSide,
    teamA,
    teamB,
    reasons,
    timeline: buildTimeline(mode, teamA, teamB, winnerSide),
  };
}

// ===============================
// Render output
// ===============================
function renderStats(containerId, p) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const rows = [
    ["Mechanical", p.mechanical],
    ["Game IQ", p.iq],
    ["Teamwork", p.teamwork],
    ["Clutch", p.clutch],
    ["Form", p.form],
    ["Adapt", p.adapt],
    ["Strat", p.strat],
  ];

  el.innerHTML = rows
    .map(([k, v]) => `<div class="statrow"><div>${k}</div><div><b>${v}</b></div></div>`)
    .join("");
}

function renderOutput(data) {
  const empty = document.getElementById("outputEmpty");
  const wrap = document.getElementById("outputWrap");
  if (empty) empty.style.display = "none";
  if (wrap) wrap.style.display = "block";

  const outMatchTitle = document.getElementById("outMatchTitle");
  const outModeNote = document.getElementById("outModeNote");
  const outWinA = document.getElementById("outWinA");
  const outWinB = document.getElementById("outWinB");
  const outWinnerText = document.getElementById("outWinnerText");
  const outTeamAName = document.getElementById("outTeamAName");
  const outTeamBName = document.getElementById("outTeamBName");
  const outTeamAGame = document.getElementById("outTeamAGame");
  const outTeamBGame = document.getElementById("outTeamBGame");
  const outJson = document.getElementById("outJson");

  if (!outMatchTitle || !outModeNote || !outWinA || !outWinB || !outWinnerText) return;

  const title = `${data.teamA.name} (${data.teamA.game.toUpperCase()}) vs ${data.teamB.name} (${data.teamB.game.toUpperCase()})`;
  outMatchTitle.textContent = title;

  outModeNote.textContent =
    data.mode === "arena"
      ? "Mode: Cross-Game Arena（跨领域统一规则）"
      : "Mode: Same Game（同游戏规则）";

  outWinA.textContent = String(data.winProb.A);
  outWinB.textContent = String(data.winProb.B);

  const winnerName = data.winnerSide === "A" ? data.teamA.name : data.teamB.name;
  outWinnerText.textContent = `Likely winner: ${winnerName} · Confidence: ${data.confidence}`;

  if (outTeamAName) outTeamAName.textContent = data.teamA.name;
  if (outTeamBName) outTeamBName.textContent = data.teamB.name;

  if (outTeamAGame)
    outTeamAGame.textContent = `Game: ${data.teamA.game.toUpperCase()}  · Last5: ${data.teamA.last5}`;
  if (outTeamBGame)
    outTeamBGame.textContent = `Game: ${data.teamB.game.toUpperCase()}  · Last5: ${data.teamB.last5}`;

  renderStats("outStatsA", data.teamA);
  renderStats("outStatsB", data.teamB);

  const ul = document.getElementById("outReasons");
  if (ul) {
    ul.innerHTML = "";
    data.reasons.forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      ul.appendChild(li);
    });
  }

  const tl = document.getElementById("outTimeline");
  if (tl) {
    tl.innerHTML = "";
    data.timeline.forEach((item) => {
      const div = document.createElement("div");
      div.className = "event";
      div.innerHTML = `<div class="phase">${item.phase}</div><div>${item.event}</div>`;
      tl.appendChild(div);
    });
  }

  if (outJson) outJson.textContent = JSON.stringify(data, null, 2);
}

// ===============================
// i18n
// ===============================
const I18N = {
  zh: {
    title: "ESboard · Arena Simulation (MVP1)",
    subtitle:
      "新增：跨游戏/跨领域对战（例：T1 vs Team Spirit）。输出为“娱乐 + 可解释分析”，非真实比赛预测。",
    input: "输入",
    output: "输出",
    output_empty: "暂无输出。请填写队伍信息并点击“生成模拟”。",
    winprob: "胜率",
    panel: "统一属性面板",
    reasons: "理由",
    timeline: "时间线",
    rawjson: "原始 JSON",
    disclaimer: "免责声明：仅用于分析与娱乐，不构成投注建议。",

    mode: "模式",
    bo: "BO",
    mode_same: "同游戏对战 (LoL vs LoL / CS2 vs CS2)",
    mode_cross: "跨领域 Arena（跨游戏）",
    arena_tip: "Arena 模式会把不同游戏映射到统一属性面板（Mechanical/IQ/Teamwork/Clutch/Form/Adapt/Strat）。",

    teamA_game: "A队比赛",
    teamA_name: "A队名称",
    teamA_last5: "A队最近5场（胜/负）",
    teamB_game: "B队比赛",
    teamB_name: "B队名称",
    teamB_last5: "B队最近5场（胜/负）",

    gen: "生成模拟",
    reset_points: "重置积分",

    tab_arena: "竞技场",
    tab_schedule: "日程",
    tab_ranking: "排名",
    tab_profile: "个人资料",

    schedule: "日程",
    schedule_tip: "这里之后可以接后端/数据库，展示真实赛事日程。",
    ranking: "排名",
    ranking_tip: "示例榜单（后续你可以用你的算法/积分系统替换）。",
    profile: "个人资料",
    profile_tip: "先做本地资料 localStorage，后面再接登录/后端。",

    account: "账号",
    account_tip: "Sign up 用邮箱注册，会发确认邮件。确认后再 Sign in。",
    email: "邮箱",
    password: "密码",
    sign_in: "登录",
    sign_up: "注册",
    forgot: "忘记密码",
    signed_as: "已登录账号",
    logout: "退出登录",

    pf_name: "昵称",
    pf_team: "喜欢的队伍",
    pf_save: "保存",
    pf_saved: "已保存 ✅",
  },
  en: {
    title: "ESboard · Arena Simulation (MVP1)",
    subtitle:
      "New: cross-game arena battles (e.g., T1 vs Team Spirit). Entertainment + explainable analysis, NOT real match prediction.",
    input: "Input",
    output: "Output",
    output_empty: "No output yet. Fill teams and click Generate.",
    winprob: "Win Probability",
    panel: "Universal Attribute Panel",
    reasons: "Reasons",
    timeline: "Timeline",
    rawjson: "Raw JSON",
    disclaimer: "Disclaimer: For analysis & entertainment only. Not betting advice.",

    mode: "Mode",
    bo: "BO",
    mode_same: "Same Game (LoL vs LoL / CS2 vs CS2)",
    mode_cross: "Cross-Game Arena",
    arena_tip:
      "Arena maps different games into a unified attribute panel (Mechanical/IQ/Teamwork/Clutch/Form/Adapt/Strat).",

    teamA_game: "Team A game",
    teamA_name: "Team A name",
    teamA_last5: "Team A last 5 (W/L)",
    teamB_game: "Team B game",
    teamB_name: "Team B name",
    teamB_last5: "Team B last 5 (W/L)",

    gen: "Generate Simulation",
    reset_points: "Reset Points",

    tab_arena: "Arena",
    tab_schedule: "Schedule",
    tab_ranking: "Rankings",
    tab_profile: "Profile",

    schedule: "Schedule",
    schedule_tip: "Later connect backend/database to show real schedules.",
    ranking: "Rankings",
    ranking_tip: "Sample leaderboard (replace with your model/points system later).",
    profile: "Profile",
    profile_tip: "Local profile via localStorage. Sync with login/backend later.",

    account: "Account",
    account_tip: "Sign up with email; you'll receive a confirmation email. Confirm, then sign in.",
    email: "Email",
    password: "Password",
    sign_in: "Sign In",
    sign_up: "Sign Up",
    forgot: "Forgot Password",
    signed_as: "Signed in as",
    logout: "Logout",

    pf_name: "Name",
    pf_team: "Favorite team",
    pf_save: "Save",
    pf_saved: "Saved ✅",
  },
};

function getLang() {
  const v = localStorage.getItem(LS_LANG);
  return v === "en" || v === "zh" ? v : "zh";
}
function setLang(lang) {
  localStorage.setItem(LS_LANG, lang);
  applyLang();
}
function t(key) {
  const lang = getLang();
  return I18N[lang] && I18N[lang][key] ? I18N[lang][key] : null;
}
function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";

  const zhBtn = document.getElementById("btnZh");
  const enBtn = document.getElementById("btnEn");
  zhBtn?.classList.toggle("active", lang === "zh");
  enBtn?.classList.toggle("active", lang === "en");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const val = t(key);
    if (val) el.textContent = val;
  });

  const title = t("title");
  if (title) document.title = title;
}

// ===============================
// Tabs router
// ===============================
function showPage(route) {
  const routes = ["arena", "schedule", "ranking", "profile"];
  if (!routes.includes(route)) route = "arena";

  routes.forEach((r) => {
    const page = document.getElementById(`page-${r}`);
    page?.classList.toggle("active", r === route);
  });

  document.querySelectorAll(".tab").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-route") === route);
  });

  renderPoints();
}
function currentRoute() {
  const hash = (location.hash || "#arena").replace("#", "");
  return hash || "arena";
}

// ===============================
// Local Profile
// ===============================
function loadProfile() {
  try {
    const raw = localStorage.getItem(LS_PROFILE);
    return raw ? JSON.parse(raw) : { name: "", team: "" };
  } catch {
    return { name: "", team: "" };
  }
}
function saveProfile(p) {
  localStorage.setItem(LS_PROFILE, JSON.stringify(p));
}
function initProfileUI() {
  const nameEl = document.getElementById("pfName");
  const teamEl = document.getElementById("pfTeam");
  const saveBtn = document.getElementById("pfSave");
  const statusEl = document.getElementById("pfStatus");
  if (!nameEl || !teamEl || !saveBtn) return;

  const p = loadProfile();
  nameEl.value = p.name || "";
  teamEl.value = p.team || "";

  saveBtn.addEventListener("click", () => {
    saveProfile({ name: nameEl.value.trim(), team: teamEl.value.trim() });
    if (statusEl) {
      statusEl.textContent = t("pf_saved") || "Saved ✅";
      setTimeout(() => (statusEl.textContent = ""), 1200);
    }
  });
}

// ===============================
// ✅ Supabase Auth UI (Profile Page)
// ===============================
function setAuthMsg(text, isError = false) {
  const el = document.getElementById("authMsg");
  const el2 = document.getElementById("authMsg2");
  if (el) {
    el.className = isError ? "warn" : "muted";
    el.textContent = text || "";
  }
  if (el2) {
    el2.className = isError ? "warn" : "muted";
    el2.textContent = text || "";
  }
}

function setAuthUI(session) {
  const out = document.getElementById("authLoggedOut");
  const inn = document.getElementById("authLoggedIn");
  const authedEmail = document.getElementById("authedEmail");
  if (!out || !inn) return;

  if (session && session.user) {
    out.style.display = "none";
    inn.style.display = "block";
    if (authedEmail) authedEmail.textContent = session.user.email || "";
  } else {
    out.style.display = "block";
    inn.style.display = "none";
    if (authedEmail) authedEmail.textContent = "";
  }
}

async function initSupabaseAuth() {
  const supabase = getSupabase();
  if (!supabase) {
    setAuthMsg("⚠️ Supabase not ready. Check CDN + URL/KEY.", true);
    return;
  }

  // 初始 session
  try {
    const { data } = await supabase.auth.getSession();
    setAuthUI(data?.session || null);
  } catch (e) {
    setAuthMsg(String(e), true);
  }

  // 监听变化
  supabase.auth.onAuthStateChange((_event, session) => {
    setAuthUI(session || null);
  });

  // 绑定按钮
  document.getElementById("btnSignIn")?.addEventListener("click", async () => {
    setAuthMsg("");
    const email = (document.getElementById("authEmail")?.value || "").trim();
    const password = (document.getElementById("authPassword")?.value || "").trim();
    if (!email || !password) return setAuthMsg("Please input email & password.", true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setAuthMsg(error.message, true);
    setAuthMsg("Signed in ✅");
  });

  document.getElementById("btnSignUp")?.addEventListener("click", async () => {
    setAuthMsg("");
    const email = (document.getElementById("authEmail")?.value || "").trim();
    const password = (document.getElementById("authPassword")?.value || "").trim();
    if (!email || !password) return setAuthMsg("Please input email & password.", true);
    if (password.length < 6) return setAuthMsg("Password must be at least 6 characters.", true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) return setAuthMsg(error.message, true);
    setAuthMsg("Sign up success ✅ Please check your email to confirm, then Sign in.");
  });

  document.getElementById("btnForgot")?.addEventListener("click", async () => {
    setAuthMsg("");
    const email = (document.getElementById("authEmail")?.value || "").trim();
    if (!email) return setAuthMsg("Please input your email first.", true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) return setAuthMsg(error.message, true);

    setAuthMsg("Password reset email sent ✅");
  });

  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    setAuthMsg("");
    const { error } = await supabase.auth.signOut();
    if (error) return setAuthMsg(error.message, true);
    setAuthMsg("Logged out.");
  });
}

// ===============================
// App init (single entry)
// ===============================
function initApp() {
  console.log("[ESboard] initApp");

  // Lang buttons
  document.getElementById("btnZh")?.addEventListener("click", () => setLang("zh"));
  document.getElementById("btnEn")?.addEventListener("click", () => setLang("en"));

  // Router
  window.addEventListener("hashchange", () => showPage(currentRoute()));

  // Initial render
  applyLang();
  showPage(currentRoute());
  renderPoints();
  initProfileUI();
  initSupabaseAuth();

  // Arena actions (event delegation)
  document.addEventListener("click", (e) => {
    const tEl = e.target;
    if (!tEl) return;

    // Generate
    if (tEl.id === "btnGen") {
      const modeEl = document.getElementById("mode");
      const boEl = document.getElementById("bo");
      const aGameEl = document.getElementById("teamAGame");
      const bGameEl = document.getElementById("teamBGame");
      const aNameEl = document.getElementById("teamAName");
      const bNameEl = document.getElementById("teamBName");
      const aL5El = document.getElementById("teamALast5");
      const bL5El = document.getElementById("teamBLast5");

      if (!modeEl || !boEl || !aGameEl || !bGameEl || !aNameEl || !bNameEl || !aL5El || !bL5El) {
        setStatus("页面元素缺失（ID 不匹配）。请确认 index.html 的 id 与 app.js 一致。", "warn");
        return;
      }

      const mode = modeEl.value;
      const bo = boEl.value;
      const teamAGame = aGameEl.value;
      const teamBGame = bGameEl.value;
      const teamAName = aNameEl.value.trim();
      const teamBName = bNameEl.value.trim();
      const teamAL5 = parseLast5(aL5El.value);
      const teamBL5 = parseLast5(bL5El.value);

      if (!teamAName || !teamBName || teamAL5.length < 3 || teamBL5.length < 3) {
        setStatus("请填 Team A/B 名称，并至少输入 3 个 W/L（建议 5 个）。", "warn");
        return;
      }

      if (mode === "same" && teamAGame !== teamBGame) {
        setStatus("Same Game 模式下，Team A/B 必须选择相同游戏。或切换到 Arena 模式。", "warn");
        return;
      }

      const teamA = buildTeamProfile({ name: teamAName, game: teamAGame, last5: teamAL5 });
      const teamB = buildTeamProfile({ name: teamBName, game: teamBGame, last5: teamBL5 });

      const result = simulate({ mode, bo, teamA, teamB });
      renderOutput(result);

      setPoints(getPoints() + 10);
      setStatus("Simulation generated. +10 points ✅", "ok");
      return;
    }

    // Reset points
    if (tEl.id === "btnReset") {
      setPoints(0);
      setStatus("Points reset to 0.", "ok");
    }
  });
}

// DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}










