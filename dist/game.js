"use strict";

const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;
const TAU = Math.PI * 2;

const ui = Object.fromEntries(
  [
    "hud", "startScreen", "resultScreen", "pauseScreen", "startButton", "restartButton", "resultHomeButton", "pauseButton", "helpButton", "modeEyebrow",
    "helpDialog", "soundButton", "hpBar", "mpBar", "bpBar", "hpText", "mpText", "bpText",
    "blueScore", "redScore", "matchTime", "killFeed", "portrait", "weaponCard", "armorCard", "magicCard",
    "meleeCd", "rangeCd", "magicCd", "guardState", "dashState", "resultEyebrow", "resultTitle", "scoreGoal",
    "resultBlue", "resultRed", "resultStats", "mobileControls", "joystick", "opponentPicker",
    "matchmakingPanel", "matchStatus", "inviteControls", "inviteCode", "joinInviteButton", "cancelMatchButton",
    "homeButton", "landscapeButton", "resumeButton", "pauseHomeButton", "pauseTitle", "pauseMessage",
    "nicknameInput", "onlineCount", "onlineRoomPanel", "roomConnectionState", "activeRoomCode",
    "waitingRoomInfo", "waitingConnectionState", "waitingRoomCode",
  ].map((id) => [id, document.querySelector(`#${id}`)]),
);

const CLASSES = {
  blade: { name: "화염 검사", icon: "검", hp: 142, speed: 214, accel: 710, grip: 1.76, bounce: .66, melee: 41, meleeRange: 105, meleeArc: 2.02, ranged: 5, shotSpeed: 325, shotLife: .66, magic: 38, color: "#ff9a42", projectile: "#ffc052", weapon: "홍염검", armor: "수호갑", spell: "유성진" },
  ranger: { name: "바람 궁수", icon: "궁", hp: 104, speed: 234, accel: 615, grip: 1.18, bounce: .78, melee: 25, meleeRange: 80, meleeArc: 2.18, ranged: 13, shotSpeed: 420, shotLife: .92, magic: 30, color: "#71e587", projectile: "#b6ff88", weapon: "질풍궁", armor: "엽풍의", spell: "폭풍진" },
  mage: { name: "서리 술사", icon: "술", hp: 100, speed: 220, accel: 565, grip: .96, bounce: .82, melee: 23, meleeRange: 82, meleeArc: 2.32, ranged: 9, shotSpeed: 350, shotLife: .82, magic: 42, color: "#72d9ff", projectile: "#8df5ff", weapon: "빙정봉", armor: "설화포", spell: "추적 빙하진" },
};

const SPRITES = Object.fromEntries(Object.keys(CLASSES).map((classId) => {
  const set = {};
  for (const [state, file] of Object.entries({ idle: `${classId}-atlas-v1.png`, run: `${classId}-run-atlas-v2.png`, attack: `${classId}-attack-atlas-v2.png` })) {
    const image = new Image(); image.decoding = "async"; image.src = `./assets/${file}`; set[state] = image;
  }
  return [classId, set];
}));
const DIRECTION_TO_FRAME = [2, 1, 0, 7, 6, 5, 4, 3];

const obstacles = [
  { x: 236, y: 170, r: 48, kind: "tree" }, { x: 1045, y: 178, r: 50, kind: "tree" },
  { x: 217, y: 555, r: 44, kind: "tree" }, { x: 1060, y: 548, r: 46, kind: "tree" },
  { x: 535, y: 220, r: 31, kind: "rock" }, { x: 750, y: 510, r: 34, kind: "rock" },
  { x: 644, y: 360, r: 42, kind: "crystal" }, { x: 420, y: 490, r: 25, kind: "rock" },
  { x: 875, y: 235, r: 26, kind: "rock" },
];

const input = { keys: new Set(), moveX: 0, moveY: 0, guardTouch: false };
let selectedClass = "blade";
let selectedOpponentClass = "ranger";
let selectedMode = "duel";
let game = makeEmptyGame();
let lastTime = performance.now();
let audioEnabled = true;
let audioCtx = null;
let landscapeActive = false;
let playerNickname = (localStorage.getItem("elementClashNickname") || "나의 전사").slice(0, 12);
const browserPlayerId = localStorage.getItem("elementClashPlayerId") || (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
localStorage.setItem("elementClashPlayerId", browserPlayerId);
const net = {
  socket: null, connected: false, waiting: false, role: null, lobbyRole: null, peerConnected: false, roomCode: null, matchKind: null,
  lastInviteCode: localStorage.getItem("elementClashInviteCode") || "", playersOnline: 0,
  lastPong: Date.now(), reconnectCode: null,
  remoteInput: { moveX: 0, moveY: 0, guard: false, dash: false },
  lastInputSent: 0, lastSnapshotSent: 0, localTeam: 0,
};
ui.nicknameInput.value = playerNickname;

function makeEmptyGame() {
  return {
    mode: "select", actors: [], projectiles: [], bursts: [], slashes: [], particles: [],
    scores: [0, 0], remaining: 180, player: null, shake: 0, feed: [], nextId: 1,
    matchType: selectedMode, scoreLimit: selectedMode === "team" ? 12 : 5,
    networkRole: null,
    stats: { kills: 0, deaths: 0, damage: 0 },
  };
}

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function normalize(x, y) { const len = Math.hypot(x, y) || 1; return { x: x / len, y: y / len }; }
function angleDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
function quantize8(x, y) {
  if (Math.abs(x) + Math.abs(y) < .001) return { x: 0, y: 0, angle: 0 };
  const angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: Math.cos(angle), y: Math.sin(angle), angle };
}

function tone(freq, duration = .06, type = "sine", gain = .035) {
  if (!audioEnabled) return;
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const volume = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq; volume.gain.value = gain;
    volume.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + duration);
    osc.connect(volume).connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + duration);
  } catch { /* audio is optional */ }
}

function setMatchStatus(text, isError = false) {
  ui.matchStatus.textContent = text;
  ui.matchStatus.style.color = isError ? "#ff9aa4" : "#d4ead8";
}

function currentNickname() {
  const nickname = ui.nicknameInput.value.replace(/[<>]/g, "").trim().slice(0, 12) || "나의 전사";
  if (ui.nicknameInput.value !== nickname) ui.nicknameInput.value = nickname;
  playerNickname = nickname; localStorage.setItem("elementClashNickname", nickname);
  return nickname;
}

function updatePresence(count, connected = true) {
  net.playersOnline = Number.isFinite(Number(count)) ? Number(count) : net.playersOnline;
  ui.onlineCount.innerHTML = connected ? `<i></i> 접속 ${net.playersOnline}명` : "연결 끊김";
}

function rememberInviteCode(code) {
  if (!code) return;
  net.lastInviteCode = code; localStorage.setItem("elementClashInviteCode", code);
  ui.inviteCode.value = code;
}

function updateRoomDisplay(status = "", code = net.roomCode, visible = Boolean(code)) {
  ui.waitingRoomInfo.hidden = !visible || selectedMode !== "invite" || game.mode !== "select";
  ui.onlineRoomPanel.hidden = !visible || game.mode === "select";
  if (!visible) return;
  ui.waitingRoomCode.textContent = code; ui.activeRoomCode.textContent = code;
  ui.waitingConnectionState.innerHTML = `<i></i> ${status}`;
  ui.roomConnectionState.innerHTML = `<i></i> ${status}`;
}

function sendNetwork(message) {
  if (net.socket?.readyState === WebSocket.OPEN) net.socket.send(JSON.stringify(message));
}

function connectNetwork() {
  if (net.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(net.socket.readyState)) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  net.socket = socket;
  socket.addEventListener("open", () => { net.connected = true; net.lastPong = Date.now(); sendNetwork({ type: "hello", clientId: browserPlayerId }); setMatchStatus("온라인 대전 서버 연결됨"); });
  socket.addEventListener("close", () => {
    if (net.matchKind === "invite" && net.roomCode) net.reconnectCode = net.roomCode;
    net.connected = false; net.waiting = false;
    updatePresence(net.playersOnline, false); updateRoomDisplay("서버 연결 끊김", net.roomCode, Boolean(net.roomCode));
    setMatchStatus("온라인 서버 연결이 끊겼습니다. 잠시 후 다시 시도하세요.", true);
    if (["random", "invite"].includes(game.matchType) && game.mode === "playing") returnToSelection("상대와 연결이 끊겼습니다.");
    setTimeout(connectNetwork, 1800);
  });
  socket.addEventListener("error", () => setMatchStatus("온라인 서버에 연결할 수 없습니다.", true));
  socket.addEventListener("message", (event) => {
    net.lastPong = Date.now();
    try { handleNetworkMessage(JSON.parse(event.data)); } catch { setMatchStatus("온라인 데이터를 읽지 못했습니다.", true); }
  });
}

