// ESboard MVP1 - app.js (Dashboard multi-page compatible + Local History)
console.log("[ESboard] app.js loaded");

// ===============================
// LocalStorage Keys
// ===============================
const LS_KEY_POINTS = "esboard_points_v1";
const LS_LANG = "esboard_lang_v1";
const LS_PROFILE = "esboard_profile_v1";
const LS_KEY_HISTORY = "esboard_history_v1"; // ✅ NEW: history

// ===============================
// ✅ Supabase Config (前端用 publishable/anon key)
// ===============================
const SUPABASE_URL = "https://fnlrhubwmjxnfwmkcrx.supabase.co";
const SUPABASE_ANON_KEY = "PASTE_YOUR_FULL_PUBLISHABLE_OR_ANON_KEY_HERE"; // ⚠️换成完整 key（不要 ...）

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;

  if (!window.supabase) {
    console.warn("[ESboard] supabase-js not loaded. (Only needed on auth pages)");
    return null;
  }

  if (
    !SUPABASE_URL ||
    SUPABASE_URL.includes("PASTE_") ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_ANON_KEY.includes("PASTE_")
  ) {
    console.warn("[ESboard] Supabase URL / KEY not configured.");
    return null;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

// ===============================
// Helpers
// ===============================
function $(id) {
  return document.getElementById(id);
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
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
  const el = $("points");
  if (el) el.textContent = String(getPoints());
}
function setPoints(n) {
  localStorage.setItem(LS_KEY_POINTS, String(n));
  renderPoints();
}

// ===============================
// Status (Simulator only)
// ===============================
function setStatus(text, kind = "muted") {
  const el = $("status");
  if (!el) return;
  el.className = kind === "ok" ? "ok" : kind === "warn" ? "warn" : "muted";
  el.textContent = text || "";
}

// ===============================
// ✅ History (localStorage)
// ===============================
function loadHistory() {
  try {
    const raw = localStorage.getItem(LS_KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveHistory(list) {
  localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(list));
}
function pushHistory(item) {
  const list = loadHistory();
  list.unshift(item);             // 新的放最上面
  if (list.length > 50) list.length = 50; // 最多50条
  saveHistory(list);
}

// ===============================
// Last5 / Form
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
      ? `跨领域 Arena 模式：用统一属性面板模拟对抗。${winnerSide === "A" ? teamA.name : teamB.name} 略占上风（Confidence: ${confidence}）。`
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
// Render output (Simulator only)
// ===============================
function renderStats(containerId, p) {
  const el = $(containerId);
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
  const empty = $("outputEmpty");
  const wrap = $("outputWrap");
  if (empty) empty.style.display = "none";
  if (wrap) wrap.style.display = "block";

  const outMatchTitle = $("outMatchTitle");
  const outModeNote = $("outModeNote");
  const outWinA = $("outWinA");
  const outWinB = $("outWinB");
  const outWinnerText = $("outWinnerText");
  const outTeamAName = $("outTeamAName");
  const outTeamBName = $("outTeamBName");
  const outTeamAGame = $("outTeamAGame");
  const outTeamBGame = $("outTeamBGame");
  const outJson = $("outJson");

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

  if (outTeamAGame) outTeamAGame.textContent = `Game: ${data.teamA.game.toUpperCase()}  · Last5: ${data.teamA.last5}`;
  if (outTeamBGame) outTeamBGame.textContent = `Game: ${data.teamB.game.toUpperCase()}  · Last5: ${data.teamB.last5}`;

  renderStats("outStatsA", data.teamA);
  renderStats("outStatsB", data.teamB);

  const ul = $("outReasons");
  if (ul) {
    ul.innerHTML = "";
    data.reasons.forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      ul.appendChild(li);
    });
  }

  const tl = $("outTimeline");
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
// i18n (只在页面存在 data-i18n 时生效)
// ===============================
function getLang() {
  const v = localStorage.getItem(LS_LANG);
  return v === "en" || v === "zh" ? v : "zh";
}
function setLang(lang) {
  localStorage.setItem(LS_LANG, lang);
  applyLang();
}
function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";

  const zhBtn = $("btnZh");
  const enBtn = $("btnEn");
  if (zhBtn) zhBtn.classList.toggle("active", lang === "zh");
  if (enBtn) enBtn.classList.toggle("active", lang === "en");

  const nodes = document.querySelectorAll("[data-i18n]");
  if (!nodes.length) return;
  // 你现在多页面主要不靠 data-i18n，这里保留空实现，避免报错
}

// ===============================
// Local Profile (只有 profile 页面有才初始化)
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
  const nameEl = $("pfName");
  const teamEl = $("pfTeam");
  const saveBtn = $("pfSave");
  const statusEl = $("pfStatus");
  if (!nameEl || !teamEl || !saveBtn) return;

  const p = loadProfile();
  nameEl.value = p.name || "";
  teamEl.value = p.team || "";

  saveBtn.addEventListener("click", () => {
    saveProfile({ name: nameEl.value.trim(), team: teamEl.value.trim() });
    if (statusEl) {
      statusEl.textContent = (getLang() === "zh" ? "已保存 ✅" : "Saved ✅");
      setTimeout(() => (statusEl.textContent = ""), 1200);
    }
  });
}

