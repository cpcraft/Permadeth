// client/src/main.js
import * as PIXI from 'pixi.js';
import { SnapshotBuffer } from './net/interpolator.js';
import { LocalPredictor } from './net/localPrediction.js';

<<<<<<< HEAD
// ==== SETUP PIXI ====
const app = new PIXI.Application({
  width: 1280,
  height: 720,
  antialias: true,
  backgroundColor: 0x0f0f12
});
document.getElementById('game').appendChild(app.view);
=======
/* ==============================
   STATE
============================== */
const state = {
  me: null,
  constants: null,
  players: new Map(),
  sprites: new Map(),
  ws: null,
  moveTarget: null,
  engaged: false,
};
>>>>>>> parent of e776a63 (a)

<<<<<<< HEAD
// Ensure ticker is not capped at 20/30fps
app.ticker.maxFPS = 0; // use rAF (uncapped; sync to display)
app.ticker.minFPS = 0;

// World containers
const world = new PIXI.Container();
app.stage.addChild(world);

// Layers: ground (tilemap) -> grid -> indicators -> entities
const groundLayer = new PIXI.Container();
world.addChild(groundLayer);

const grid = new PIXI.Graphics();
world.addChild(grid);

// Arrow indicator layer (above grid, under entities)
const indicatorLayer = new PIXI.Container();
world.addChild(indicatorLayer);

// 64px grid (same as server’s TILE_SIZE)
const GRID_STEP = 64;
let lastGridCenter = { x: -99999, y: -99999 };
function drawGridAround(cx, cy) {
  if (Math.hypot(cx - lastGridCenter.x, cy - lastGridCenter.y) < GRID_STEP / 2) return;
  lastGridCenter = { x: cx, y: cy };
  grid.clear(); grid.alpha = 0.12; grid.stroke({ width: 1 });
>>>>>>> parent of e776a63 (a)

// ===== INPUT: click-to-move =====
app.view.addEventListener('mousedown', (e) => {
  if (!myId) return;
  const rect = app.view.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  // convert screen to world coords (no camera smoothing, so it's stable)
  const worldX = screenX + camera.x;
  const worldY = screenY + camera.y;

<<<<<<< HEAD
  // Send to server: MOVE_TO (with a running client seq)
  nextSeq++;
  const cmd = { op: 'MOVE_TO', x: worldX, y: worldY, seq: nextSeq };
  socket.send(JSON.stringify(cmd));

  // local prediction queue
  predictor.queueMove(nextSeq, worldX, worldY);
});

// ===== SERVER MESSAGES =====
let nextSeq = 0;
socket.addEventListener('message', (ev) => {
  let msg;
  try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)); }
  catch { return; }

  if (msg.op === 'WELCOME') {
    myId = msg.id;
    predictor.playerId = myId;
    return;
=======
/* ==============================
   CLICK-TO-MOVE
============================== */
=======
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
>>>>>>> parent of c1c4bd7 (Revert "a")
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
<<<<<<< HEAD
function stopMovement() { state.moveTarget = null; send('MOVE_DIR', { dx: 0, dy: 0 }); }

/* ==============================
   UI REFS
============================== */
const chatLog = document.getElementById('log');
const chatInput = document.getElementById('chatInput');
const coordsEl = document.getElementById('coords');
const playersList = document.getElementById('playersList');
const engageModal = document.getElementById('engageModal');
const btnLeave = document.getElementById('btnLeave');
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

tabLogin.onclick = () => { tabLogin.classList.add('active'); tabRegister.classList.remove('active'); loginView.classList.remove('hidden'); registerView.classList.add('hidden'); };
tabRegister.onclick = () => { tabRegister.classList.add('active'); tabLogin.classList.remove('active'); registerView.classList.remove('hidden'); loginView.classList.add('hidden'); };

function logChat(msg){ const p=document.createElement('div'); p.textContent=msg; chatLog.appendChild(p); chatLog.scrollTop=chatLog.scrollHeight; }

btnRegister.onclick = async () => {
  try{
    if(regPass.value!==regPass2.value) return logChat('[Auth] Passwords do not match');
    const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:regUser.value.trim(),password:regPass.value})});
    const data=await r.json(); if(!r.ok) return logChat('[Auth] '+(data.error||'Registration failed'));
    localStorage.setItem('pd_token',data.token); logChat('[Auth] Registration OK. Connecting...'); connect();
  }catch{ logChat('[Auth] Registration error'); }
};
btnLogin.onclick = async () => {
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:loginUser.value.trim(),password:loginPass.value})});
    const data=await r.json(); if(!r.ok) return logChat('[Auth] '+(data.error||'Login failed'));
    localStorage.setItem('pd_token',data.token); logChat('[Auth] Login OK. Connecting...'); connect();
  }catch{ logChat('[Auth] Login error'); }
};
[loginUser,loginPass].forEach(el=>el.addEventListener('keydown',e=>{ if(e.key==='Enter') btnLogin.click(); }));
[regUser,regPass,regPass2].forEach(el=>el.addEventListener('keydown',e=>{ if(e.key==='Enter') btnRegister.click(); }));

