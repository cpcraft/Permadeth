/* global PIXI */
const canvas = document.getElementById('game');
const app = new PIXI.Application();
await app.init({ canvas, resizeTo: window, antialias: true, backgroundAlpha: 0 });

const state = {
  me: null,
  constants: null,
  players: new Map(), // id -> {id,name,color,x,y}
  loot: new Map(),    // id -> {id,x,y,base_type}
  sprites: new Map(), // id -> PIXI.Graphics
  lootSprites: new Map(),
  ws: null,
  hoverPlayer: null,
  duel: null,
  pendingInvite: null,
  moveTarget: null // {x,y}
};

// World + layers
const world = new PIXI.Container();
app.stage.addChild(world);

// subtle tile grid (64px); redraws around camera
const grid = new PIXI.Graphics();
world.addChild(grid);
const GRID_STEP = 64;
let lastGridCenter = { x: -99999, y: -99999 };
function drawGridAround(cx, cy) {
  if (Math.hypot(cx - lastGridCenter.x, cy - lastGridCenter.y) < GRID_STEP / 2) return;
  lastGridCenter = { x: cx, y: cy };

  grid.clear();
  grid.alpha = 0.12; // barely visible
  grid.stroke({ width: 1 });

  const viewW = app.renderer.width;
  const viewH = app.renderer.height;
  const pad = GRID_STEP * 8;
  const x0 = Math.floor((cx - viewW/2 - pad) / GRID_STEP) * GRID_STEP;
  const x1 = Math.ceil((cx + viewW/2 + pad) / GRID_STEP) * GRID_STEP;
  const y0 = Math.floor((cy - viewH/2 - pad) / GRID_STEP) * GRID_STEP;
  const y1 = Math.ceil((cy + viewH/2 + pad) / GRID_STEP) * GRID_STEP;

  for (let x = x0; x <= x1; x += GRID_STEP) grid.moveTo(x, y0).lineTo(x, y1);
  for (let y = y0; y <= y1; y += GRID_STEP) grid.moveTo(x0, y).lineTo(x1, y);
}

// make stage clickable for point-to-move
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
app.stage.cursor = 'crosshair';
app.stage.on('pointerdown', (e) => {
  if (!state.me || !state.players.get(state.me)) return;
  const global = e.global;
  const target = { x: global.x - world.x, y: global.y - world.y };
  state.moveTarget = target;
});

function stopMovement() {
  state.moveTarget = null;
  send('MOVE_DIR', { dx: 0, dy: 0 });
}

// UI hooks
const hudEl = document.getElementById('hud');
const duelEl = document.getElementById('duel');
const chatLog = document.getElementById('log');
const chatInput = document.getElementById('chatInput');
const coordsEl = document.getElementById('coords');

const authEl = document.getElementById('auth');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginView = document.getElementById('loginView');
const registerView = document.getElementById('registerView');
const loginUser = document.getElementById('loginUser');
const loginPass = document.getElementById('loginPass');
const btnLogin = document.getElementById('btnLogin');
const regUser = document.getElementById('regUser');
const regPass = document.getElementById('regPass');
const regPass2 = document.getElementById('regPass2');
const btnRegister = document.getElementById('btnRegister');

tabLogin.onclick = () => {
  tabLogin.classList.add('active'); tabRegister.classList.remove('active');
  loginView.classList.remove('hidden'); registerView.classList.add('hidden');
};
tabRegister.onclick = () => {
  tabRegister.classList.add('active'); tabLogin.classList.remove('active');
  registerView.classList.remove('hidden'); loginView.classList.add('hidden');
};

function logChat(msg) {
  const p = document.createElement('div');
  p.textContent = msg;
  chatLog.appendChild(p);
  chatLog.scrollTop = chatLog.scrollHeight;
}