// ===============================
// Supabase Auth UI（只有 auth 元素存在才初始化）
// ===============================
function setAuthMsg(text, isError = false) {
  const el = $("authMsg");
  const el2 = $("authMsg2");
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
  const out = $("authLoggedOut");
  const inn = $("authLoggedIn");
  const authedEmail = $("authedEmail");
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

async function initSupabaseAuthIfExists() {
  if (!$("authLoggedOut") && !$("authLoggedIn")) return;

  const supabase = getSupabase();
  if (!supabase) {
    setAuthMsg("⚠️ Supabase not ready. Check CDN + URL/KEY.", true);
    return;
  }

  try {
    const { data } = await supabase.auth.getSession();
    setAuthUI(data?.session || null);
  } catch (e) {
    setAuthMsg(String(e), true);
  }

  supabase.auth.onAuthStateChange((_event, session) => setAuthUI(session || null));

  $("btnSignIn")?.addEventListener("click", async () => {
    setAuthMsg("");
    const email = ($("authEmail")?.value || "").trim();
    const password = ($("authPassword")?.value || "").trim();
    if (!email || !password) return setAuthMsg("Please input email & password.", true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setAuthMsg(error.message, true);
    setAuthMsg("Signed in ✅");
  });

  $("btnSignUp")?.addEventListener("click", async () => {
    setAuthMsg("");
    const email = ($("authEmail")?.value || "").trim();
    const password = ($("authPassword")?.value || "").trim();
    if (!email || !password) return setAuthMsg("Please input email & password.", true);
    if (password.length < 6) return setAuthMsg("Password must be at least 6 characters.", true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) return setAuthMsg(error.message, true);
    setAuthMsg("Sign up success ✅ Please check email to confirm, then Sign in.");
  });

  $("btnForgot")?.addEventListener("click", async () => {
    setAuthMsg("");
    const email = ($("authEmail")?.value || "").trim();
    if (!email) return setAuthMsg("Please input your email first.", true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) return setAuthMsg(error.message, true);
    setAuthMsg("Password reset email sent ✅");
  });

  $("btnLogout")?.addEventListener("click", async () => {
    setAuthMsg("");
    const { error } = await supabase.auth.signOut();
    if (error) return setAuthMsg(error.message, true);
    setAuthMsg("Logged out.");
  });
}

// ===============================
// Simulator init (只要页面存在 btnGen 就运行)
// ===============================
function initSimulatorIfExists() {
  const btnGen = $("btnGen");
  const btnReset = $("btnReset");
  if (!btnGen && !btnReset) return;

  $("btnZh")?.addEventListener("click", () => setLang("zh"));
  $("btnEn")?.addEventListener("click", () => setLang("en"));

  btnGen?.addEventListener("click", () => {
    const modeEl = $("mode");
    const boEl = $("bo");
    const aGameEl = $("teamAGame");
    const bGameEl = $("teamBGame");
    const aNameEl = $("teamAName");
    const bNameEl = $("teamBName");
    const aL5El = $("teamALast5");
    const bL5El = $("teamBLast5");

    if (!modeEl || !boEl || !aGameEl || !bGameEl || !aNameEl || !bNameEl || !aL5El || !bL5El) {
      setStatus("页面元素缺失（ID 不匹配）。请确认 simulator.html 的 id 与 app.js 一致。", "warn");
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

    // ✅ NEW: write history
    pushHistory({
      time: Date.now(),
      title: `${result.teamA.name} vs ${result.teamB.name}`,
      mode: result.mode,
      bo: result.bo,
      winner: result.winnerSide === "A" ? result.teamA.name : result.teamB.name,
      winA: result.winProb.A,
      winB: result.winProb.B,
    });

    setPoints(getPoints() + 10);
    setStatus("Simulation generated. +10 points ✅", "ok");
  });

  btnReset?.addEventListener("click", () => {
    setPoints(0);
    setStatus("Points reset to 0.", "ok");
  });
}

// ===============================
// App init
// ===============================
function initApp() {
  console.log("[ESboard] initApp");

  applyLang();
  renderPoints();

  initSimulatorIfExists();
  initProfileUI();
  initSupabaseAuthIfExists();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