function handleNetworkMessage(message) {
  if (message.type === "connected") {
    net.connected = true; updatePresence(message.playersOnline); setMatchStatus(`온라인 서버 연결됨 · 접속 ${message.playersOnline}명`);
    if (net.reconnectCode) {
      const code = net.reconnectCode; net.reconnectCode = null; selectInviteMode();
      sendNetwork({ type: "join_invite", roomCode: code, classId: selectedClass, nickname: currentNickname() });
      setMatchStatus(`${code} 방에 다시 연결하는 중…`);
    }
    return;
  }
  if (message.type === "presence") { updatePresence(message.playersOnline); return; }
  if (message.type === "pong") { net.lastPong = Date.now(); return; }
  if (message.type === "waiting") {
    net.waiting = true; ui.cancelMatchButton.hidden = false;
    setMatchStatus("상대를 찾는 중… 다른 접속자가 오면 바로 시작합니다."); return;
  }
  if (message.type === "invite_created") {
    net.waiting = true; net.roomCode = message.roomCode; net.matchKind = "invite"; rememberInviteCode(message.roomCode); ui.cancelMatchButton.hidden = false;
    updateRoomDisplay(message.rejoined ? "방 재입장 완료 · 상대 대기" : "상대 접속 대기", message.roomCode, true);
    setMatchStatus(`초대 코드 ${message.roomCode} · 상대에게 이 코드를 보내세요.`); return;
  }
  if (message.type === "room_state") { enterInviteLobby(message); return; }
  if (message.type === "matched") { startNetworkMatch(message); return; }
  if (message.type === "rematch_waiting") { ui.restartButton.disabled = true; ui.restartButton.textContent = "상대의 다시 싸우기 선택 대기…"; return; }
  if (message.type === "cancelled") { net.waiting = false; net.role = null; net.lobbyRole = null; net.peerConnected = false; net.roomCode = null; net.matchKind = null; ui.cancelMatchButton.hidden = true; updateRoomDisplay("", null, false); updateModeUi(); return; }
  if (message.type === "peer_left") {
    if (message.roomPreserved && message.roomCode) waitInPreservedInviteRoom(message.roomCode);
    else returnToSelection("상대가 대전에서 나갔습니다.");
    return;
  }
  if (message.type === "error") {
    if (String(message.message).includes("초대 코드")) {
      net.waiting = false; net.lobbyRole = null; net.peerConnected = false; net.roomCode = null; net.matchKind = null;
      ui.cancelMatchButton.hidden = true; updateRoomDisplay("", null, false); updateModeUi();
    }
    setMatchStatus(message.message, true); return;
  }
  if (message.type === "input" && net.role === "host") { net.remoteInput = message.input; return; }
  if (message.type === "action" && net.role === "host") {
    const remote = game.actors.find((actor) => actor.isNetworkRemote);
    if (remote) performAction(remote, message.action); return;
  }
  if (message.type === "snapshot" && net.role === "guest") { applySnapshot(message.state); return; }
  if (message.type === "match_end" && net.role === "guest") endMatch(message.winnerTeam, false);
}

function selectInviteMode() {
  selectedMode = "invite";
  document.querySelectorAll(".mode-option").forEach((item) => {
    const selected = item.dataset.mode === "invite"; item.classList.toggle("selected", selected); item.setAttribute("aria-checked", String(selected));
  });
}

function enterInviteLobby(message) {
  selectInviteMode(); game = makeEmptyGame(); game.mode = "select";
  net.role = null; net.waiting = true; net.roomCode = message.roomCode; net.matchKind = "invite";
  net.lobbyRole = message.lobbyRole; net.peerConnected = Boolean(message.peerConnected); rememberInviteCode(message.roomCode);
  ui.startScreen.hidden = false; ui.resultScreen.hidden = true; ui.pauseScreen.hidden = true; ui.hud.hidden = true; ui.mobileControls.hidden = true; ui.cancelMatchButton.hidden = false;
  updateModeUi();
  const isHost = net.lobbyRole === "host";
  const state = net.peerConnected ? (isHost ? "상대 접속 완료 · 시작 가능" : "방장 시작 대기") : "상대 접속 대기";
  updateRoomDisplay(state, message.roomCode, true);
  if (message.promoted) setMatchStatus(`기존 방장이 나가서 내가 새 방장이 되었습니다. ${message.roomCode} 방은 유지됩니다.`);
  else if (net.peerConnected) setMatchStatus(isHost ? "상대가 들어왔습니다. 전투 시작 버튼을 누르세요." : "방에 들어왔습니다. 방장이 시작하기를 기다립니다.");
  else setMatchStatus(`초대 코드 ${message.roomCode} · 상대에게 이 코드를 보내세요.`);
}

function startNetworkMatch(message) {
  game = makeEmptyGame(); game.mode = "playing"; game.matchType = message.kind; game.networkRole = message.role; game.remaining = 120; game.scoreLimit = 5;
  net.role = message.role; net.lobbyRole = message.role; net.peerConnected = true; net.roomCode = message.roomCode; net.matchKind = message.kind; net.localTeam = message.role === "host" ? 0 : 1; net.waiting = false;
  if (message.kind === "invite") rememberInviteCode(message.roomCode);
  const hostActor = createActor(0, message.hostClass, 390, 300, message.role === "host", 0);
  const guestActor = createActor(1, message.guestClass, W - 390, 300, message.role === "guest", 0);
  hostActor.name = message.hostName || "방장"; guestActor.name = message.guestName || "도전자";
  if (message.role === "host") guestActor.isNetworkRemote = true;
  game.actors.push(hostActor, guestActor); game.player = message.role === "host" ? hostActor : guestActor;
  ui.startScreen.hidden = true; ui.resultScreen.hidden = true; ui.pauseScreen.hidden = true; ui.hud.hidden = false; ui.mobileControls.hidden = false;
  ui.restartButton.disabled = false; ui.restartButton.textContent = "다시 싸우기";
  ui.pauseButton.textContent = "경기 메뉴"; applyClassHud(); ui.scoreGoal.textContent = `5 K.O. 선취 · ${message.kind === "random" ? "랜덤" : "초대"} 대전 · ${message.roomCode}`;
  updateRoomDisplay("상대 연결됨", message.roomCode, true);
  addFeed("상대 연결 완료 — 대전을 시작합니다!", "#ffd34e"); lastTime = performance.now(); tone(620, .16, "triangle", .05);
}

function serializeActor(actor) { const { spec: _spec, ...plain } = actor; return plain; }
function snapshotState() {
  return {
    remaining: game.remaining, scores: game.scores, mode: game.mode,
    actors: game.actors.map(serializeActor),
    projectiles: game.projectiles.map(({ owner, ...item }) => ({ ...item, ownerId: owner.id })),
    bursts: game.bursts.map(({ owner, ...item }) => ({ ...item, ownerId: owner.id })),
    slashes: game.slashes,
  };
}
function applySnapshot(state) {
  if (!state || !Array.isArray(state.actors)) return;
  const actors = state.actors.map((plain) => ({
    ...plain, spec: CLASSES[plain.classId], isPlayer: plain.team === net.localTeam,
  }));
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  game.actors = actors; game.player = actors.find((actor) => actor.team === net.localTeam) ?? actors[0];
  game.projectiles = (state.projectiles || []).map(({ ownerId, ...item }) => ({ ...item, owner: byId.get(ownerId) }));
  game.bursts = (state.bursts || []).map(({ ownerId, ...item }) => ({ ...item, owner: byId.get(ownerId) }));
  game.slashes = state.slashes || []; game.scores = state.scores; game.remaining = state.remaining; updateHud();
}

function returnToSelection(message) {
  net.role = null; net.lobbyRole = null; net.peerConnected = false; net.roomCode = null; net.matchKind = null; net.waiting = false; game = makeEmptyGame(); game.mode = "select";
  ui.startScreen.hidden = false; ui.resultScreen.hidden = true; ui.pauseScreen.hidden = true; ui.hud.hidden = true; ui.mobileControls.hidden = true; ui.cancelMatchButton.hidden = true;
  updateRoomDisplay("", null, false);
  updateModeUi(); setMatchStatus(message, true);
}

function waitInPreservedInviteRoom(roomCode) {
  net.role = null; net.lobbyRole = "host"; net.peerConnected = false; net.roomCode = roomCode; net.matchKind = "invite"; net.waiting = true; rememberInviteCode(roomCode);
  selectInviteMode(); game = makeEmptyGame(); game.mode = "select";
  ui.startScreen.hidden = false; ui.resultScreen.hidden = true; ui.pauseScreen.hidden = true; ui.hud.hidden = true; ui.mobileControls.hidden = true; ui.cancelMatchButton.hidden = false;
  updateModeUi(); updateRoomDisplay("상대 재접속 대기", roomCode, true);
  setMatchStatus(`상대가 나갔지만 ${roomCode} 방은 유지됩니다. 같은 코드로 다시 들어올 수 있습니다.`);
}

function goHome() {
  if (net.waiting || net.role) sendNetwork({ type: "cancel" });
  net.role = null; net.lobbyRole = null; net.peerConnected = false; net.roomCode = null; net.matchKind = null; net.waiting = false; net.remoteInput = { moveX: 0, moveY: 0, guard: false, dash: false };
  selectedMode = "duel"; game = makeEmptyGame(); game.mode = "select"; input.keys.clear(); input.moveX = 0; input.moveY = 0; input.guardTouch = false;
  document.querySelectorAll(".mode-option").forEach((item) => {
    const selected = item.dataset.mode === "duel"; item.classList.toggle("selected", selected); item.setAttribute("aria-checked", String(selected));
  });
  ui.startScreen.hidden = false; ui.resultScreen.hidden = true; ui.pauseScreen.hidden = true; ui.hud.hidden = true; ui.mobileControls.hidden = true; ui.cancelMatchButton.hidden = true;
  updateRoomDisplay("", null, false);
  ui.pauseButton.textContent = "일시정지"; updateModeUi(); tone(390, .06, "triangle", .025);
}

async function toggleLandscape() {
  if (landscapeActive) {
    landscapeActive = false; document.body.classList.remove("forced-landscape");
    try { screen.orientation?.unlock?.(); } catch { /* optional browser API */ }
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* optional browser API */ }
    ui.landscapeButton.textContent = "↻ 가로화면"; return;
  }
  landscapeActive = true;
  try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch { /* continue with CSS fallback */ }
  let locked = false;
  try { if (screen.orientation?.lock) { await screen.orientation.lock("landscape"); locked = true; } } catch { /* iOS and some browsers block orientation lock */ }
  document.body.classList.toggle("forced-landscape", !locked && matchMedia("(orientation: portrait)").matches);
  ui.landscapeButton.textContent = "↺ 세로화면";
}

function createActor(team, classId, x, y, isPlayer = false, index = 0) {
  const spec = CLASSES[classId];
  return {
    id: game.nextId++, team, classId, spec, isPlayer, name: isPlayer ? currentNickname() : `${team ? "R" : "B"}-${index + 1}`,
    x, y, vx: 0, vy: 0, r: 29, facingX: team ? -1 : 1, facingY: 0,
    hp: spec.hp, maxHp: spec.hp, mp: 100, maxMp: 100, bp: 100, maxBp: 100,
    alive: true, invulnerable: 1.2, respawn: 0, flash: 0, stun: 0, chill: 0, guard: false, guardBreak: 0, counter: 0,
    meleeCd: 0, rangedCd: 0, magicCd: 0, attackAnim: 0, moveX: 0, moveY: 0,
    kills: 0, deaths: 0, aiTimer: rand(.05, .22), strafe: Math.random() < .5 ? -1 : 1, aiSkill: 1, damageScale: 1,
    runTime: 0, dustTimer: 0, wallFlash: 0, step: rand(0, TAU), speedCap: spec.speed,
  };
}

