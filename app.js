// ESboard MVP1 - app.js (Dashboard multi-page compatible + Local History + User Menu + OAuth)
console.log("[ESboard] app.js loaded");

// ===============================
// LocalStorage Keys
// ===============================
const LS_KEY_POINTS = "esboard_points_v1";
const LS_LANG = "esboard_lang_v1";
const LS_PROFILE = "esboard_profile_v1";
const LS_KEY_HISTORY = "esboard_history_v1";

// ===============================
// ✅ Supabase Config (前端用 publishable key)
// ===============================
const SUPABASE_URL = "https://fnlrhubwmjxnfwmkcrx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vNiDiJP9sUgl8U7boD3_gg_D3VxNCJz";

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;

  if (!window.supabase) {
    console.warn("[ESboard] supabase-js not loaded. (Only needed on auth pages)");
    return null;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
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
// Sidebar active highlight (all pages)
// ===============================
function initActiveMenu() {
  const links = document.querySelectorAll(".menu a[href]");
  if (!links.length) return;

  const path = location.pathname === "/dashboard" ? "/dashboard/" : location.pathname;
  const normalized = path === "/dashboard/index.html" ? "/dashboard/" : path;

  links.forEach((a) => {
    const href = a.getAttribute("href");
    a.classList.toggle("active", href === normalized);
  });
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

  const big = $("pointsValue");
  if (big) big.textContent = String(getPoints());
}
function setPoints(n) {
  localStorage.setItem(LS_KEY_POINTS, String(n));
  renderPoints();
}

// ===============================
// Status (if exists)
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
  list.unshift(item);
  if (list.length > 50) list.length = 50;
  saveHistory(list);
}

function renderHistoryIfExists() {
  const ul = $("historyList");
  const empty = $("historyEmpty");
  if (!ul) return;

  const list = loadHistory();
  ul.innerHTML = "";

  if (!list.length) {
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  list.forEach((it) => {
    const li = document.createElement("li");
    const dt = new Date(it.time || Date.now());
    const timeStr = dt.toLocaleString();
    li.textContent = `${timeStr} · ${it.title} · Winner: ${it.winner} · ${it.winA}% - ${it.winB}% · ${it.bo}`;
    ul.appendChild(li);
  });
}

function initClearHistoryIfExists() {
  const btn = $("btnClearHistory");
  if (!btn) return;
  btn.addEventListener("click", () => {
    saveHistory([]);
    renderHistoryIfExists();
    setStatus("History cleared.", "ok");
  });
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
  return wins / last5.length;
}

// ---- deterministic random ----
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
  const v = (x) => (x - 0.5) * 12;

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
// Arena weights + simulate
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
  return s;
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

function buildTimeline(mode, a, b, winnerSide) {
  const arena = mode === "arena";
  const w = winnerSide === "A" ? a.name : b.name;
  const l = winnerSide === "A" ? b.name : a.name;

  if (arena) {
    return [
      { phase: "Early", event: `开局：${w} 拿到小优势，${l} 试探反击。` },
      { phase: "Mid", event: `中盘：执行与沟通决定走势，${w} 扩大优势。` },
      { phase: "Late", event: `终盘：${w} 抓住失误完成终结。` },
    ];
  }
  return [
    { phase: "Early", event: "开局：控图/线权决定节奏。" },
    { phase: "Mid", event: `中段：${w} 赢下关键回合/团战建立优势。` },
    { phase: "Late", event: `收尾：${w} 更稳，拿下胜利。` },
  ];
}

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

  return {
    mode,
    bo: `BO${bo}`,
    confidence,
    winProb: { A: Math.round(pA * 100), B: Math.round(pB * 100) },
    winnerSide,
    teamA,
    teamB,
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

  const title = $("outMatchTitle");
  const modeNote = $("outModeNote");
  const outWinA = $("outWinA");
  const outWinB = $("outWinB");
  const winnerText = $("outWinnerText");

  if (title) {
    title.textContent = `${data.teamA.name} (${data.teamA.game.toUpperCase()}) vs ${data.teamB.name} (${data.teamB.game.toUpperCase()})`;
  }
  if (modeNote) {
    modeNote.textContent =
      data.mode === "arena" ? "Mode: Cross-Game Arena（跨领域）" : "Mode: Same Game（同游戏）";
  }
  if (outWinA) outWinA.textContent = String(data.winProb.A);
  if (outWinB) outWinB.textContent = String(data.winProb.B);
  if (winnerText) {
    const winnerName = data.winnerSide === "A" ? data.teamA.name : data.teamB.name;
    winnerText.textContent = `Likely winner: ${winnerName} · Confidence: ${data.confidence}`;
  }

  const outTeamAName = $("outTeamAName");
  const outTeamBName = $("outTeamBName");
  const outTeamAGame = $("outTeamAGame");
  const outTeamBGame = $("outTeamBGame");
  if (outTeamAName) outTeamAName.textContent = data.teamA.name;
  if (outTeamBName) outTeamBName.textContent = data.teamB.name;
  if (outTeamAGame) outTeamAGame.textContent = `Game: ${data.teamA.game.toUpperCase()} · Last5: ${data.teamA.last5}`;
  if (outTeamBGame) outTeamBGame.textContent = `Game: ${data.teamB.game.toUpperCase()} · Last5: ${data.teamB.last5}`;

  renderStats("outStatsA", data.teamA);
  renderStats("outStatsB", data.teamB);

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

  const outJson = $("outJson");
  if (outJson) outJson.textContent = JSON.stringify(data, null, 2);
}

// ===============================
// Auth + OAuth (Settings page / User menu)
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

  if (out && inn) {
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

  // user menu email
  const menuEmail = $("userMenuEmail");
  if (menuEmail) {
    menuEmail.textContent = session?.user?.email ? session.user.email : "Not signed in";
  }

  // menu buttons
  const btnOut = $("menuSignOut");
  const btnIn = $("menuGoSettings");
  if (btnOut) btnOut.style.display = session?.user ? "block" : "none";
  if (btnIn) btnIn.style.display = "block";
}

async function initSupabaseAuthIfExists() {
  const hasAuthBox = !!$("authLoggedOut") || !!$("authLoggedIn") || !!$("userBtn");
  if (!hasAuthBox) return;

  const supabase = getSupabase();
  if (!supabase) {
    // 没有 supabase-js 时，只隐藏登出按钮即可
    setAuthUI(null);
    return;
  }

  // initial session
  try {
    const { data } = await supabase.auth.getSession();
    setAuthUI(data?.session || null);
  } catch (e) {
    setAuthMsg(String(e), true);
  }

  supabase.auth.onAuthStateChange((_event, session) => setAuthUI(session || null));

  // Email/Password
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
      options: { emailRedirectTo: window.location.origin + "/dashboard/settings.html" },
    });

    if (error) return setAuthMsg(error.message, true);
    setAuthMsg("Sign up success ✅ Please check email to confirm, then Sign in.");
  });

  $("btnForgot")?.addEventListener("click", async () => {
    setAuthMsg("");
    const email = ($("authEmail")?.value || "").trim();
    if (!email) return setAuthMsg("Please input your email first.", true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/dashboard/settings.html",
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

  // OAuth
  $("btnGoogle")?.addEventListener("click", async () => {
    setAuthMsg("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/dashboard/settings.html",
      },
    });
    if (error) setAuthMsg(error.message, true);
  });

  $("btnApple")?.addEventListener("click", async () => {
    setAuthMsg("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: window.location.origin + "/dashboard/settings.html",
      },
    });
    if (error) setAuthMsg(error.message, true);
  });

  // User menu signout
  $("menuSignOut")?.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setAuthMsg(error.message, true);
    closeUserMenu();
  });
}

