/* global PIXI */
const canvas = document.getElementById('game');
const app = new PIXI.Application();
await app.init({ canvas, resizeTo: window, antialias: true, backgroundAlpha: 0 });

const state = {
  me: null,
  constants: null,
  players: new Map(),
  sprites: new Map(),
  ws: null,
  moveTarget: null,
  engaged: false,
};

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function connect() {
  const ws = new WebSocket(wsUrl());
  state.ws = ws;
  ws.onopen = () => {
    const name = localStorage.getItem('pd_name') || prompt('Pick a name (max 16):') || 'anon';
    localStorage.setItem('pd_name', name.slice(0, 16));
    ws.send(JSON.stringify({ op: 'JOIN', data: { name: localStorage.getItem('pd_name'), color: '#4cc9f0' } }));
  };
  ws.onmessage = (ev) => {
    const { op, data } = JSON.parse(ev.data);
    if (op === 'WELCOME') {
      state.me = data.id;
      state.constants = data.snapshot.constants;
      applySnapshot(data.snapshot);
    }
    if (op === 'PLAYERS') applySnapshot(data);
    if (op === 'CHAT') log(`[${data.from}] ${data.text}`);
  };
  ws.onclose = () => { setTimeout(connect, 1000); };
}
connect();

// Scene
const grid = new PIXI.Graphics();
app.stage.addChild(grid);
const playerLayer = new PIXI.Container();
app.stage.addChild(playerLayer);

const tagLayer = document.createElement('div');
tagLayer.style.position = 'fixed';
tagLayer.style.inset = '0';
tagLayer.style.pointerEvents = 'none';
document.body.appendChild(tagLayer);

function drawGrid(cx, cy) {
  if (!state.constants) return;
  const step = state.constants.TILE_SIZE;
  grid.clear();
  grid.lineStyle(1, 0x334155, 0.5);
  const viewW = app.renderer.width, viewH = app.renderer.height, pad = step * 8;
  const x0 = Math.floor((cx - viewW/2 - pad) / step) * step;
  const x1 = Math.ceil((cx + viewW/2 + pad) / step) * step;
  const y0 = Math.floor((cy - viewH/2 - pad) / step) * step;
  const y1 = Math.ceil((cy + viewH/2 + pad) / step) * step;
  for (let x = x0; x <= x1; x += step) grid.moveTo(x, y0).lineTo(x, y1);
  for (let y = y0; y <= y1; y += step) grid.moveTo(x0, y).lineTo(x1, y);
}

function applySnapshot(snap) {
  state.constants = snap.constants || state.constants;
  // players
  const seen = new Set();
  for (const p of snap.players) {
    seen.add(p.id);
    let sprite = state.sprites.get(p.id);
    if (!sprite) {
      const g = new PIXI.Graphics();
      g.circle(0, 0, 16).fill(0x4cc9f0);
      playerLayer.addChild(g);
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = `${p.name}`;
      tagLayer.appendChild(tag);
      sprite = { g, tag, visX: p.x, visY: p.y };
      state.sprites.set(p.id, sprite);
      g.eventMode = 'none';
    }
    sprite.targetColor = p.id === state.me ? 0x22c55e : 0x4cc9f0;
    sprite.g.tint = sprite.targetColor;
    sprite.x = p.x; sprite.y = p.y;
    sprite.engageWith = p.engageWith || null;
  }
  // remove old
  for (const [id, s] of state.sprites) if (!seen.has(id)) {
    s.g.destroy(); s.tag.remove(); state.sprites.delete(id);
  }
  updateHud();
}

function updateHud() {
  const coordsEl = document.getElementById('coords');
  const playersList = document.getElementById('playersList');
  const meSprite = state.sprites.get(state.me);
  if (meSprite) coordsEl.textContent = `You: (${Math.round(meSprite.x)}, ${Math.round(meSprite.y)})`;
  let txt = '';
  for (const [id, s] of state.sprites) {
    const meMark = id === state.me ? '*' : ' ';
    txt += `${meMark} ${id}: (${Math.round(s.x)}, ${Math.round(s.y)})\n`;
  }
  playersList.textContent = txt.trim();
}

function worldToScreen(x, y) {
  return { x: x - app.renderer.width/2, y: y - app.renderer.height/2 };
}

function layout() {
  const mine = state.sprites.get(state.me);
  const cx = mine ? mine.x : app.renderer.width/2;
  const cy = mine ? mine.y : app.renderer.height/2;
  drawGrid(cx, cy);
  for (const s of state.sprites.values()) {
    s.g.position.set(
      s.x - cx + app.renderer.width/2,
      s.y - cy + app.renderer.height/2
    );
    const rx = s.g.position.x, ry = s.g.position.y;
    s.tag.style.left = `${rx}px`;
    s.tag.style.top  = `${ry}px`;
  }
}
app.ticker.add(() => layout());

// Click to move
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
app.stage.cursor = 'crosshair';
app.stage.on('pointerdown', (e) => {
  const me = state.sprites.get(state.me);
  if (!me) return;
  const cx = me.x - app.renderer.width/2;
  const cy = me.y - app.renderer.height/2;
  const targetX = cx + e.global.x;
  const targetY = cy + e.global.y;
  state.ws?.send(JSON.stringify({ op: 'MOVE_TARGET', data: { x: targetX, y: targetY } }));
});

// Chat
const chatInput = document.getElementById('chatInput');
const chatLog = document.getElementById('log');
function log(t) { const d=document.createElement('div'); d.textContent=t; chatLog.appendChild(d); chatLog.scrollTop=chatLog.scrollHeight; }
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = chatInput.value.trim();
    if (v) state.ws?.send(JSON.stringify({ op: 'CHAT_SEND', data: { text: v } }));
    chatInput.value = '';
  }
});

// Duel overlay
const overlay = document.getElementById('engageModal');
const btnLeave = document.getElementById('btnLeave');
btnLeave.onclick = () => state.ws?.send(JSON.stringify({ op: 'ENGAGE_LEAVE' }));

setInterval(() => {
  const me = state.sprites.get(state.me);
  const engagedWith = me?.engageWith || null;
  overlay.classList.toggle('hidden', !engagedWith);
}, 100);