function startMatch() {
  currentNickname();
  game = makeEmptyGame();
  game.mode = "playing";
  if (selectedMode === "duel") {
    game.remaining = 120;
    const player = createActor(0, selectedClass, 390, 300, true, 0);
    const rival = createActor(1, selectedOpponentClass, W - 390, 300, false, 0);
    player.damageScale = 1.18;
    rival.name = "연습 상대"; rival.aiSkill = .29; rival.damageScale = .54; rival.maxHp *= .76; rival.hp = rival.maxHp;
    game.actors.push(player, rival); game.player = player;
  } else {
    const allyClasses = [selectedClass, "ranger", "mage", "blade"];
    const enemyClasses = ["blade", "ranger", "mage", "blade"];
    for (let i = 0; i < 4; i += 1) {
      const ally = createActor(0, allyClasses[i], 125 + (i % 2) * 62, 270 + Math.floor(i / 2) * 110, i === 0, i);
      const enemy = createActor(1, enemyClasses[i], W - 125 - (i % 2) * 62, 270 + Math.floor(i / 2) * 110, false, i);
      if (!ally.isPlayer) ally.aiSkill = .88;
      enemy.aiSkill = .62; enemy.damageScale = .79;
      game.actors.push(ally, enemy);
      if (ally.isPlayer) game.player = ally;
    }
  }
  ui.startScreen.hidden = true;
  ui.resultScreen.hidden = true;
  ui.pauseScreen.hidden = true;
  ui.hud.hidden = false;
  ui.mobileControls.hidden = false;
  ui.pauseButton.textContent = "일시정지";
  applyClassHud();
  ui.scoreGoal.textContent = `${game.scoreLimit} K.O. 선취 · ${game.matchType === "duel" ? "1대1 AI 연습전" : "4대4 팀전"}`;
  addFeed(`전투 개시 — ${game.scoreLimit} K.O.를 먼저 달성하세요!`, "#ffd34e");
  if (game.matchType === "duel") addFeed("연습 상대는 공격 빈도와 체력이 낮습니다.", "#aeeaff");
  lastTime = performance.now();
  tone(540, .12, "triangle", .05);
}

function applyClassHud() {
  const spec = CLASSES[selectedClass];
  ui.portrait.textContent = spec.icon;
  ui.weaponCard.textContent = spec.weapon;
  ui.armorCard.textContent = spec.armor;
  ui.magicCard.textContent = spec.spell;
}

function addFeed(text, color = "#fff") {
  game.feed.unshift({ text, color, time: 4 });
  game.feed = game.feed.slice(0, 4);
  ui.killFeed.innerHTML = game.feed.map((item) => `<p style="color:${item.color}">${item.text}</p>`).join("");
}

function nearestEnemy(actor) {
  let best = null; let bestDistance = Infinity;
  for (const other of game.actors) {
    if (!other.alive || other.team === actor.team) continue;
    const d = distance(actor, other);
    if (d < bestDistance) { best = other; bestDistance = d; }
  }
  return { target: best, distance: bestDistance };
}

function melee(actor) {
  if (!actor.alive || actor.stun > 0 || actor.meleeCd > 0) return;
  actor.meleeCd = actor.classId === "blade" ? .43 : actor.classId === "ranger" ? .52 : .55;
  actor.attackAnim = actor.classId === "mage" ? .3 : actor.classId === "blade" ? .28 : .25;
  actor.guardBreak = actor.classId === "blade" ? .22 : .28;
  actor.guard = false;
  const baseAngle = Math.atan2(actor.facingY, actor.facingX);
  game.slashes.push({ x: actor.x, y: actor.y, angle: baseAngle, team: actor.team, classId: actor.classId, life: .2, max: .2, range: actor.spec.meleeRange });
  let hit = false;
  // 근접 공격은 정면의 적 투사체를 쳐낼 수 있다. 원거리 견제에 접근할 틈을 만든다.
  for (const projectile of game.projectiles) {
    if (projectile.life <= 0 || projectile.team === actor.team) continue;
    const dx = projectile.x - actor.x; const dy = projectile.y - actor.y;
    if (Math.hypot(dx, dy) <= actor.spec.meleeRange + 10 && Math.abs(angleDiff(Math.atan2(dy, dx), baseAngle)) < actor.spec.meleeArc / 2) {
      projectile.life = 0; hit = true; spawnHit(projectile.x, projectile.y, "#fff6b0", 7);
    }
  }
  for (const target of game.actors) {
    if (!target.alive || target.team === actor.team || target.invulnerable > 0) continue;
    const dx = target.x - actor.x; const dy = target.y - actor.y; const d = Math.hypot(dx, dy);
    const arc = actor.spec.meleeArc;
    if (d <= actor.spec.meleeRange + target.r && Math.abs(angleDiff(Math.atan2(dy, dx), baseAngle)) < arc / 2) {
      dealDamage(target, actor, actor.spec.melee * (actor.counter > 0 ? 1.42 : 1), dx, dy, .22);
      hit = true;
    }
  }
  if (actor.counter > 0) actor.counter = 0;
  tone(hit ? 170 : 235, .07, "sawtooth", hit ? .05 : .025);
}

function ranged(actor) {
  const mpCost = actor.classId === "ranger" ? 13 : 14;
  if (!actor.alive || actor.stun > 0 || actor.rangedCd > 0 || actor.mp < mpCost) return;
  actor.mp -= mpCost;
  actor.rangedCd = actor.classId === "ranger" ? .6 : actor.classId === "mage" ? .72 : .82;
  actor.attackAnim = .26;
  actor.guardBreak = .24;
  actor.guard = false;
  game.projectiles.push({
    x: actor.x + actor.facingX * 28, y: actor.y + actor.facingY * 28,
    vx: actor.facingX * actor.spec.shotSpeed, vy: actor.facingY * actor.spec.shotSpeed, r: actor.classId === "mage" ? 7 : 5,
    damage: actor.spec.ranged, owner: actor, team: actor.team, classId: actor.classId, life: actor.spec.shotLife, color: actor.spec.projectile,
  });
  tone(actor.classId === "ranger" ? 680 : 440, .05, "triangle", .03);
}

function magic(actor) {
  const mpCost = actor.classId === "mage" ? 32 : 35;
  if (!actor.alive || actor.stun > 0 || actor.magicCd > 0 || actor.mp < mpCost) return;
  actor.mp -= mpCost;
  actor.magicCd = actor.classId === "mage" ? 3.8 : 5;
  actor.attackAnim = .38;
  actor.guardBreak = .4;
  actor.guard = false;
  const reach = actor.classId === "mage" ? 155 : 125;
  const nearest = actor.classId === "mage" ? nearestEnemy(actor).target : null;
  game.bursts.push({
    x: clamp(nearest?.x ?? actor.x + actor.facingX * reach, 65, W - 65),
    y: clamp(nearest?.y ?? actor.y + actor.facingY * reach, 65, H - 65),
    radius: actor.classId === "mage" ? 94 : 76, delay: .68, life: 1.12, owner: actor,
    damage: actor.spec.magic, team: actor.team, fired: false, classId: actor.classId,
  });
  tone(290, .18, "sine", .04);
}

function dealDamage(target, attacker, amount, dx, dy, knockbackScale = 1) {
  if (!target.alive || target.invulnerable > 0) return;
  amount *= attacker.damageScale ?? 1;
  const incoming = normalize(dx, dy);
    // incoming은 공격자→피격자 방향이다. 피격자가 공격자를 바라볼 때
    // facing은 그 반대 방향이므로 부호를 뒤집어 정면 방어를 판정한다.
    const front = -(target.facingX * incoming.x + target.facingY * incoming.y);
  const blocked = target.guard && target.bp >= 9 && front > Math.cos(70 * Math.PI / 180);
  const finalDamage = amount * (blocked ? .2 : 1);
  target.hp -= finalDamage;
  target.flash = .12;
  target.stun = blocked ? .05 : .15;
  target.vx += incoming.x * (blocked ? 55 : 145 * knockbackScale);
  target.vy += incoming.y * (blocked ? 55 : 145 * knockbackScale);
  if (blocked) { target.counter = 1.15; target.bp = Math.max(0, target.bp - 9 - amount * .12); }
  if (attacker.isPlayer) game.stats.damage += finalDamage;
  spawnHit(target.x, target.y, blocked ? "#8be2ff" : "#ffd45d", blocked ? 5 : 10);
  if (target.hp <= 0) knockOut(target, attacker);
}

function knockOut(target, attacker) {
  target.hp = 0; target.alive = false; target.respawn = 3; target.deaths += 1; attacker.kills += 1;
  game.scores[attacker.team] += 1;
  attacker.hp = Math.min(attacker.maxHp, attacker.hp + 22); attacker.mp = Math.min(100, attacker.mp + 30); attacker.bp = 100;
  if (attacker.isPlayer) game.stats.kills += 1;
  if (target.isPlayer) game.stats.deaths += 1;
  addFeed(`${attacker.name}  ⚔  ${target.name}`, attacker.team ? "#ff9aa4" : "#83d1ff");
  spawnHit(target.x, target.y, "#ffffff", 24);
  game.shake = 9;
  tone(90, .22, "sawtooth", .06);
  if (game.scores[attacker.team] >= game.scoreLimit) endMatch(attacker.team);
}

function spawnHit(x, y, color, count) {
  for (let i = 0; i < count; i += 1) game.particles.push({ x, y, vx: rand(-170, 170), vy: rand(-170, 170), life: rand(.25, .58), max: .58, color, r: rand(2, 5) });
}