btnRegister.onclick = async () => {
  try {
    if (regPass.value !== regPass2.value) return logChat('[Auth] Passwords do not match');
    const r = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: regUser.value.trim(), password: regPass.value })
    });
    const data = await r.json();
    if (!r.ok) return logChat('[Auth] ' + (data.error || 'Registration failed'));
    localStorage.setItem('pd_token', data.token);
    logChat('[Auth] Registration OK. Connecting...');
    connect();
  } catch (e) { logChat('[Auth] Registration error'); }
};

btnLogin.onclick = async () => {
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUser.value.trim(), password: loginPass.value })
    });
    const data = await r.json();
    if (!r.ok) return logChat('[Auth] ' + (data.error || 'Login failed'));
    localStorage.setItem('pd_token', data.token);
    logChat('[Auth] Login OK. Connecting...');
    connect();
  } catch (e) { logChat('[Auth] Login error'); }
};

// Enter submits
[loginUser, loginPass].forEach(el => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnLogin.click();
}));
[regUser, regPass, regPass2].forEach(el => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnRegister.click();
}));

// NOTE: auto-login removed. Player is not spawned until user authenticates.

function connect() {
  if (state.ws && (state.ws.readyState === 0 || state.ws.readyState === 1)) return;
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  const ws = new WebSocket(url);
  state.ws = ws;

  ws.onopen = () => {
    const token = localStorage.getItem('pd_token');
    ws.send(JSON.stringify({ op: 'JOIN', d: { token } }));
  };

  ws.onmessage = (ev) => {
    const { t, d } = JSON.parse(ev.data);
    switch (t) {
      case 'WELCOME':
        state.me = d.id;
        state.constants = d.constants;
        authEl.classList.add('hidden');     // hide modal only after connected
        hudEl.classList.remove('hidden');   // show minimal HUD
        centerCameraNow();
        break;

      case 'WORLD_SNAPSHOT':
        state.players.clear();
        state.loot.clear();
        d.players.forEach(p => state.players.set(p.id, p));
        d.loot.forEach(l => state.loot.set(l.id, l));
        rebuildSprites();
        centerCameraNow();
        break;

      case 'PLAYER_JOINED': {
        state.players.set(d.id, d);
        ensurePlayerSprite(d);
        break;
      }

      case 'PLAYER_MOVES':
        d.forEach(({ id, x, y }) => {
          const p = state.players.get(id);
          if (p) {
            p.x = x; p.y = y;
            const g = state.sprites.get(id);
            if (g) { g.x = x; g.y = y; }
          }
        });
        break;

      case 'PLAYER_LEFT': {
        state.players.delete(d.id);
        const s = state.sprites.get(d.id);
        if (s) { world.removeChild(s); state.sprites.delete(d.id); }
        break;
      }

      case 'CHAT':
        logChat(`${d.from.name}: ${d.msg}`);
        break;

      case 'LOOT_REMOVE': {
        state.loot.delete(d.id);
        const s = state.lootSprites.get(d.id);
        if (s) { world.removeChild(s); state.lootSprites.delete(d.id); }
        break;
      }

      case 'INV_ADD':
        logChat(`[Loot] You acquired ${d.item.base_type} (${d.item.uid})`);
        break;

      case 'DUEL_INVITE':
        logChat(`[Duel] Invitation from ${d.fromPlayerId}. Hover them & press F to accept.`);
        state.pendingInvite = d;
        break;

      case 'DUEL_START':
        state.duel = { duelId: d.duelId, hp: d.hp, turn: d.turn, lastAction: null, p1: d.p1, p2: d.p2 };
        renderDuel();
        break;

      case 'DUEL_UPDATE':
        if (state.duel && state.duel.duelId === d.duelId) {
          state.duel.hp = d.hp;
          state.duel.turn = d.turn;
          state.duel.lastAction = d.lastAction;
          renderDuel();
        }
        break;

      case 'DUEL_END':
        if (state.duel && state.duel.duelId === d.duelId) {
          const win = d.winner === state.me ? 'You won!' : (d.winner ? `${d.winner} won` : 'Duel ended');
          logChat(`[Duel] ${win}`);
          state.duel = null;
          duelEl.classList.add('hidden');
        }
        break;

      case 'ERROR':
        logChat(`[Error] ${d.message}`);
        break;
    }
  };

  ws.onerror = () => logChat('[WS] error — check server is running on :3000');
  ws.onclose = () => logChat('[WS] closed');
}

