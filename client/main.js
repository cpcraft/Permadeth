/* global PIXI */
const canvas = document.getElementById('game');
const app = new PIXI.Application();
await app.init({ canvas, resizeTo: window, antialias: true, backgroundAlpha: 0 });

const state = {
  me: null,
  constants: null,
  players: new Map(), // id -> {id,name,color,x,y}
  loot: new Map(),    // id -> {id,x,y,base_type}
  sprites: new Map(), // id -> {g,label}
  lootSprites: new Map(),
  ws: null,
  lastDir: { x: 0, y: 0 },
  keys: new Set(),
  hoverPlayer: null,
  duel: null,
  pendingInvite: null,
  showTiles: false
};

// World + layers
const world = new PIXI.Container();
app.stage.addChild(world);

// dynamic grid around camera
const grid = new PIXI.Graphics();
world.addChild(grid);
const GRID_STEP = 64; // tile size
let lastGridCenter = { x: -99999, y: -99999 };
function drawGridAround(cx, cy) {
  // redraw only if camera moved > half tile
  if (Math.hypot(cx - lastGridCenter.x, cy - lastGridCenter.y) < GRID_STEP / 2) return;
  lastGridCenter = { x: cx, y: cy };

  grid.clear();
  grid.alpha = 0.15;
  grid.stroke({ width: 1 });

  const viewW = app.renderer.width;
  const viewH = app.renderer.height;
  const pad = GRID_STEP * 10;
  const x0 = Math.floor((cx - viewW/2 - pad) / GRID_STEP) * GRID_STEP;
  const x1 = Math.ceil((cx + viewW/2 + pad) / GRID_STEP) * GRID_STEP;
  const y0 = Math.floor((cy - viewH/2 - pad) / GRID_STEP) * GRID_STEP;
  const y1 = Math.ceil((cy + viewH/2 + pad) / GRID_STEP) * GRID_STEP;

  for (let x = x0; x <= x1; x += GRID_STEP) grid.moveTo(x, y0).lineTo(x, y1);
  for (let y = y0; y <= y1; y += GRID_STEP) grid.moveTo(x0, y).lineTo(x1, y);
}

// UI hooks
const hudEl = document.getElementById('hud');
const youEl = document.getElementById('you');
const duelEl = document.getElementById('duel');
const chatLog = document.getElementById('log');
const chatInput = document.getElementById('chatInput');
const btnCoords = document.getElementById('btnCoords');

// auth elements
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

// auto-login if token exists
const existingToken = localStorage.getItem('pd_token');
if (existingToken) connect();

function logChat(msg) {
  const p = document.createElement('div');
  p.textContent = msg;
  chatLog.appendChild(p);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function connect() {
  if (state.ws && state.ws.readyState === 1) return;
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
        youEl.textContent = `You: ${state.me}`;
        authEl.classList.add('hidden');
        hudEl.classList.remove('hidden');
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

      case 'PLAYER_JOINED':
        state.players.set(d.id, d);
        ensurePlayerSprite(d);
        break;

      case 'PLAYER_MOVES':
        d.forEach(({ id, x, y }) => {
          const p = state.players.get(id);
          if (p) {
            p.x = x; p.y = y;
            const s = state.sprites.get(id);
            if (s) { s.g.x = x; s.g.y = y; s.label.x = x; s.label.y = y - 26; }
          }
        });
        break;

      case 'PLAYER_LEFT': {
        state.players.delete(d.id);
        const s = state.sprites.get(d.id);
        if (s) { world.removeChild(s.g); world.removeChild(s.label); state.sprites.delete(d.id); }
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
          const win = d.winner === state.me ? 'You won!' : (d.winner ? `${d.winner} won` : 'Ended');
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
}

function rebuildSprites() {
  // Clear all
  for (const s of state.sprites.values()) { world.removeChild(s.g); world.removeChild(s.label); }
  state.sprites.clear();
  for (const s of state.lootSprites.values()) world.removeChild(s);
  state.lootSprites.clear();

  // Players
  for (const p of state.players.values()) ensurePlayerSprite(p);
  // Loot
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

  const label = new PIXI.Text({ text: '', style: { fontFamily: 'monospace', fontSize: 12, fill: 0xffffff, align: 'center' } });
  label.x = p.x; label.y = p.y - 26;
  label.anchor.set(0.5);
  label.visible = state.showTiles;
  world.addChild(label);

  state.sprites.set(p.id, { g, label });
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

// Movement & input
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement !== chatInput) {
    chatInput.focus();
    return;
  }
  state.keys.add(e.key.toLowerCase());

  // Duel actions
  if (state.duel) {
    if (e.key === '1') send('DUEL_ACTION', { duelId: state.duel.duelId, action: 'strike' });
    if (e.key === '2') send('DUEL_ACTION', { duelId: state.duel.duelId, action: 'block' });
    if (e.key === '3') send('DUEL_ACTION', { duelId: state.duel.duelId, action: 'heal' });
  }

  if (e.key.toLowerCase() === 'f') {
    if (state.pendingInvite && state.hoverPlayer === state.pendingInvite.fromPlayerId) {
      send('DUEL_ACCEPT', { duelId: state.pendingInvite.duelId });
      state.pendingInvite = null;
      return;
    }
    if (state.hoverPlayer && state.hoverPlayer !== state.me) {
      send('DUEL_REQUEST', { targetId: state.hoverPlayer });
    }
  }
});

window.addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()));

// movement throttle to server
setInterval(() => {
  const dir = { x: 0, y: 0 };
  if (state.keys.has('w')) dir.y -= 1;
  if (state.keys.has('s')) dir.y += 1;
  if (state.keys.has('a')) dir.x -= 1;
  if (state.keys.has('d')) dir.x += 1;

  if (dir.x !== state.lastDir.x || dir.y !== state.lastDir.y) {
    state.lastDir = dir;
    send('MOVE_DIR', dir);
  }
}, 50);

// Chat
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (text) send('CHAT_SEND', { msg: text });
    chatInput.value = '';
    chatInput.blur();
  }
});

// tiles/coords toggle
btnCoords.onclick = () => {
  state.showTiles = !state.showTiles;
  for (const s of state.sprites.values()) s.label.visible = state.showTiles;
  updateAllLabels();
};

/* ---------- CAMERA FOLLOW ---------- */
function centerCameraNow() {
  const me = state.me && state.players.get(state.me);
  if (!me) return;
  world.x = (app.renderer.width / 2) - me.x;
  world.y = (app.renderer.height / 2) - me.y;
  drawGridAround(me.x, me.y);
  if (state.showTiles) updateAllLabels();
}

function updateAllLabels() {
  if (!state.constants) return;
  const tileSize = state.constants.TILE_SIZE || 64;
  for (const p of state.players.values()) {
    const s = state.sprites.get(p.id);
    if (!s) continue;
    const tx = Math.floor(p.x / tileSize);
    const ty = Math.floor(p.y / tileSize);
    s.label.text = `${tx};${ty}`;
  }
}

// update camera every frame
app.ticker.add(() => {
  centerCameraNow();
});

window.addEventListener('resize', () => {
  centerCameraNow();
});