function updatePlayer(actor, dt) {
  let x = input.moveX; let y = input.moveY;
  if (input.keys.has("KeyA") || input.keys.has("ArrowLeft")) x -= 1;
  if (input.keys.has("KeyD") || input.keys.has("ArrowRight")) x += 1;
  if (input.keys.has("KeyW") || input.keys.has("ArrowUp")) y -= 1;
  if (input.keys.has("KeyS") || input.keys.has("ArrowDown")) y += 1;
  updateControlled(actor, { x, y, guard: input.keys.has("Space") || input.guardTouch, dash: input.keys.has("ShiftLeft") || input.keys.has("ShiftRight") }, dt);
}

function updateControlled(actor, control, dt) {
  const x = control.x ?? control.moveX ?? 0; const y = control.y ?? control.moveY ?? 0;
  const move = quantize8(x, y); const moving = Math.abs(x) + Math.abs(y) > .08;
  actor.guard = Boolean(control.guard) && actor.guardBreak <= 0;
  let accel = actor.spec.accel * (actor.guard ? .34 : 1);
  const dashing = moving && Boolean(control.dash) && actor.bp > 1 && !actor.guard;
  actor.speedCap = actor.spec.speed * (dashing ? 1.42 : actor.guard ? .45 : 1) * (actor.chill > 0 ? .62 : 1);
  if (dashing) { accel *= 1.32; actor.bp = Math.max(0, actor.bp - 34 * dt); }
  actor.moveX = moving ? move.x : 0; actor.moveY = moving ? move.y : 0;
  if (moving && !actor.guard) { actor.facingX = move.x; actor.facingY = move.y; }
  if (actor.stun <= 0) { actor.vx += actor.moveX * accel * dt; actor.vy += actor.moveY * accel * dt; }
  recover(actor, dt, moving, dashing);
}

function localControl() {
  let x = input.moveX; let y = input.moveY;
  if (input.keys.has("KeyA") || input.keys.has("ArrowLeft")) x -= 1;
  if (input.keys.has("KeyD") || input.keys.has("ArrowRight")) x += 1;
  if (input.keys.has("KeyW") || input.keys.has("ArrowUp")) y -= 1;
  if (input.keys.has("KeyS") || input.keys.has("ArrowDown")) y += 1;
  return { moveX: x, moveY: y, guard: input.keys.has("Space") || input.guardTouch, dash: input.keys.has("ShiftLeft") || input.keys.has("ShiftRight") };
}

function performAction(actor, action) {
  if (!actor) return;
  if (action === "melee") melee(actor);
  if (action === "range") ranged(actor);
  if (action === "magic") magic(actor);
}

function performLocalAction(action) {
  if (game.networkRole === "guest") sendNetwork({ type: "action", action });
  else performAction(game.player, action);
}

function updateAi(actor, dt) {
  actor.aiTimer -= dt;
  const { target, distance: d } = nearestEnemy(actor);
  if (!target) return;
  const aim = quantize8(target.x - actor.x, target.y - actor.y);
  actor.facingX = aim.x; actor.facingY = aim.y;
  actor.guard = false;
  const hostileProjectile = game.projectiles.some((p) => p.team !== actor.team && Math.hypot(p.x - actor.x, p.y - actor.y) < 105);
  if (hostileProjectile && actor.guardBreak <= 0 && Math.random() < .2 * actor.aiSkill) actor.guard = true;
  const ideal = actor.classId === "blade" ? 72 : actor.classId === "ranger" ? 132 : 108;
  let moveX = 0; let moveY = 0;
  if (d > ideal + 25) { moveX = aim.x; moveY = aim.y; }
  else if (d < ideal - 25 && actor.classId !== "blade") { moveX = -aim.x; moveY = -aim.y; }
  else { moveX = -aim.y * actor.strafe * .72; moveY = aim.x * actor.strafe * .72; }
  // 직선 경로의 나무·바위에 갇히지 않도록 가까운 장애물을 8방향으로 우회한다.
  for (const ob of obstacles) {
    const ox=ob.x-actor.x; const oy=ob.y-actor.y; const od=Math.hypot(ox,oy); if(od>ob.r+95) continue;
    const toward=(ox/(od||1))*moveX+(oy/(od||1))*moveY;
    if(toward>.45){const side=actor.strafe;moveX+=-oy/(od||1)*side*1.25;moveY+=ox/(od||1)*side*1.25;}
  }
  const move = quantize8(moveX, moveY);
  actor.moveX = moveX ? move.x : 0; actor.moveY = moveY ? move.y : 0;
  actor.speedCap = actor.spec.speed * (actor.guard ? .45 : 1) * (actor.chill > 0 ? .62 : 1);
  if (actor.stun <= 0 && !actor.guard) { const aiDrive=.76+.16*actor.aiSkill; actor.vx += actor.moveX * actor.spec.accel * aiDrive * dt; actor.vy += actor.moveY * actor.spec.accel * aiDrive * dt; }
  if (actor.aiTimer <= 0) {
    actor.aiTimer = rand(.14, .32) / actor.aiSkill;
    if (d < actor.spec.meleeRange + 18) melee(actor);
    else if (actor.mp >= (actor.classId === "mage" ? 32 : 35) && actor.magicCd <= 0 && d < 235 && Math.random() < .17 * actor.aiSkill) magic(actor);
    else if (d < 300 && Math.random() < (actor.classId === "ranger" ? .48 : .3) * actor.aiSkill) ranged(actor);
    if (Math.random() < .08) actor.strafe *= -1;
  }
  recover(actor, dt, Math.abs(moveX) + Math.abs(moveY) > .1, false);
}

function recover(actor, dt, moving, dashing) {
  const stillBonus = moving ? 1 : 2.5;
  actor.mp = Math.min(actor.maxMp, actor.mp + 7.2 * stillBonus * dt);
  if (!dashing) actor.bp = Math.min(actor.maxBp, actor.bp + 14 * stillBonus * dt);
  if (!moving && !actor.guard) actor.hp = Math.min(actor.maxHp, actor.hp + 1.5 * dt);
}

function moveActor(actor, dt) {
  // 낮은 감속으로 키를 놓은 뒤에도 미끄러지고, 반대 방향 입력으로 제동한다.
  const drag = Math.exp(-actor.spec.grip * dt);
  actor.vx *= drag; actor.vy *= drag;
  const speedLimit = actor.speedCap;
  const v = Math.hypot(actor.vx, actor.vy);
  if (v > speedLimit) { actor.vx = actor.vx / v * speedLimit; actor.vy = actor.vy / v * speedLimit; }
  actor.step += v * dt * .052;
  actor.runTime = v > actor.spec.speed * .6 ? actor.runTime + dt : Math.max(0, actor.runTime - dt * 2);
  actor.dustTimer -= dt;
  if (actor.runTime > .22 && actor.dustTimer <= 0) { spawnDust(actor); actor.dustTimer = .075; }
  actor.x += actor.vx * dt; actor.y += actor.vy * dt;
  let bounced = false;
  if (actor.x < 34) { actor.x = 34; actor.vx = Math.abs(actor.vx) * actor.spec.bounce; bounced = true; }
  if (actor.x > W - 34) { actor.x = W - 34; actor.vx = -Math.abs(actor.vx) * actor.spec.bounce; bounced = true; }
  if (actor.y < 60) { actor.y = 60; actor.vy = Math.abs(actor.vy) * actor.spec.bounce; bounced = true; }
  if (actor.y > H - 38) { actor.y = H - 38; actor.vy = -Math.abs(actor.vy) * actor.spec.bounce; bounced = true; }
  for (const ob of obstacles) {
    const dx = actor.x - ob.x; const dy = actor.y - ob.y; const d = Math.hypot(dx, dy); const min = actor.r + ob.r;
    if (d < min) {
      const n = normalize(dx, dy); actor.x = ob.x + n.x * min; actor.y = ob.y + n.y * min;
      const toward = actor.vx * n.x + actor.vy * n.y;
      if (toward < 0) { actor.vx -= (1 + actor.spec.bounce) * toward * n.x; actor.vy -= (1 + actor.spec.bounce) * toward * n.y; bounced = true; }
    }
  }
  if (bounced && v > 120) { actor.wallFlash = .12; spawnHit(actor.x, actor.y, "#d8c89a", 5); }
}

function spawnDust(actor) {
  const speed = Math.hypot(actor.vx, actor.vy); if (speed < 80) return;
  const back = normalize(-actor.vx, -actor.vy);
  game.particles.push({ x: actor.x + back.x * 15 + rand(-5,5), y: actor.y + back.y * 15 + rand(-4,4), vx: back.x * rand(12,35), vy: back.y * rand(12,35), life: .42, max: .42, color: "rgba(214,190,132,.7)", r: rand(3,7), dust: true });
}

function respawnActor(actor) {
  actor.alive = true; actor.hp = actor.maxHp; actor.mp = 75; actor.bp = 100; actor.chill = 0; actor.invulnerable = 1.35;
  actor.x = actor.team ? W - rand(105, 205) : rand(105, 205); actor.y = rand(190, H - 110);
  actor.vx = 0; actor.vy = 0;
}

function updateProjectiles(dt) {
  for (const p of game.projectiles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) p.life = 0;
    if (obstacles.some((ob) => Math.hypot(p.x - ob.x, p.y - ob.y) < p.r + ob.r)) p.life = 0;
    for (const actor of game.actors) {
      if (p.life <= 0 || !actor.alive || actor.team === p.team || actor.invulnerable > 0) continue;
      if (Math.hypot(p.x - actor.x, p.y - actor.y) < p.r + actor.r) {
        dealDamage(actor, p.owner, p.damage, p.vx, p.vy, .72); p.life = 0;
      }
    }
  }
  game.projectiles = game.projectiles.filter((p) => p.life > 0);
}

