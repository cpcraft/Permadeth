/* global PIXI */
const canvas = document.getElementById('game');
const app = new PIXI.Application();
await app.init({ canvas, resizeTo: window, antialias: true, backgroundAlpha: 0 });

const state = {
  me: null,
  constants: null,
  players: new Map(), // id -> {id,name,color,x,y,engageWith}
  loot: new Map(),
  sprites: new Map(), // id -> {g, visX, visY, tagEl?}
  lootSprites: new Map(),
  ws: null,
  moveTarget: null,
  engaged: false,
};

// World layer
const world = new PIXI.Container();
app.stage.addChild(world);

// 64px grid; camera NOT smoothed
const grid = new PIXI.Graphics();
world.addChild(grid);
const GRID_STEP = 64;
let lastGridCenter = { x: -99999, y: -99999 };
function drawGridAround(cx, cy) {
  if (Math.hypot(cx - lastGridCenter.x, cy - lastGridCenter.y) < GRID_STEP / 2) return;
  lastGridCenter = { x: cx, y: cy };
  grid.clear(); grid.alpha = 0.12; grid.stroke({ width: 1 });
  const viewW = app.renderer.width, viewH = app.renderer.height, pad = GRID_STEP * 8;
  const x0 = Math.floor((cx - viewW/2 - pad) / GRID_STEP) * GRID_STEP;
  const x1 = Math.ceil((cx + viewW/2 + pad) / GRID_STEP) * GRID_STEP;
  const y0 = Math.floor((cy - viewH/2 - pad) / GRID_STEP) * GRID_STEP;
  const y1 = Math.ceil((cy + viewH/2 + pad) / GRID_STEP) * GRID_STEP;
  for (let x = x0; x <= x1; x += GRID_STEP) grid.moveTo(x, y0).lineTo(x, y1);
  for (let y = y0; y <= y1; y += GRID_STEP) grid.moveTo(x0, y).lineTo(x1, y);
}

// Click‑to‑move
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
app.stage.cursor = 'crosshair';
app.stage.on('pointerdown', (e) => {
  if (!state.me || !state.players.get(state.me)) return;
  const target = { x: e.global.x - world.x, y: e.global.y - world.y };
  state.moveTarget = target;
});
function stopMovement() { state.moveTarget = null; send('MOVE_DIR', { dx: 0, dy: 0 }); }

// UI refs
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

// WS
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
        break;

      case 'WORLD_SNAPSHOT':
        state.players.clear(); state.loot.clear();
        d.players.forEach(p=>state.players.set(p.id,p));
        d.loot.forEach(l=>state.loot.set(l.id,l));
        rebuildSprites(); rebuildFightTags(); updatePlayersList();
        // ensure we recenter now that we definitely have our own position
        centerCameraNow();
        break;

      case 'PLAYER_JOINED': {
        state.players.set(d.id,d);
        ensurePlayerSprite(d);            // <— draw immediately (even if it's me)
        updatePlayersList();
        if (d.id === state.me) centerCameraNow();
        break;
      }

      case 'PLAYER_MOVES':
        // update server positions; if it's me, recenter (camera not smoothed)
        d.forEach(({id,x,y})=>{
          const p=state.players.get(id); if(!p) return;
          const wasMe = (id===state.me); p.x=x; p.y=y;
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

// Sprites
function rebuildSprites(){
  for (const s of state.sprites.values()) { if(s.tagEl) s.tagEl.remove(); world.removeChild(s.g); }
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

// Player list (top-right)
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

// Chat
chatInput.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){
    const text=chatInput.value.trim();
    if(text) send('CHAT_SEND', { msg:text });
    chatInput.value=''; chatInput.blur();
  }
});

// 50ms movement intent
setInterval(()=>{
  const me=state.me && state.players.get(state.me);
  if(!me || !state.moveTarget) return;
  const dx=state.moveTarget.x - me.x, dy=state.moveTarget.y - me.y, dist=Math.hypot(dx,dy);
  if(dist<8){ stopMovement(); return; }
  send('MOVE_DIR', { dx: dx/dist, dy: dy/dist });
}, 50);

// WS send helper
function send(op,d={}){ if(state.ws && state.ws.readyState===1) state.ws.send(JSON.stringify({op,d})); }

/* ---------- Camera (steady) + coords + sprite smoothing ---------- */
function centerCameraNow(){
  const me=state.me && state.players.get(state.me);
  if(!me) return;
  world.x = (app.renderer.width/2) - me.x;
  world.y = (app.renderer.height/2) - me.y;
  drawGridAround(me.x, me.y);
  const tileSize=state.constants?.TILE_SIZE||64;
  coordsEl.textContent=`x:${Math.floor(me.x/tileSize)}  y:${Math.floor(me.y/tileSize)}`;
  updatePlayersList();
}

// Smooth sprites every frame (camera not smoothed)
let lastMs=performance.now();
app.ticker.add(()=>{
  const now=performance.now(), dt=Math.max(0.001,(now-lastMs)/1000); lastMs=now;
  const alpha=1 - Math.exp(-10*dt);
  for(const [id,p] of state.players){
    const s=state.sprites.get(id); if(!s) continue;
    s.visX += (p.x - s.visX)*alpha;
    s.visY += (p.y - s.visY)*alpha;
    s.g.x=s.visX; s.g.y=s.visY;
    if(s.tagEl){ const sx=s.visX+world.x, sy=s.visY+world.y-24; s.tagEl.style.left=`${sx}px`; s.tagEl.style.top=`${sy}px`; }
  }
});

window.addEventListener('resize', ()=> centerCameraNow());