// ===============================
// User menu (top-right avatar)
// ===============================
function openUserMenu() {
  const overlay = $("userMenuOverlay");
  const menu = $("userMenu");
  if (overlay) overlay.style.display = "block";
  if (menu) menu.style.display = "block";
}
function closeUserMenu() {
  const overlay = $("userMenuOverlay");
  const menu = $("userMenu");
  if (overlay) overlay.style.display = "none";
  if (menu) menu.style.display = "none";
}
function initUserMenuIfExists() {
  const btn = $("userBtn");
  const overlay = $("userMenuOverlay");
  const closeBtn = $("userMenuClose");
  if (!btn || !overlay) return;

  btn.addEventListener("click", () => {
    const menu = $("userMenu");
    const isOpen = menu && menu.style.display === "block";
    if (isOpen) closeUserMenu();
    else openUserMenu();
  });

  overlay.addEventListener("click", closeUserMenu);
  closeBtn?.addEventListener("click", closeUserMenu);

  $("menuGoSettings")?.addEventListener("click", () => {
    location.href = "/dashboard/settings.html";
  });
}

// ===============================
// Simulator init
// ===============================
function initSimulatorIfExists() {
  const btnGen = $("btnGen");
  const btnReset = $("btnReset");
  if (!btnGen && !btnReset) return;

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

    // write history
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
// Points page init
// ===============================
function initPointsPageIfExists() {
  const btn = $("btnResetPoints");
  if (!btn) return;

  btn.addEventListener("click", () => {
    setPoints(0);
    setStatus("Points reset to 0.", "ok");
  });
}

// ===============================
// App init
// ===============================
function initApp() {
  console.log("[ESboard] initApp");
  initActiveMenu();

  renderPoints();
  renderHistoryIfExists();

  initUserMenuIfExists();
  initSimulatorIfExists();
  initPointsPageIfExists();
  initClearHistoryIfExists();

  initSupabaseAuthIfExists(); // settings + user menu
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