function updateEffects(dt) {
  for (const burst of game.bursts) {
    burst.delay -= dt; burst.life -= dt;
    if (!burst.fired && burst.delay <= 0) {
      burst.fired = true; game.shake = Math.max(game.shake, 5); tone(120, .17, "square", .045);
      for (const actor of game.actors) {
        if (!actor.alive || actor.team === burst.team || actor.invulnerable > 0) continue;
        const d = Math.hypot(actor.x - burst.x, actor.y - burst.y);
        if (d < burst.radius + actor.r) {
          dealDamage(actor, burst.owner, burst.damage * (1 - d / (burst.radius * 2.2)), actor.x - burst.x, actor.y - burst.y, .86);
          if (burst.classId === "mage" && actor.alive) actor.chill = Math.max(actor.chill, 1.25);
        }
      }
      spawnHit(burst.x, burst.y, burst.classId === "mage" ? "#8df5ff" : "#ffba54", 28);
    }
  }
  game.bursts = game.bursts.filter((b) => b.life > 0);
  for (const slash of game.slashes) slash.life -= dt;
  game.slashes = game.slashes.filter((s) => s.life > 0);
  for (const p of game.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .94; p.vy *= .94; p.life -= dt; }
  game.particles = game.particles.filter((p) => p.life > 0);
}

function update(dt) {
  if (game.mode !== "playing") return;
  if (game.networkRole === "guest") {
    net.lastInputSent += dt;
    if (net.lastInputSent >= .045) { net.lastInputSent = 0; sendNetwork({ type: "input", input: localControl() }); }
    updateHud(); return;
  }
  game.remaining -= dt;
  if (game.remaining <= 0) { endMatch(game.scores[0] >= game.scores[1] ? 0 : 1); return; }
  for (const actor of game.actors) {
    actor.meleeCd = Math.max(0, actor.meleeCd - dt); actor.rangedCd = Math.max(0, actor.rangedCd - dt); actor.magicCd = Math.max(0, actor.magicCd - dt);
    actor.invulnerable = Math.max(0, actor.invulnerable - dt); actor.flash = Math.max(0, actor.flash - dt); actor.stun = Math.max(0, actor.stun - dt); actor.chill = Math.max(0, actor.chill - dt); actor.counter = Math.max(0, actor.counter - dt); actor.attackAnim = Math.max(0, actor.attackAnim - dt); actor.guardBreak = Math.max(0, actor.guardBreak - dt); actor.wallFlash = Math.max(0, actor.wallFlash - dt);
    if (!actor.alive) { actor.respawn -= dt; if (actor.respawn <= 0) respawnActor(actor); continue; }
    if (actor.isPlayer) updatePlayer(actor, dt);
    else if (actor.isNetworkRemote) updateControlled(actor, net.remoteInput, dt);
    else updateAi(actor, dt);
    moveActor(actor, dt);
  }
  updateProjectiles(dt); updateEffects(dt);
  for (const item of game.feed) item.time -= dt;
  game.feed = game.feed.filter((item) => item.time > 0);
  game.shake = Math.max(0, game.shake - 32 * dt);
  updateHud();
  if (game.networkRole === "host") {
    net.lastSnapshotSent += dt;
    if (net.lastSnapshotSent >= .045) { net.lastSnapshotSent = 0; sendNetwork({ type: "snapshot", state: snapshotState() }); }
  }
}

function endMatch(winnerTeam, broadcast = true) {
  game.mode = "over";
  const win = winnerTeam === (game.player?.team ?? 0);
  ui.resultEyebrow.textContent = win ? "BLUE TEAM VICTORY" : "RED TEAM VICTORY";
  ui.resultTitle.textContent = win ? "승리!" : "패배";
  ui.resultTitle.style.color = win ? "#8ed7ff" : "#ff8790";
  ui.resultBlue.textContent = game.scores[0]; ui.resultRed.textContent = game.scores[1];
  ui.resultStats.textContent = `${game.stats.kills} K.O. · ${game.stats.deaths} DEATH · ${Math.round(game.stats.damage).toLocaleString()} DAMAGE`;
  ui.pauseScreen.hidden = true; ui.resultScreen.hidden = false; ui.mobileControls.hidden = true;
  if (broadcast && game.networkRole === "host") sendNetwork({ type: "match_end", winnerTeam });
  tone(win ? 620 : 135, .35, win ? "triangle" : "sawtooth", .06);
}

function updateHud() {
  const p = game.player; if (!p) return;
  ui.hpBar.style.width = `${p.hp / p.maxHp * 100}%`; ui.mpBar.style.width = `${p.mp}%`; ui.bpBar.style.width = `${p.bp}%`;
  ui.hpText.textContent = Math.ceil(p.hp); ui.mpText.textContent = Math.ceil(p.mp); ui.bpText.textContent = Math.ceil(p.bp);
  ui.blueScore.textContent = game.scores[0]; ui.redScore.textContent = game.scores[1];
  const seconds = Math.max(0, Math.ceil(game.remaining)); ui.matchTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const meleeMax = p.classId === "blade" ? .43 : p.classId === "ranger" ? .52 : .55;
  const rangeMax = p.classId === "ranger" ? .6 : p.classId === "mage" ? .72 : .82;
  const magicMax = p.classId === "mage" ? 3.8 : 5;
  ui.meleeCd.style.height = `${clamp(p.meleeCd / meleeMax, 0, 1) * 100}%`; ui.rangeCd.style.height = `${clamp(p.rangedCd / rangeMax, 0, 1) * 100}%`; ui.magicCd.style.height = `${clamp(p.magicCd / magicMax, 0, 1) * 100}%`;
  ui.guardState.style.height = p.guard ? "100%" : "0%"; ui.dashState.style.height = (input.keys.has("ShiftLeft") || input.keys.has("ShiftRight")) ? "35%" : "0%";
}

function drawGround() {
  const gradient = ctx.createLinearGradient(0, 0, 0, H); gradient.addColorStop(0, "#41763a"); gradient.addColorStop(1, "#2b5c31");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(211,196,112,.09)"; ctx.beginPath(); ctx.ellipse(W / 2, H / 2, 510, 192, -.12, 0, TAU); ctx.fill();
  for (let x = 12; x < W; x += 34) for (let y = 12; y < H; y += 31) {
    const seed = Math.sin(x * 12.91 + y * 4.17); ctx.fillStyle = seed > 0 ? "rgba(164,220,104,.09)" : "rgba(4,48,22,.08)";
    ctx.fillRect(x + seed * 7, y, 2, 7);
  }
  ctx.strokeStyle = "rgba(235,255,191,.13)"; ctx.lineWidth = 3; ctx.strokeRect(22, 48, W - 44, H - 72);
  ctx.setLineDash([12, 12]); ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.beginPath(); ctx.moveTo(W / 2, 60); ctx.lineTo(W / 2, H - 24); ctx.stroke(); ctx.setLineDash([]);
}