btnLeave.onclick = ()=> send('ENGAGE_LEAVE',{});

/* ==============================
   WEBSOCKET
============================== */
function connect(){
  if(state.ws && (state.ws.readyState===0 || state.ws.readyState===1)) return;
  const url=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';
  const ws=new WebSocket(url); state.ws=ws;

  ws.onopen=()=>{ const token=localStorage.getItem('pd_token'); ws.send(JSON.stringify({op:'JOIN', d:{token}})); };

  ws.onmessage=(ev)=>{
    const {t,d}=JSON.parse(ev.data);
    switch(t){
      case 'WELCOME':
        state.me=d.id; state.constants=d.constants;
        authEl.classList.add('hidden'); playersList.classList.remove('hidden');
        // Build tile renderer now that we know TILE_SIZE etc.
        tileRenderer.init({
          tileSize: state.constants?.TILE_SIZE || 64,
          worldTiles: state.constants?.WORLD_TILES || 1000
        });
        centerCameraNow();
        break;

      case 'WORLD_SNAPSHOT':
        state.players.clear(); state.loot.clear();
        d.players.forEach(p=>state.players.set(p.id,p));
        d.loot.forEach(l=>state.loot.set(l.id,l));
        rebuildSprites(); rebuildFightTags(); updatePlayersList();
        // Ensure tile chunks cover current view
        centerCameraNow();
        break;

      case 'PLAYER_JOINED': {
        state.players.set(d.id,d);
        ensurePlayerSprite(d);
        updatePlayersList();
        if (d.id === state.me) centerCameraNow();
        break;
      }

      case 'PLAYER_MOVES':
        d.forEach(({id,x,y})=>{
          const p=state.players.get(id); if(!p) return;
          const wasMe = (id===state.me);
          p.x=x; p.y=y;
          if (wasMe) centerCameraNow();
        });
        break;

      case 'PLAYER_LEFT': {
        const s=state.sprites.get(d.id); if(s?.tagEl) s.tagEl.remove();
        state.sprites.delete(d.id); state.players.delete(d.id);
        updatePlayersList(); break;
      }

      case 'ENGAGE_START': {
        if (d.with && state.me) {
          const me=state.players.get(state.me); if (me) me.engageWith=d.with;
          const other=state.players.get(d.with); if (other) other.engageWith=state.me;
          state.engaged=true; engageModal.classList.remove('hidden'); rebuildFightTags();
        } break;
      }

      case 'ENGAGE_FLAGS': {
        for (const [a,b] of d.pairs||[]) {
          const pa=state.players.get(a), pb=state.players.get(b);
          if (pa) pa.engageWith=b;
          if (pb) pb.engageWith=a;
        }
        rebuildFightTags();
        break;
      }

      case 'ENGAGE_END': {
        const me=state.players.get(state.me); if(me) me.engageWith=null;
        const other=state.players.get(d.with); if(other) other.engageWith=null;
        state.engaged=false; engageModal.classList.add('hidden'); rebuildFightTags();
        break;
      }

      case 'ENGAGE_FLAGS_CLEAR': {
        for (const id of d.ids||[]) { const p=state.players.get(id); if(p) p.engageWith=null; }
        rebuildFightTags(); break;
      }

      case 'CHAT': logChat(`${d.from.name}: ${d.msg}`); break;
      case 'LOOT_REMOVE': {
        state.loot.delete(d.id); const s=state.lootSprites.get(d.id);
        if(s){ world.removeChild(s); state.lootSprites.delete(d.id); }
        break;
      }
      case 'INV_ADD': logChat(`[Loot] You acquired ${d.item.base_type} (${d.item.uid})`); break;
      case 'ERROR': logChat(`[Error] ${d.message}`); break;
    }
  };

  ws.onerror=()=>logChat('[WS] error — check server is running on :3000');
  ws.onclose=()=>logChat('[WS] closed');
}

