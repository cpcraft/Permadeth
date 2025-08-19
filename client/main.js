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
  lastDir: { x: 0, y: 0 },
  keys: new Set(),
  hoverPlayer: null,
  duel: null,          // {duelId, hp:{}, turn, lastAction}
  pendingInvite: null
};

// World + layers
const world = new PIXI.Container();
app.stage.addChild(world);

// subtle grid background (helps orientation)
const grid = new PIXI.Graphics();
world.addChild(grid);
function drawGrid() {
  grid.clear();
  const step = 200;
  const size = 8000; // draw a chunk around the camera
  grid.alpha = 0.15;
  grid.stroke({ width: 1 });
  for (let x = -size; x <= size; x += step) {
    grid.moveTo(x, -size).lineTo(x, size);
  }
  for (let y = -size; y <= size; y += step) {
    grid.moveTo(-size, y).lineTo(size, y);
  }
}
drawGrid();

// UI hooks
const joinEl = document.getElementById('join');
const btnJoin = document.getElementById('btnJoin');
const nameEl = document.getElementById('name');
const colorEl = document.getElementById('color');
const hudEl = document.getElementById('hud');
const youEl = document.getElementById('you');
const duelEl = document.getElementById('duel');
const chatLog = document.getElementById('log');
const chatInput = document.getElementById('chatInput');

function logChat(msg) {
  const p = document.createElement('div');
  p.textContent = msg;
  chatLog.appendChild(p);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function connect() {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  const ws = new WebSocket(url);
  state.ws = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({ op: 'JOIN', d: { name: nameEl.value || 'Player', color: colorEl.value || '#2dd4bf' } }));
  };

  ws.onmessage = (ev) => {
    const { t, d } = JSON.parse(ev.data);
    switch (t) {
      case 'WELCOME':
        state.me = d.id;
        state.constants = d.constants;
        youEl.textContent = `You: ${state.me}`;
        joinEl.classList.add('hidden');
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
            const g = state.sprites.get(id);
            if (g) { g.x = x; g.y = y; }
          }
        });
        break;

      case 'PLAYER_LEFT': {
        state.players.delete(d.id);
        const g = state.sprites.get(d.id);
        if (g) { world.removeChild(g); state.sprites.delete(d.id); }
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
        state.pendingInvite = d; // {fromPlayerId, duelId}
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
  for (const s of state.sprites.values()) world.removeChild(s);
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

btnJoin.addEventListener('click', () => {
  connect();
});

function renderDuel() {
  if (!state.duel) { duelEl.classList.add('hidden'); return; }
  const { hp, turn, p1, p2 } = state.duel;
  duelEl.classList.remove('hidden');
  duelEl.innerHTML = `
    <div><span class="badge">Duel</span> Turn: ${turn === state.me ? 'You' : turn}</div>
    <div>HP ${p1}: ${hp[p1] ?? 0}</div>
    <div>HP ${p2}: ${hp[p2] ?? 0}</div>
    <div>Actions: [1] Strike [2] Block [3] Heal</div>
  `;
}

/* ---------- CAMERA FOLLOW ---------- */
function centerCameraNow() {
  const me = state.me && state.players.get(state.me);
  if (!me) return;
  world.x = (app.renderer.width / 2) - me.x;
  world.y = (app.renderer.height / 2) - me.y;
}

// update camera every frame
app.ticker.add(() => {
  centerCameraNow();
});

// keep grid roughly centered chunk
window.addEventListener('resize', () => {
  drawGrid();
  centerCameraNow();
});