function drawObstacle(ob) {
  ctx.save(); ctx.translate(ob.x, ob.y);
  ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(7, ob.r * .62, ob.r * .85, ob.r * .36, 0, 0, TAU); ctx.fill();
  if (ob.kind === "tree") {
    ctx.fillStyle = "#674a27"; ctx.fillRect(-9, 2, 18, 36);
    for (const [x, y, r, c] of [[-17,-13,29,"#1c672f"],[13,-18,31,"#267d37"],[0,-38,30,"#348b3d"],[-1,-9,34,"#236f31"]]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
    ctx.fillStyle = "rgba(189,255,107,.25)"; ctx.beginPath(); ctx.arc(-8,-38,10,0,TAU); ctx.fill();
  } else if (ob.kind === "crystal") {
    ctx.rotate(Math.PI / 4); ctx.fillStyle = "#49c7a3"; ctx.fillRect(-28,-28,56,56); ctx.strokeStyle = "#b7ffe4"; ctx.lineWidth = 4; ctx.strokeRect(-28,-28,56,56);
  } else {
    ctx.fillStyle = "#71806a"; ctx.beginPath(); ctx.moveTo(-ob.r, 14); ctx.lineTo(-ob.r*.5,-ob.r*.7); ctx.lineTo(ob.r*.4,-ob.r); ctx.lineTo(ob.r,10); ctx.lineTo(ob.r*.5,ob.r*.7); ctx.lineTo(-ob.r*.6,ob.r*.65); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(220,240,205,.35)"; ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.restore();
}

function drawActor(actor, time) {
  if (!actor.alive) {
    ctx.save(); ctx.globalAlpha = .55; ctx.strokeStyle = actor.team ? "#ff6d78" : "#61c7ff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(actor.x, actor.y - 5, 16 + Math.sin(time * 5) * 3, 0, TAU); ctx.stroke(); ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = "700 12px sans-serif"; ctx.textAlign = "center"; ctx.fillText(actor.respawn.toFixed(1), actor.x, actor.y); ctx.restore(); return;
  }
  ctx.save(); ctx.translate(actor.x, actor.y); if (actor.invulnerable > 0) ctx.globalAlpha = .55 + Math.sin(time * 20) * .25;
  const moving = Math.hypot(actor.vx, actor.vy) > 30;
  const bob = moving ? Math.sin(actor.step) * 2.2 : Math.sin(time * 3 + actor.id) * .65;
  const faceAngle = Math.atan2(actor.facingY, actor.facingX);
  const teamColor = actor.team ? "#d94b58" : "#348dd0";
  const darkTeam = actor.team ? "#812c3b" : "#1d557f";
  ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(4, 20, 25, 10, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = actor.team ? "#ff6271" : "#4dc5ff"; ctx.lineWidth = actor.isPlayer ? 5 : 3; ctx.beginPath(); ctx.ellipse(0, 12, 28, 15, 0, 0, TAU); ctx.stroke();
  if (actor.counter > 0) { ctx.strokeStyle = "#ffe866"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 1, 33 + Math.sin(time * 13) * 2, 0, TAU); ctx.stroke(); }
  if (actor.guard) {
    ctx.fillStyle = "rgba(90,210,255,.2)"; ctx.strokeStyle = "#b8f4ff"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(actor.facingX * 8, actor.facingY * 8); ctx.arc(0, 0, 38, faceAngle - 1.22, faceAngle + 1.22); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // 직업별 긴 머리·망토를 몸 뒤에 배치해 작은 화면에서도 SD 실루엣이 구분된다.
  if (actor.classId === "blade") {
    ctx.fillStyle="#f05b31";ctx.beginPath();ctx.moveTo(-11,-15+bob);ctx.quadraticCurveTo(-28,2+bob,-23,24+bob);ctx.quadraticCurveTo(-10,15+bob,-4,-3+bob);ctx.closePath();ctx.fill();
    ctx.fillStyle="#ffd15c";ctx.beginPath();ctx.moveTo(11,-20+bob);ctx.quadraticCurveTo(30,-7+bob,27,12+bob);ctx.quadraticCurveTo(15,6+bob,7,-6+bob);ctx.closePath();ctx.fill();
  } else if (actor.classId === "ranger") {
    ctx.fillStyle="#f5a13b";
    ctx.beginPath();ctx.moveTo(-10,-22+bob);ctx.quadraticCurveTo(-34,-4+bob,-27,28+bob);ctx.quadraticCurveTo(-16,18+bob,-4,-5+bob);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(10,-22+bob);ctx.quadraticCurveTo(36,-2+bob,29,28+bob);ctx.quadraticCurveTo(17,17+bob,4,-5+bob);ctx.closePath();ctx.fill();
    ctx.fillStyle="#4f82c9";ctx.beginPath();ctx.moveTo(-15,0+bob);ctx.lineTo(-23,23+bob);ctx.lineTo(0,15+bob);ctx.lineTo(23,23+bob);ctx.lineTo(15,0+bob);ctx.closePath();ctx.fill();
  } else {
    ctx.fillStyle="#b9f4ff";
    ctx.beginPath();ctx.moveTo(-11,-23+bob);ctx.quadraticCurveTo(-35,-1+bob,-27,31+bob);ctx.quadraticCurveTo(-17,22+bob,-5,-5+bob);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(11,-23+bob);ctx.quadraticCurveTo(35,-1+bob,27,31+bob);ctx.quadraticCurveTo(17,22+bob,5,-5+bob);ctx.closePath();ctx.fill();
    ctx.fillStyle="#836bd3";ctx.beginPath();ctx.moveTo(-15,2+bob);ctx.lineTo(-22,21+bob);ctx.lineTo(0,16+bob);ctx.lineTo(22,21+bob);ctx.lineTo(15,2+bob);ctx.closePath();ctx.fill();
  }

  // 다리와 몸: 화면에서는 항상 똑바로 서되 시선·장비가 8방향을 가리킨다.
  const stride = moving ? Math.sin(actor.step) * 5 : 0;
  ctx.strokeStyle = "#3a2519"; ctx.lineWidth = 7; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-7, 12 + bob); ctx.lineTo(-8 + stride, 24); ctx.moveTo(7, 12 + bob); ctx.lineTo(8 - stride, 24); ctx.stroke();
  ctx.fillStyle = darkTeam; ctx.beginPath(); ctx.ellipse(0, 6 + bob, 16, 19, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = teamColor; ctx.beginPath(); ctx.ellipse(0, 2 + bob, 14, 16, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = actor.spec.color; ctx.fillRect(-12, -2 + bob, 24, 6);
  ctx.fillStyle = actor.classId === "blade" ? "#fff0a6" : actor.classId === "ranger" ? "#d9efff" : "#f4e5ff";
  ctx.beginPath();ctx.moveTo(-13,8+bob);ctx.lineTo(0,17+bob);ctx.lineTo(13,8+bob);ctx.lineTo(10,16+bob);ctx.lineTo(-10,16+bob);ctx.closePath();ctx.fill();

  // 팔은 바라보는 방향으로 모여 무기 동작을 읽기 쉽게 한다.
  const handX = actor.facingX * 14; const handY = 2 + bob + actor.facingY * 8;
  ctx.strokeStyle = "#ffe4c2"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-10, 0 + bob); ctx.lineTo(handX, handY); ctx.stroke();

  // 큰 머리·직업별 머리 장식으로 SD 만화풍 실루엣을 만든다.
  ctx.fillStyle = actor.flash > 0 ? "#fff" : "#ffe4c2"; ctx.beginPath(); ctx.arc(0, -17 + bob, 18, 0, TAU); ctx.fill();
  if (actor.classId === "blade") {
    ctx.fillStyle = "#f3d447"; ctx.beginPath(); ctx.arc(-2, -21 + bob, 19, Math.PI, TAU); ctx.lineTo(15, -13 + bob); ctx.lineTo(-17, -11 + bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ed6b32"; ctx.beginPath(); ctx.moveTo(-18,-26+bob); ctx.lineTo(-7,-43+bob); ctx.lineTo(0,-28+bob); ctx.lineTo(10,-43+bob); ctx.lineTo(17,-24+bob); ctx.closePath(); ctx.fill();
  } else if (actor.classId === "ranger") {
    ctx.fillStyle = "#f09839"; ctx.beginPath(); ctx.arc(0,-18+bob,19,Math.PI,TAU); ctx.lineTo(18,-12+bob); ctx.lineTo(-18,-12+bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#4a2a28"; ctx.beginPath(); ctx.moveTo(-17,-27+bob); ctx.lineTo(-7,-41+bob); ctx.lineTo(0,-29+bob); ctx.lineTo(11,-42+bob); ctx.lineTo(18,-26+bob); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = "#d9f8ff"; ctx.beginPath(); ctx.arc(0,-20+bob,19,Math.PI,TAU); ctx.lineTo(17,-12+bob); ctx.lineTo(-17,-12+bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#4969c5"; ctx.beginPath(); ctx.ellipse(0,-31+bob,25,7,0,0,TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(-13,-32+bob); ctx.lineTo(4,-58+bob); ctx.lineTo(14,-31+bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#8cf4ff"; ctx.beginPath(); ctx.arc(4,-43+bob,3,0,TAU); ctx.fill();
  }
  ctx.fillStyle="#fff";ctx.globalAlpha*=.8;ctx.beginPath();ctx.ellipse(-6,-27+bob,5,2,-.5,0,TAU);ctx.fill();ctx.globalAlpha=actor.invulnerable>0?.55+Math.sin(time*20)*.25:1;
  // 눈과 볼은 방향에 따라 8방향으로 이동한다.
  const eyeShiftX = actor.facingX * 4; const eyeShiftY = actor.facingY * 2;
  if (actor.facingY > -.72) {
    ctx.fillStyle = "#28212a"; ctx.beginPath(); ctx.arc(-5+eyeShiftX,-18+bob+eyeShiftY,2.2,0,TAU); ctx.arc(5+eyeShiftX,-18+bob+eyeShiftY,2.2,0,TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,115,130,.38)"; ctx.beginPath(); ctx.arc(-10+eyeShiftX,-12+bob+eyeShiftY,3,0,TAU); ctx.arc(10+eyeShiftX,-12+bob+eyeShiftY,3,0,TAU); ctx.fill();
  }

  drawWeapon(actor, faceAngle, handX, handY, bob);
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,.66)"; ctx.fillRect(actor.x - 27, actor.y - 60, 54, 6); ctx.fillStyle = actor.team ? "#ff5d6e" : "#56c8ff"; ctx.fillRect(actor.x - 27, actor.y - 60, 54 * actor.hp / actor.maxHp, 6);
  ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.font = actor.isPlayer ? "900 12px sans-serif" : "800 11px sans-serif"; ctx.textAlign = "center"; ctx.fillText(actor.name, actor.x + 1, actor.y - 65); ctx.fillStyle = actor.isPlayer ? "#fff49a" : "#fff"; ctx.fillText(actor.name, actor.x, actor.y - 66);
}

function drawWeapon(actor, facingAngle, handX, handY, bob) {
  const maxAnim = actor.classId === "mage" ? .29 : .23;
  const progress = actor.attackAnim > 0 ? 1 - actor.attackAnim / maxAnim : .5;
  let angle = facingAngle;
  if (actor.attackAnim > 0) angle += -1.1 + progress * 2.15;
  const dx = Math.cos(angle); const dy = Math.sin(angle);
  if (actor.classId === "blade") {
    ctx.strokeStyle = "#713f25"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(handX-dx*4,handY-dy*4); ctx.lineTo(handX+dx*7,handY+dy*7); ctx.stroke();
    ctx.strokeStyle = "#fff4ad"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(handX+dx*7,handY+dy*7); ctx.lineTo(handX+dx*39,handY+dy*39); ctx.stroke();
    ctx.strokeStyle = "#ff8f3d"; ctx.lineWidth = 2; ctx.stroke();
  } else if (actor.classId === "ranger") {
    const px = -dy; const py = dx;
    ctx.strokeStyle = "#74421e"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(handX+dx*10,handY+dy*10,18,facingAngle-1.25,facingAngle+1.25); ctx.stroke();
    ctx.strokeStyle = "#e7efd5"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(handX+dx*10+px*17,handY+dy*10+py*17); ctx.lineTo(handX+dx*10-px*17,handY+dy*10-py*17); ctx.stroke();
    if (actor.attackAnim > 0) { ctx.strokeStyle="#fff2a0"; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(handX,handY); ctx.lineTo(handX+dx*29,handY+dy*29); ctx.stroke(); }
  } else {
    ctx.strokeStyle = "#6f4d9b"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(handX-dx*8,handY-dy*8); ctx.lineTo(handX+dx*34,handY+dy*34); ctx.stroke();
    ctx.fillStyle = "#9ef7ff"; ctx.shadowBlur = 10; ctx.shadowColor="#83eaff"; ctx.beginPath(); ctx.arc(handX+dx*38,handY+dy*38,7,0,TAU); ctx.fill(); ctx.shadowBlur=0;
  }
}

function drawActorSprite(actor, time) {
  if (!actor.alive) {
    ctx.save(); ctx.globalAlpha = .55; ctx.strokeStyle = actor.team ? "#ff6d78" : "#61c7ff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(actor.x, actor.y - 5, 16 + Math.sin(time * 5) * 3, 0, TAU); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = "800 12px sans-serif"; ctx.textAlign = "center"; ctx.fillText(actor.respawn.toFixed(1), actor.x, actor.y); ctx.restore(); return;
  }
  const speed = Math.hypot(actor.vx, actor.vy);
  const moving = speed > 34;
  const spriteSet = SPRITES[actor.classId];
  const pose = actor.attackAnim > 0 ? "attack" : moving && Math.sin(actor.step) > -.12 ? "run" : "idle";
  const image = spriteSet[pose].complete && spriteSet[pose].naturalWidth ? spriteSet[pose] : spriteSet.idle;
  const bob = moving ? Math.sin(actor.step * 2) * 1.35 : Math.sin(time * 3 + actor.id) * .65;
  const octant = (Math.round(Math.atan2(actor.facingY, actor.facingX) / (Math.PI / 4)) + 8) % 8;
  const frame = DIRECTION_TO_FRAME[octant];
  const col = frame % 4; const row = Math.floor(frame / 4);
  const attackMax = actor.classId === "mage" ? .38 : .28;
  const attackPhase = actor.attackAnim > 0 ? Math.sin((1 - actor.attackAnim / attackMax) * Math.PI) : 0;
  const faceAngle = Math.atan2(actor.facingY, actor.facingX);

  ctx.save(); ctx.translate(actor.x, actor.y);
  ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(4, 22, 29, 11, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = actor.team ? "#ff6271" : "#4dc5ff"; ctx.lineWidth = actor.isPlayer ? 5 : 3;
  ctx.beginPath(); ctx.ellipse(0, 14, 31, 16, 0, 0, TAU); ctx.stroke();
  if (actor.chill > 0) {
    ctx.strokeStyle = `rgba(148,244,255,${.35 + .25 * Math.sin(time * 12)})`; ctx.lineWidth = 4; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.ellipse(0, 14, 38, 20, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  if (actor.counter > 0) { ctx.strokeStyle = "#ffe866"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 3, 38 + Math.sin(time * 13) * 2, 0, TAU); ctx.stroke(); }
  if (actor.guard) {
    ctx.fillStyle = "rgba(90,210,255,.2)"; ctx.strokeStyle = "#b8f4ff"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(actor.facingX * 10, actor.facingY * 10); ctx.arc(0, 0, 44, faceAngle - 1.22, faceAngle + 1.22); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.translate(actor.facingX * attackPhase * 6, actor.facingY * attackPhase * 6 + bob);
  if (actor.invulnerable > 0) ctx.globalAlpha = .55 + Math.sin(time * 20) * .25;
  if (actor.flash > 0) { ctx.shadowBlur = 18; ctx.shadowColor = "#fff"; }
  if (image.complete && image.naturalWidth) {
    const sourceW = image.naturalWidth / 4; const sourceH = image.naturalHeight / 2;
    const drawH = actor.classId === "mage" ? 96 : 100;
    const drawW = drawH * sourceW / sourceH;
    ctx.drawImage(image, col * sourceW, row * sourceH, sourceW, sourceH, -drawW / 2, -drawH + 31, drawW, drawH);
  }
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(actor.x - 29, actor.y - 82, 58, 6);
  ctx.fillStyle = actor.team ? "#ff5d6e" : "#56c8ff"; ctx.fillRect(actor.x - 29, actor.y - 82, 58 * actor.hp / actor.maxHp, 6);
  ctx.fillStyle = actor.isPlayer ? "#fff49a" : "#fff"; ctx.font = actor.isPlayer ? "900 12px sans-serif" : "800 11px sans-serif"; ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 3; ctx.strokeText(actor.name, actor.x, actor.y - 88); ctx.fillText(actor.name, actor.x, actor.y - 88);
}

function drawEffects() {
  for (const burst of game.bursts) {
    ctx.save(); const pulse = 1 + Math.sin(performance.now() / 80) * .04;
    const spellColor = burst.classId === "mage" ? "#9ef6ff" : burst.classId === "ranger" ? "#aaff90" : "#ffb052";
    ctx.strokeStyle = burst.fired ? spellColor : "rgba(255,255,255,.7)"; ctx.lineWidth = burst.fired ? 8 : 3;
    ctx.fillStyle = burst.fired ? (burst.classId === "mage" ? "rgba(78,211,255,.32)" : burst.classId === "ranger" ? "rgba(80,230,120,.3)" : "rgba(255,115,45,.36)") : "rgba(255,230,120,.08)";
    ctx.beginPath(); ctx.arc(burst.x, burst.y, burst.radius * pulse * (burst.fired ? 1 : .72), 0, TAU); ctx.fill(); ctx.stroke();
    if (!burst.fired) {
      ctx.setLineDash([7,7]); ctx.beginPath(); ctx.arc(burst.x, burst.y, burst.radius, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha=.72; ctx.strokeStyle=spellColor;ctx.lineWidth=2;
      for(let i=0;i<8;i+=1){const a=i*Math.PI/4;ctx.beginPath();ctx.moveTo(burst.x+Math.cos(a)*burst.radius*.35,burst.y+Math.sin(a)*burst.radius*.35);ctx.lineTo(burst.x+Math.cos(a)*burst.radius*.72,burst.y+Math.sin(a)*burst.radius*.72);ctx.stroke();}
      ctx.globalAlpha=1;ctx.fillStyle="#fff";ctx.font="900 15px sans-serif";ctx.textAlign="center";ctx.fillText(burst.classId === "mage" ? "❄" : burst.classId === "ranger" ? "✦" : "✹",burst.x,burst.y+5);
    }
    ctx.restore();
  }
  for (const slash of game.slashes) {
    ctx.save(); ctx.globalAlpha = slash.life / slash.max;
    ctx.strokeStyle = slash.classId === "mage" ? "#9ef5ff" : slash.classId === "ranger" ? "#c7ff9c" : slash.team ? "#ff9b8d" : "#fff39a";
    ctx.shadowBlur = 12; ctx.shadowColor = ctx.strokeStyle; ctx.lineWidth = slash.classId === "blade" ? 12 : 8;
    const halfArc = slash.classId === "mage" ? 1.05 : slash.classId === "ranger" ? .92 : .78;
    ctx.beginPath(); ctx.arc(slash.x, slash.y, slash.range, slash.angle - halfArc, slash.angle + halfArc); ctx.stroke();
    if (slash.classId === "mage") { ctx.lineWidth=3; ctx.beginPath(); ctx.arc(slash.x,slash.y,slash.range-10,slash.angle-halfArc,slash.angle+halfArc); ctx.stroke(); }
    ctx.restore();
  }
  for (const p of game.projectiles) {
    ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(Math.atan2(p.vy,p.vx)); ctx.fillStyle = p.color; ctx.strokeStyle=p.color; ctx.shadowBlur = 14; ctx.shadowColor = p.color;
    if (p.classId === "ranger") { ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(-15,0); ctx.lineTo(13,0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(13,0);ctx.lineTo(5,-5);ctx.lineTo(5,5);ctx.closePath();ctx.fill(); }
    else if (p.classId === "blade") { ctx.lineWidth=6;ctx.beginPath();ctx.arc(0,0,12,-1.1,1.1);ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(0,0,p.r,0,TAU); ctx.fill(); ctx.strokeStyle="#e9feff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,p.r+4,0,TAU);ctx.stroke(); }
    ctx.restore();
  }
  for (const p of game.particles) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * (p.dust ? .55 : 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.r * (p.dust ? 1 + (1-p.life/p.max)*.9 : 1),0,TAU); ctx.fill(); } ctx.globalAlpha = 1;
}

function drawMinimap() {
  const compactLandscape = canvas.clientHeight <= 520 && canvas.clientWidth > canvas.clientHeight;
  const w = compactLandscape ? 122 : 145; const h = compactLandscape ? 76 : 92;
  const x = W - w - 25; const y = compactLandscape ? 72 : 18;
  ctx.fillStyle = "rgba(2,13,7,.68)"; ctx.fillRect(x,y,w,h); ctx.strokeStyle = "rgba(215,255,205,.55)"; ctx.lineWidth = 2; ctx.strokeRect(x,y,w,h);
  for (const ob of obstacles) { ctx.fillStyle = "rgba(173,205,153,.35)"; ctx.fillRect(x + ob.x / W * w - 2, y + ob.y / H * h - 2, 4, 4); }
  for (const a of game.actors) { if (!a.alive) continue; ctx.fillStyle = a.team ? "#ff5e70" : "#50c8ff"; ctx.beginPath(); ctx.arc(x+a.x/W*w,y+a.y/H*h,a.isPlayer?4:2.5,0,TAU); ctx.fill(); }
}

function draw(time) {
  ctx.save();
  if (game.shake > 0) ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));
  // 세로형 화면에서는 16:9 월드가 좌우로 잘리므로 플레이어를 따라가는 카메라를 쓴다.
  const portraitCrop = canvas.clientHeight > 0 && canvas.clientWidth / canvas.clientHeight < 1.15;
  if (portraitCrop && game.player?.alive) {
    const visibleWorldWidth = clamp(H * canvas.clientWidth / canvas.clientHeight, 300, W);
    const cameraCenter = clamp(game.player.x, visibleWorldWidth / 2, W - visibleWorldWidth / 2);
    ctx.translate(W / 2 - cameraCenter, 0);
  }
  drawGround();
  for (const ob of obstacles) drawObstacle(ob);
  const sorted = [...game.actors].sort((a,b) => a.y - b.y);
  for (const actor of sorted) drawActorSprite(actor, time);
  drawEffects();
  ctx.restore();
  drawMinimap();
  if (game.mode === "paused") { ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(0,0,W,H); ctx.fillStyle = "white"; ctx.font = "900 52px sans-serif"; ctx.textAlign = "center"; ctx.fillText("PAUSED", W/2,H/2); }
}

function loop(now) {
  const dt = Math.min(.033, (now - lastTime) / 1000); lastTime = now;
  update(dt); draw(now / 1000); requestAnimationFrame(loop);
}

document.querySelectorAll(".mode-option").forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.mode === selectedMode) return;
  if (net.waiting) sendNetwork({ type: "cancel" });
  selectedMode = button.dataset.mode;
  document.querySelectorAll(".mode-option").forEach((item) => { item.classList.toggle("selected", item === button); item.setAttribute("aria-checked", String(item === button)); });
  updateModeUi();
  tone(330, .05, "triangle", .02);
}));

function updateModeUi() {
  const labels = { duel: "1 VS 1 · AI PRACTICE", team: "4 VS 4 · TEAM DEATHMATCH", random: "1 VS 1 · RANDOM MATCH", invite: "1 VS 1 · INVITE MATCH" };
  ui.modeEyebrow.textContent = labels[selectedMode];
  ui.opponentPicker.hidden = selectedMode !== "duel";
  ui.matchmakingPanel.hidden = !["random", "invite"].includes(selectedMode);
  ui.inviteControls.hidden = selectedMode !== "invite";
  if (selectedMode === "invite" && !ui.inviteCode.value && net.lastInviteCode) ui.inviteCode.value = net.lastInviteCode;
  ui.cancelMatchButton.hidden = !net.waiting;
  const main = ui.startButton.querySelector("span"); const sub = ui.startButton.querySelector("small");
  if (selectedMode === "random") { main.textContent = "랜덤 매칭 시작"; sub.textContent = "상대가 접속하면 자동 시작"; }
  else if (selectedMode === "invite" && net.waiting) {
    if (net.lobbyRole === "host" && net.peerConnected) { main.textContent = "전투 시작"; sub.textContent = "방장 권한으로 시작"; ui.startButton.disabled = false; }
    else if (net.lobbyRole === "host") { main.textContent = "상대 기다리는 중"; sub.textContent = "입장하면 시작할 수 있습니다"; ui.startButton.disabled = true; }
    else { main.textContent = "방장 시작 대기"; sub.textContent = "방장이 시작하면 자동 입장"; ui.startButton.disabled = true; }
  }
  else if (selectedMode === "invite") { main.textContent = "초대방 만들기"; sub.textContent = "코드를 친구에게 전달"; ui.startButton.disabled = false; }
  else { main.textContent = "전투 시작"; sub.textContent = "클릭 또는 ENTER"; }
  if (selectedMode !== "invite") ui.startButton.disabled = false;
  if (["random", "invite"].includes(selectedMode) && !net.waiting) setMatchStatus(net.connected ? "온라인 서버 연결됨" : "온라인 서버에 연결 중입니다…");
  updateRoomDisplay(net.waiting ? "상대 접속 대기" : "", net.roomCode, selectedMode === "invite" && Boolean(net.roomCode));
}

document.querySelectorAll(".fighter").forEach((button) => button.addEventListener("click", () => {
  selectedClass = button.dataset.class;
  document.querySelectorAll(".fighter").forEach((item) => { item.classList.toggle("selected", item === button); item.setAttribute("aria-checked", String(item === button)); });
  tone(390, .05, "triangle", .025);
  if (net.roomCode) sendNetwork({ type: "update_profile", classId: selectedClass, nickname: currentNickname() });
}));
document.querySelectorAll(".opponent-option").forEach((button) => button.addEventListener("click", () => {
  selectedOpponentClass = button.dataset.opponentClass;
  document.querySelectorAll(".opponent-option").forEach((item) => item.classList.toggle("selected", item === button));
  tone(350, .05, "triangle", .02);
}));

function startSelectedMode() {
  const nickname = currentNickname();
  if (selectedMode === "duel" || selectedMode === "team") { startMatch(); return; }
  if (!net.connected) { connectNetwork(); setMatchStatus("온라인 서버에 다시 연결 중입니다…", true); return; }
  if (selectedMode === "invite" && net.waiting) {
    if (net.lobbyRole === "host" && net.peerConnected) { sendNetwork({ type: "start_invite" }); setMatchStatus("전투를 시작하는 중…"); }
    return;
  }
  if (net.waiting) return;
  if (selectedMode === "random") sendNetwork({ type: "queue_random", classId: selectedClass, nickname });
  else sendNetwork({ type: "create_invite", classId: selectedClass, nickname });
  net.waiting = true; ui.cancelMatchButton.hidden = false; setMatchStatus(selectedMode === "random" ? "상대를 찾는 중…" : "초대 코드를 만드는 중…");
}

ui.startButton.addEventListener("click", startSelectedMode);
ui.restartButton.addEventListener("click", () => {
  if (game.networkRole) sendNetwork({ type: "rematch" });
  else startMatch();
});
ui.joinInviteButton.addEventListener("click", () => {
  const roomCode = ui.inviteCode.value.trim().toUpperCase();
  if (roomCode.length !== 6) { setMatchStatus("초대 코드 6자리를 입력하세요.", true); return; }
  if (!net.connected) { connectNetwork(); setMatchStatus("온라인 서버에 연결 중입니다…", true); return; }
  sendNetwork({ type: "join_invite", roomCode, classId: selectedClass, nickname: currentNickname() }); net.waiting = true; ui.cancelMatchButton.hidden = false; rememberInviteCode(roomCode); updateRoomDisplay("방 연결 중", roomCode, true); setMatchStatus(`${roomCode} 방에 참가하는 중…`);
});
ui.inviteCode.addEventListener("input", () => { ui.inviteCode.value = ui.inviteCode.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6); });
ui.nicknameInput.addEventListener("change", () => {
  const nickname = currentNickname();
  if (net.roomCode) sendNetwork({ type: "update_profile", classId: selectedClass, nickname });
});
ui.cancelMatchButton.addEventListener("click", () => sendNetwork({ type: "cancel" }));
ui.homeButton.addEventListener("click", goHome);
ui.resultHomeButton.addEventListener("click", goHome);
ui.pauseHomeButton.addEventListener("click", goHome);
ui.landscapeButton.addEventListener("click", toggleLandscape);
ui.helpButton.addEventListener("click", () => ui.helpDialog.showModal());
function openPauseMenu() {
  if (!["playing", "paused"].includes(game.mode)) return;
  input.keys.clear(); input.moveX = 0; input.moveY = 0; input.guardTouch = false;
  if (game.networkRole) {
    ui.pauseTitle.textContent = "온라인 경기 메뉴";
    ui.pauseMessage.textContent = "온라인 경기는 계속 진행됩니다. 홈으로 나가면 상대가 남은 초대방은 유지됩니다.";
  } else {
    game.mode = "paused"; ui.pauseTitle.textContent = "일시정지"; ui.pauseMessage.textContent = "전투가 멈췄습니다.";
  }
  ui.pauseScreen.hidden = false; ui.pauseButton.textContent = "계속하기";
}
function closePauseMenu() {
  ui.pauseScreen.hidden = true;
  if (game.mode === "paused") game.mode = "playing";
  ui.pauseButton.textContent = game.networkRole ? "경기 메뉴" : "일시정지"; lastTime = performance.now();
}
ui.pauseButton.addEventListener("click", () => { if (ui.pauseScreen.hidden) openPauseMenu(); else closePauseMenu(); });
ui.resumeButton.addEventListener("click", closePauseMenu);
ui.soundButton.addEventListener("click", () => { audioEnabled = !audioEnabled; ui.soundButton.textContent = `소리 ${audioEnabled ? "ON" : "OFF"}`; ui.soundButton.setAttribute("aria-pressed", String(audioEnabled)); if (audioEnabled) tone(500); });

window.addEventListener("keydown", (event) => {
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(event.code)) event.preventDefault();
  input.keys.add(event.code);
  if (event.repeat) return;
  if (game.mode === "select" && event.code === "Enter") startSelectedMode();
  else if (game.mode === "over" && event.code === "Enter") ui.restartButton.click();
  else if (game.mode === "playing" && event.code === "KeyJ") performLocalAction("melee");
  else if (game.mode === "playing" && event.code === "KeyK") performLocalAction("range");
  else if (game.mode === "playing" && event.code === "KeyL") performLocalAction("magic");
  else if (event.code === "Escape" && (["playing", "paused"].includes(game.mode) || !ui.pauseScreen.hidden)) ui.pauseButton.click();
});
window.addEventListener("keyup", (event) => input.keys.delete(event.code));
window.addEventListener("blur", () => { input.keys.clear(); input.guardTouch = false; if (game.mode === "playing" && !game.networkRole) ui.pauseButton.click(); });

let joyPointer = null;
function updateJoystick(event) {
  const rect = ui.joystick.getBoundingClientRect(); const cx = rect.left + rect.width/2; const cy = rect.top + rect.height/2;
  const dx = event.clientX - cx; const dy = event.clientY - cy; const len = Math.hypot(dx,dy); const max = rect.width * .32; const scale = len > max ? max/len : 1;
  input.moveX = dx / max * scale; input.moveY = dy / max * scale;
  ui.joystick.querySelector("i").style.transform = `translate(${dx*scale}px,${dy*scale}px)`;
}
ui.joystick.addEventListener("pointerdown", (event) => { joyPointer = event.pointerId; ui.joystick.setPointerCapture(event.pointerId); updateJoystick(event); });
ui.joystick.addEventListener("pointermove", (event) => { if (event.pointerId === joyPointer) updateJoystick(event); });
function resetJoystick(event) { if (event.pointerId !== joyPointer) return; joyPointer = null; input.moveX = 0; input.moveY = 0; ui.joystick.querySelector("i").style.transform = "translate(0,0)"; }
ui.joystick.addEventListener("pointerup", resetJoystick); ui.joystick.addEventListener("pointercancel", resetJoystick);

document.querySelectorAll("[data-action]").forEach((button) => {
  const action = button.dataset.action;
  const press = (event) => { event.preventDefault(); if (game.mode !== "playing") return; if (["melee", "range", "magic"].includes(action)) performLocalAction(action); if (action === "guard") input.guardTouch = true; };
  button.addEventListener("pointerdown", press);
  if (action === "guard") { button.addEventListener("pointerup", () => input.guardTouch = false); button.addEventListener("pointercancel", () => input.guardTouch = false); button.addEventListener("pointerleave", () => input.guardTouch = false); }
});

setInterval(() => {
  if (net.socket?.readyState !== WebSocket.OPEN) return;
  if (Date.now() - net.lastPong > 120_000) { net.socket.close(); return; }
  sendNetwork({ type: "ping", sentAt: Date.now() });
}, 15_000);

connectNetwork();
updateModeUi();
requestAnimationFrame(loop);