/* ==============================
   SPRITES
============================== */
function rebuildSprites(){
  for (const s of state.sprites.values()) { if(s.tagEl){ s.tagEl.remove(); } world.removeChild(s.g); }
  state.sprites.clear();
  for (const p of state.players.values()) ensurePlayerSprite(p);
  for (const l of state.loot.values()) ensureLootSprite(l);
}
function ensurePlayerSprite(p){
  if(state.sprites.has(p.id)) return;
  const g=new PIXI.Graphics();
  g.circle(0,0,16).fill(p.color||'#2dd4bf').stroke({width:2,color:0x000000,alpha:0.4});
  g.x=p.x; g.y=p.y;
  const entry={ g, visX:p.x, visY:p.y, tagEl:null };
  state.sprites.set(p.id, entry);
  world.addChild(g);
}
function ensureLootSprite(l){
  if(state.lootSprites.has(l.id)) return;
  const g=new PIXI.Graphics();
  g.x=l.x; g.y=l.y;
  g.rect(-10,-10,20,20).fill('#ffe08a').stroke({width:2,color:0x000000,alpha:0.25});
  world.addChild(g); state.lootSprites.set(l.id,g);
}

// Fight tags
function rebuildFightTags(){
  for (const s of state.sprites.values()) { if(s.tagEl){ s.tagEl.remove(); s.tagEl=null; } }
  for (const p of state.players.values()){
    if(!p.engageWith) continue;
    const s=state.sprites.get(p.id); if(!s) continue;
    const tag=document.createElement('div'); tag.className='fightTag'; tag.textContent='fighting';
    document.body.appendChild(tag); s.tagEl=tag;
  }
}

/* ==============================
   TOP-RIGHT PLAYER LIST
============================== */
function updatePlayersList(){
  const tileSize = state.constants?.TILE_SIZE || 64;
  const rows=[];
  for(const p of state.players.values()){
    const tx=Math.floor(p.x/tileSize), ty=Math.floor(p.y/tileSize);
    rows.push(`${p.name}  ${tx}:${ty}`);
  }
  rows.sort();
  playersList.textContent=rows.join('\n');
}

/* ==============================
   CHAT
============================== */
chatInput.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){
    const text=chatInput.value.trim();
    if(text) send('CHAT_SEND', { msg:text });
    chatInput.value=''; chatInput.blur();
>>>>>>> parent of e776a63 (a)
  }
});