function rebuildSprites() {
  for (const s of state.sprites.values()) world.removeChild(s);
  state.sprites.clear();
  for (const s of state.lootSprites.values()) world.removeChild(s);
  state.lootSprites.clear();

  for (const p of state.players.values()) ensurePlayerSprite(p);
  for (const l of state.loot.values()) ensureLootSprite(l);
}

function ensurePlayerSprite(p) {
  if (state.sprites.has(p.id)) return;
  const g = new PIXI.Graphics();
  g.x = p.x; g.y = p.y;
  g.circle(0, 0, 16).fill(p.color || '#2dd4bf').stroke({ width: 2, color: 0x000000, alpha: 0.4 });
  g.eventMode = 'static';
  g.cursor = 'pointer';
  g.on('pointerover', () => { state.hoverPlayer = p.id; });
  g.on('pointerout', () => { if (state.hoverPlayer === p.id) state.hoverPlayer = null; });
  world.addChild(g);
  state.sprites.set(p.id, g);
}

function ensureLootSprite(l) {
  if (state.lootSprites.has(l.id)) return;
  const g = new PIXI.Graphics();
  g.x = l.x; g.y = l.y;
  g.rect(-10, -10, 20, 20).fill('#ffe08a').stroke({ width: 2, color: 0x000000, alpha: 0.25 });
  world.addChild(g);
  state.lootSprites.set(l.id, g);
}

function send(op, d = {}) {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ op, d }));
  }
}

/* ---------------- MOVEMENT: CLICK TO MOVE ---------------- */
setInterval(() => {
  const me = state.me && state.players.get(state.me);
  if (!me) return;

  if (!state.moveTarget) return;

  const dx = state.moveTarget.x - me.x;
  const dy = state.moveTarget.y - me.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 8) { stopMovement(); return; }

  const ndx = dx / dist;
  const ndy = dy / dist;
  send('MOVE_DIR', { dx: ndx, dy: ndy });
}, 50);

// Duel hotkeys (strike/block/heal/run)
window.addEventListener('keydown', (e) => {
  if (!state.duel) return;
  if (e.key === '1') send('DUEL_ACTION', { duelId: state.duel.duelId, action: 'strike' });
  if (e.key === '2') send('DUEL_ACTION', { duelId: state.duel.duelId, action: 'block' });
  if (e.key === '3') send('DUEL_ACTION', { duelId: state.duel.duelId, action: 'heal' });
  if (e.key.toLowerCase() === 'r') send('DUEL_ACTION', { duelId: state.duel.duelId, action: 'flee' });
});

// Chat
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (text) send('CHAT_SEND', { msg: text });
    chatInput.value = '';
    chatInput.blur();
  }
});

/* ---------- CAMERA + COORDS ---------- */
function centerCameraNow() {
  const me = state.me && state.players.get(state.me);
  if (!me) return;
  world.x = (app.renderer.width / 2) - me.x;
  world.y = (app.renderer.height / 2) - me.y;
  drawGridAround(me.x, me.y);
  updateCoords(me);
}

function updateCoords(me) {
  if (!state.constants || !me) return;
  const tileSize = state.constants.TILE_SIZE || 64;
  const tx = Math.floor(me.x / tileSize);
  const ty = Math.floor(me.y / tileSize);
  coordsEl.textContent = `x:${tx}  y:${ty}`;
}

app.ticker.add(() => {
  centerCameraNow();
});

window.addEventListener('resize', () => centerCameraNow());