// ==== RENDER LOOP ====
// No camera smoothing: lock camera to the player after interpolation/prediction
app.ticker.add(() => {
  const frame = snaps.getInterpolated();

  // Create/update sprites
  for (const [id, data] of Object.entries(frame.entities)) {
    let s = sprites.get(id);
    if (!s) {
      s = new PIXI.Graphics();
      s.beginFill(id === myId ? 0x66ccff : 0xffffff);
      s.drawCircle(0, 0, id === myId ? 10 : 8);
      s.endFill();
      camera.addChild(s);
      sprites.set(id, s);
    }
    s.__targetPos = { x: data.x, y: data.y };
    if (typeof data.r === 'number') s.rotation = data.r;
  }

<<<<<<< HEAD
  // Remove despawned
  for (const [id, s] of sprites) {
    if (!frame.entities[id]) {
      s.destroy();
      sprites.delete(id);
    }
  }

  // Apply positions (interpolated)
  for (const [id, s] of sprites) {
    const targ = s.__targetPos || { x: s.x, y: s.y };
    s.x = targ.x;
    s.y = targ.y;

    // Local prediction overlays AFTER interpolation for MY player only
    if (id === myId) {
      const predicted = predictor.predict({ x: s.x, y: s.y }, SPEED);
      s.x = predicted.x;
      s.y = predicted.y;

      // Camera snap to player (no lerp)
      camera.x = Math.floor(s.x - app.renderer.width / 2);
      camera.y = Math.floor(s.y - app.renderer.height / 2);
=======
/* ==============================
   CAMERA (steady), COORDS, SMOOTHING
============================== */
function centerCameraNow(){
  const me=state.me && state.players.get(state.me);
  if(!me) return;
  world.x = (app.renderer.width/2) - me.x;
  world.y = (app.renderer.height/2) - me.y;
  drawGridAround(me.x, me.y);
  tileRenderer.ensureChunks(me.x, me.y, app.renderer.width, app.renderer.height); // <-- ensure ground tiles exist
  const tileSize=state.constants?.TILE_SIZE||64;
  coordsEl.textContent=`x:${Math.floor(me.x/tileSize)}  y:${Math.floor(me.y/tileSize)}`;
  updatePlayersList();
}

// Smooth sprites (camera is not smoothed)
let lastMs=performance.now();
app.ticker.add(()=>{
  const now=performance.now(), dt=Math.max(0.001,(now-lastMs)/1000); lastMs=now;
  const alpha=1 - Math.exp(-10*dt);
  for(const [id,p] of state.players){
    const s=state.sprites.get(id); if(!s) continue;
    s.visX += (p.x - s.visX)*alpha;
    s.visY += (p.y - s.visY)*alpha;
    s.g.x=s.visX; s.g.y=s.visY;
    if(s.tagEl){
      const sx=s.visX+world.x, sy=s.visY+world.y-24; s.tagEl.style.left=`${sx}px`; s.tagEl.style.top=`${sy}px`;
    }
  }
  // animate move arrow (pulse/bob) and keep it pointing toward target
  updateMoveArrow(dt);
});

window.addEventListener('resize', ()=> centerCameraNow());

/* ==============================
   CHUNKED TILEMAP RENDERER
   - Procedural fallback (grass/dirt)
   - Auto-uses tileset image if found: client/assets/tiles.png (grid of 64x64)
============================== */
const tileRenderer = (() => {
  const chunks = new Map();      // "cx,cy" -> {sprite}
  const chunkSizeTiles = 16;     // 16x16 tiles per chunk (1,024 tiles)
  let tileSize = 64;
  let worldTiles = 1000;
  let tileset = null;            // {baseTexture, frames: PIXI.Texture[]} or null

  function key(cx, cy){ return `${cx},${cy}`; }

  function seededHash(x, y) {
    // quick 2D hash => 0..1
    let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 0xffffffff;
  }

  function tileTypeFor(tx, ty) {
    // Simple biome-ish noise: grass vs dirt with soft-ish borders
    const n = seededHash(Math.floor(tx/3), Math.floor(ty/3));
    return n < 0.75 ? 'grass' : 'dirt';
  }

  // Procedural color swatches (slight per-tile variance)
  function tileColor(type, tx, ty) {
    const v = seededHash(tx, ty) * 0.15; // 15% variance
    if (type === 'grass') {
      const base = [0x2a, 0x7d, 0x3b]; // green-ish
      return ((Math.min(255, base[0] + v*40) << 16) |
              (Math.min(255, base[1] + v*40) << 8) |
               Math.min(255, base[2] + v*20)) >>> 0;
    } else { // dirt
      const base = [0x7a, 0x5c, 0x3b]; // brown-ish
      return ((Math.min(255, base[0] + v*30) << 16) |
              (Math.min(255, base[1] + v*25) << 8) |
               Math.min(255, base[2] + v*20)) >>> 0;
    }
  }

  async function maybeLoadTileset() {
    // If client/assets/tiles.png exists and is same tileSize grid, use it
    try {
      const url = './assets/tiles.png';
      const tex = await PIXI.Assets.load(url);
      if (!tex) return null;
      const base = tex.baseTexture ?? tex;
      const frames = [];
      const cols = Math.floor(base.width / tileSize);
      const rows = Math.floor(base.height / tileSize);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const frame = new PIXI.Texture({
            source: base.resource ?? base,
            frame: new PIXI.Rectangle(x*tileSize, y*tileSize, tileSize, tileSize)
          });
          frames.push(frame);
        }
      }
      if (frames.length) return { baseTexture: base, frames };
      return null;
    } catch {
      return null; // no image; stick to procedural
    }
  }

  function drawChunkProcedural(cx, cy) {
    const gfx = new PIXI.Graphics();
    const originX = cx * chunkSizeTiles * tileSize;
    const originY = cy * chunkSizeTiles * tileSize;

    for (let ty = 0; ty < chunkSizeTiles; ty++) {
      for (let tx = 0; tx < chunkSizeTiles; tx++) {
        const wx = originX + tx * tileSize;
        const wy = originY + ty * tileSize;
        const tX = cx * chunkSizeTiles + tx;
        const tY = cy * chunkSizeTiles + ty;
        if (tX < 0 || tY < 0 || tX >= worldTiles || tY >= worldTiles) continue;

        const type = tileTypeFor(tX, tY);
        const col = tileColor(type, tX, tY);
        gfx.rect(wx, wy, tileSize, tileSize).fill(col);
      }
    }
    // Flatten to texture for perf
    const tex = app.renderer.generateTexture(gfx);
    gfx.destroy();
    const spr = new PIXI.Sprite(tex);
    spr.x = originX; spr.y = originY;
    return spr;
  }

  function drawChunkFromTileset(cx, cy) {
    // For each tile, choose a random frame (or map by type later)
    const container = new PIXI.Container();
    const originX = cx * chunkSizeTiles * tileSize;
    const originY = cy * chunkSizeTiles * tileSize;

    for (let ty = 0; ty < chunkSizeTiles; ty++) {
      for (let tx = 0; tx < chunkSizeTiles; tx++) {
        const tX = cx * chunkSizeTiles + tx;
        const tY = cy * chunkSizeTiles + ty;
        if (tX < 0 || tY < 0 || tX >= worldTiles || tY >= worldTiles) continue;
        const type = tileTypeFor(tX, tY);
        // Choose frame by type: first half grass, second half dirt (simple convention)
        const frames = tileset.frames;
        const mid = Math.floor(frames.length / 2) || 1;
        const frameIndex = (type === 'grass')
          ? Math.floor(seededHash(tX, tY) * Math.max(1, mid))
          : mid + Math.floor(seededHash(tX+17, tY+23) * Math.max(1, frames.length - mid));
        const tex = frames[Math.min(frames.length - 1, Math.max(0, frameIndex))];

        const spr = new PIXI.Sprite(tex);
        spr.x = originX + tx * tileSize;
        spr.y = originY + ty * tileSize;
        container.addChild(spr);
      }
    }
    // Flatten for perf
    const tex = app.renderer.generateTexture(container);
    container.destroy({ children: true });
    const spr = new PIXI.Sprite(tex);
    spr.x = originX; spr.y = originY;
    return spr;
  }

  function ensureChunk(cx, cy) {
    const k = key(cx, cy);
    if (chunks.has(k)) return;
    const sprite = tileset ? drawChunkFromTileset(cx, cy) : drawChunkProcedural(cx, cy);
    chunks.set(k, { sprite });
    groundLayer.addChild(sprite);
  }

  function cullChunks(viewRect) {
    // Remove far-away chunks to keep memory usage in check
    for (const [k, obj] of chunks) {
      const [cx, cy] = k.split(',').map(Number);
      const x = cx * chunkSizeTiles * tileSize;
      const y = cy * chunkSizeTiles * tileSize;
      const w = chunkSizeTiles * tileSize;
      const h = chunkSizeTiles * tileSize;

      // Inflate view rect a bit to reduce churn
      const margin = w * 1.5;
      const inView = !(x + w < viewRect.x - margin ||
                       x > viewRect.x + viewRect.w + margin ||
                       y + h < viewRect.y - margin ||
                       y > viewRect.y + viewRect.h + margin);
      if (!inView) {
        groundLayer.removeChild(obj.sprite);
        obj.sprite.destroy();
        chunks.delete(k);
      }
    }
  }

  return {
    async init({ tileSize: ts, worldTiles: wt }) {
      tileSize = ts; worldTiles = wt;
      tileset = await maybeLoadTileset(); // null if not present
    },
    ensureChunks(centerX, centerY, viewW, viewH) {
      const halfW = Math.ceil(viewW / 2);
      const halfH = Math.ceil(viewH / 2);
      const minX = centerX - halfW;
      const minY = centerY - halfH;
      const maxX = centerX + halfW;
      const maxY = centerY + halfH;

      const chunkPx = chunkSizeTiles * tileSize;
      const cx0 = Math.floor(minX / chunkPx) - 1;
      const cy0 = Math.floor(minY / chunkPx) - 1;
      const cx1 = Math.floor(maxX / chunkPx) + 1;
      const cy1 = Math.floor(maxY / chunkPx) + 1;

      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (cx < 0 || cy < 0 || cx * chunkSizeTiles >= worldTiles || cy * chunkSizeTiles >= worldTiles) continue;
          ensureChunk(cx, cy);
        }
      }

      cullChunks({ x: minX, y: minY, w: viewW, h: viewH });
    }
  };
})();

/* ==============================
   MOVE ARROW (NWSE compass + animation)
============================== */
let moveArrow = null;
function buildMoveArrow() {
  // Container
  const c = new PIXI.Container();

  // Compass cross (NWSE-ish) behind the arrow
  const cross = new PIXI.Graphics();
  cross.stroke({ width: 2, color: 0x00ff66, alpha: 0.25 });
  cross.moveTo(-18, 0).lineTo(18, 0);
  cross.moveTo(0, -18).lineTo(0, 18);
  c.addChild(cross);

  // Labels N W S E
  const mkLabel = (txt, x, y) => {
    const t = new PIXI.Text({ text: txt, style: { fontFamily: 'monospace', fontSize: 10, fill: 0x00ff66, align: 'center' } });
    t.anchor.set(0.5);
    t.x = x; t.y = y;
    t.alpha = 0.8;
    c.addChild(t);
  };
  mkLabel('N', 0, -26);
  mkLabel('S', 0, 26);
  mkLabel('W', -26, 0);
  mkLabel('E', 26, 0);

  // Arrow head (triangle)
  const arrow = new PIXI.Graphics();
  arrow.fill(0x00ff66, 1).moveTo(0, -20).lineTo(12, 12).lineTo(-12, 12).lineTo(0, -20);
  arrow.stroke({ width: 2, color: 0x00331a, alpha: 0.6 });
  c.addChild(arrow);

  c.alpha = 0.95;
  c.visible = false;
  indicatorLayer.addChild(c);
  return c;
}
function showMoveArrow(){
  if (!moveArrow) moveArrow = buildMoveArrow();
  moveArrow.visible = true;
}
function hideMoveArrow(){
  if (moveArrow) moveArrow.visible = false;
}
let arrowTime = 0;
function updateMoveArrow(dt){
  if (!moveArrow || !moveArrow.visible) return;
  const me = state.me && state.players.get(state.me);
  if (!me) { hideMoveArrow(); return; }
  // Position arrow at the player (use smoothed position if available)
  const s = state.sprites.get(state.me);
  const ax = (s?.visX ?? me.x), ay = (s?.visY ?? me.y);
  moveArrow.x = ax; moveArrow.y = ay;

  // Point toward the target
  if (state.moveTarget) {
    const dx = state.moveTarget.x - ax;
    const dy = state.moveTarget.y - ay;
    moveArrow.rotation = Math.atan2(dy, dx) + Math.PI / 2; // triangle points "up" by default
  }

  // Little animation: pulse scale and bob up/down
  arrowTime += dt;
  const pulse = 1 + Math.sin(arrowTime * 6) * 0.08;   // scale pulse
  const bob = Math.sin(arrowTime * 3) * 2;            // vertical bob (pixels)
  moveArrow.scale.set(pulse, pulse);
  moveArrow.y = ay + bob;
}

/* ==============================
   END
============================== */
=======

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
>>>>>>> parent of c1c4bd7 (Revert "a")
