/* global PIXI */
const canvas = document.getElementById('game');
const app = new PIXI.Application();
await app.init({ canvas, resizeTo: window, antialias: true, backgroundAlpha: 0 });

/* ==============================
   STATE
============================== */
const state = {
  me: null,
  constants: null,
  players: new Map(),
  loot: new Map(),
  sprites: new Map(),
  lootSprites: new Map(),
  ws: null,
  moveTarget: null,   // {x,y}
  engaged: false,
};

/* ==============================
   WORLD LAYERS
============================== */
const world = new PIXI.Container();
app.stage.addChild(world);

const groundLayer = new PIXI.Container();
world.addChild(groundLayer);

const grid = new PIXI.Graphics();
world.addChild(grid);

// indicator layer for local-only effects
const indicatorLayer = new PIXI.Container();
world.addChild(indicatorLayer);

const GRID_STEP = 64;
let lastGridCenter = { x: -9999, y: -9999 };
function drawGridAround(cx, cy) {
  if (Math.hypot(cx - lastGridCenter.x, cy - lastGridCenter.y) < GRID_STEP/2) return;
  lastGridCenter = { x: cx, y: cy };
  grid.clear(); grid.alpha = 0.12; grid.stroke({ width: 1 });
  const vw = app.renderer.width, vh = app.renderer.height, pad = GRID_STEP*8;
  const x0 = Math.floor((cx - vw/2 - pad)/GRID_STEP)*GRID_STEP;
  const x1 = Math.ceil((cx + vw/2 + pad)/GRID_STEP)*GRID_STEP;
  const y0 = Math.floor((cy - vh/2 - pad)/GRID_STEP)*GRID_STEP;
  const y1 = Math.ceil((cy + vh/2 + pad)/GRID_STEP)*GRID_STEP;
  for (let x=x0;x<=x1;x+=GRID_STEP) grid.moveTo(x,y0).lineTo(x,y1);
  for (let y=y0;y<=y1;y+=GRID_STEP) grid.moveTo(x0,y).lineTo(x1,y);
}

/* ==============================
   RIGHT-CLICK TO MOVE
============================== */
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
canvas.addEventListener('contextmenu', e=>e.preventDefault());

app.stage.on('pointerdown', e=>{
  if(e.button!==2) return; // only right-click
  if(!state.me) return;
  const target = { x: e.global.x - world.x, y: e.global.y - world.y };
  state.moveTarget = target;
  showClickCrosshair(target.x, target.y);
});

function stopMovement(){
  state.moveTarget=null;
  send('MOVE_DIR',{dx:0,dy:0});
}

/* ==============================
   UI
============================== */
const chatLog=document.getElementById('log');
const chatInput=document.getElementById('chatInput');
const coordsEl=document.getElementById('coords');
const playersList=document.getElementById('playersList');
const engageModal=document.getElementById('engageModal');
const btnLeave=document.getElementById('btnLeave');
const authEl=document.getElementById('auth');
const tabLogin=document.getElementById('tabLogin');
const tabRegister=document.getElementById('tabRegister');
const loginView=document.getElementById('loginView');
const registerView=document.getElementById('registerView');
const loginUser=document.getElementById('loginUser');
const loginPass=document.getElementById('loginPass');
const btnLogin=document.getElementById('btnLogin');
const regUser=document.getElementById('regUser');
const regPass=document.getElementById('regPass');
const regPass2=document.getElementById('regPass2');
const btnRegister=document.getElementById('btnRegister');

tabLogin.onclick=()=>{tabLogin.classList.add('active');tabRegister.classList.remove('active');loginView.classList.remove('hidden');registerView.classList.add('hidden');};
tabRegister.onclick=()=>{tabRegister.classList.add('active');tabLogin.classList.remove('active');registerView.classList.remove('hidden');loginView.classList.add('hidden');};

function logChat(msg){const p=document.createElement('div');p.textContent=msg;chatLog.appendChild(p);chatLog.scrollTop=chatLog.scrollHeight;}

btnRegister.onclick=async()=>{
  try{
    if(regPass.value!==regPass2.value) return logChat('[Auth] Passwords do not match');
    const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:regUser.value.trim(),password:regPass.value})});
    const data=await r.json();if(!r.ok)return logChat('[Auth] '+(data.error||'Registration failed'));
    localStorage.setItem('pd_token',data.token);logChat('[Auth] Registration OK. Connecting...');connect();
  }catch{logChat('[Auth] Registration error');}
};
btnLogin.onclick=async()=>{
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:loginUser.value.trim(),password:loginPass.value})});
    const data=await r.json();if(!r.ok)return logChat('[Auth] '+(data.error||'Login failed'));
    localStorage.setItem('pd_token',data.token);logChat('[Auth] Login OK. Connecting...');connect();
  }catch{logChat('[Auth] Login error');}
};
[loginUser,loginPass].forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter')btnLogin.click();}));
[regUser,regPass,regPass2].forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter')btnRegister.click();}));
btnLeave.onclick=()=>send('ENGAGE_LEAVE',{});

/* ==============================
   WEBSOCKET
============================== */
function connect(){
  if(state.ws && (state.ws.readyState===0||state.ws.readyState===1)) return;
  const url=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';
  const ws=new WebSocket(url); state.ws=ws;
  ws.onopen=()=>{const t=localStorage.getItem('pd_token');ws.send(JSON.stringify({op:'JOIN',d:{token:t}}));};
  ws.onmessage=(ev)=>{
    const {t,d}=JSON.parse(ev.data);
    switch(t){
      case'WELCOME':state.me=d.id;state.constants=d.constants;authEl.classList.add('hidden');playersList.classList.remove('hidden');
        tileRenderer.init({tileSize:d.constants?.TILE_SIZE||64,worldTiles:d.constants?.WORLD_TILES||1000});centerCameraNow();break;
      case'WORLD_SNAPSHOT':state.players.clear();state.loot.clear();d.players.forEach(p=>state.players.set(p.id,p));d.loot.forEach(l=>state.loot.set(l.id,l));
        rebuildSprites();rebuildFightTags();updatePlayersList();centerCameraNow();break;
      case'PLAYER_JOINED':state.players.set(d.id,d);ensurePlayerSprite(d);updatePlayersList();if(d.id===state.me)centerCameraNow();break;
      case'PLAYER_MOVES':d.forEach(({id,x,y})=>{const p=state.players.get(id);if(!p)return;p.x=x;p.y=y;if(id===state.me)centerCameraNow();});break;
      case'PLAYER_LEFT':{const s=state.sprites.get(d.id);if(s?.tagEl)s.tagEl.remove();state.sprites.delete(d.id);state.players.delete(d.id);updatePlayersList();}break;
      case'ENGAGE_START':{const me=state.players.get(state.me);if(me)me.engageWith=d.with;const other=state.players.get(d.with);if(other)other.engageWith=state.me;
        state.engaged=true;engageModal.classList.remove('hidden');rebuildFightTags();}break;
      case'ENGAGE_FLAGS':for(const [a,b]of d.pairs||[]){const pa=state.players.get(a),pb=state.players.get(b);if(pa)pa.engageWith=b;if(pb)pb.engageWith=a;}rebuildFightTags();break;
      case'ENGAGE_END':{const me=state.players.get(state.me);if(me)me.engageWith=null;const other=state.players.get(d.with);if(other)other.engageWith=null;state.engaged=false;engageModal.classList.add('hidden');rebuildFightTags();}break;
      case'ENGAGE_FLAGS_CLEAR':for(const id of d.ids||[]){const p=state.players.get(id);if(p)p.engageWith=null;}rebuildFightTags();break;
      case'CHAT':logChat(`${d.from.name}: ${d.msg}`);break;
      case'LOOT_REMOVE':state.loot.delete(d.id);const s=state.lootSprites.get(d.id);if(s){world.removeChild(s);state.lootSprites.delete(d.id);}break;
      case'INV_ADD':logChat(`[Loot] You acquired ${d.item.base_type} (${d.item.uid})`);break;
      case'ERROR':logChat(`[Error] ${d.message}`);break;
    }
  };
  ws.onerror=()=>logChat('[WS] error');ws.onclose=()=>logChat('[WS] closed');
}

/* ==============================
   SPRITES
============================== */
function rebuildSprites(){for(const s of state.sprites.values()){if(s.tagEl)s.tagEl.remove();world.removeChild(s.g);}state.sprites.clear();
  for(const p of state.players.values())ensurePlayerSprite(p);
  for(const l of state.loot.values())ensureLootSprite(l);}
function ensurePlayerSprite(p){if(state.sprites.has(p.id))return;const g=new PIXI.Graphics();g.circle(0,0,16).fill(p.color||'#2dd4bf').stroke({width:2,color:0x000,alpha:0.4});g.x=p.x;g.y=p.y;
  state.sprites.set(p,{g,visX:p.x,visY:p.y,tagEl:null});world.addChild(g);}
function ensureLootSprite(l){if(state.lootSprites.has(l.id))return;const g=new PIXI.Graphics();g.rect(-10,-10,20,20).fill('#ffe08a').stroke({width:2,color:0x000,alpha:0.25});g.x=l.x;g.y=l.y;
  world.addChild(g);state.lootSprites.set(l.id,g);}

/* ==============================
   "FIGHTING" TAGS
============================== */
function rebuildFightTags(){for(const s of state.sprites.values()){if(s.tagEl){s.tagEl.remove();s.tagEl=null;}}
  for(const p of state.players.values()){if(!p.engageWith)continue;const s=state.sprites.get(p.id);if(!s)continue;
    const tag=document.createElement('div');tag.className='fightTag';tag.textContent='fighting';document.body.appendChild(tag);s.tagEl=tag;}}

/* ==============================
   PLAYER LIST
============================== */
function updatePlayersList(){const ts=state.constants?.TILE_SIZE||64;const rows=[];for(const p of state.players.values()){rows.push(`${p.name}  ${Math.floor(p.x/ts)}:${Math.floor(p.y/ts)}`);}
  rows.sort();playersList.textContent=rows.join('\n');}

/* ==============================
   CHAT
============================== */
chatInput.addEventListener('keydown',e=>{if(e.key==='Enter'){const text=chatInput.value.trim();if(text)send('CHAT_SEND',{msg:text});chatInput.value='';chatInput.blur();}});

/* ==============================
   MOVEMENT INTENT
============================== */
setInterval(()=>{const me=state.me&&state.players.get(state.me);if(!me||!state.moveTarget)return;
  const dx=state.moveTarget.x-me.x,dy=state.moveTarget.y-me.y,dist=Math.hypot(dx,dy);
  if(dist<8){stopMovement();return;}send('MOVE_DIR',{dx:dx/dist,dy:dy/dist});},50);

function send(op,d={}){if(state.ws&&state.ws.readyState===1)state.ws.send(JSON.stringify({op,d}));}

/* ==============================
   CAMERA & SMOOTHING
============================== */
function centerCameraNow(){const me=state.me&&state.players.get(state.me);if(!me)return;
  world.x=(app.renderer.width/2)-me.x;world.y=(app.renderer.height/2)-me.y;
  drawGridAround(me.x,me.y);tileRenderer.ensureChunks(me.x,me.y,app.renderer.width,app.renderer.height);
  const ts=state.constants?.TILE_SIZE||64;coordsEl.textContent=`x:${Math.floor(me.x/ts)} y:${Math.floor(me.y/ts)}`;updatePlayersList();}
let lastMs=performance.now();
app.ticker.add(()=>{const now=performance.now(),dt=(now-lastMs)/1000;lastMs=now;
  const alpha=1-Math.exp(-10*dt);for(const [id,p] of state.players){const s=state.sprites.get(id);if(!s)continue;
    s.visX+=(p.x-s.visX)*alpha;s.visY+=(p.y-s.visY)*alpha;s.g.x=s.visX;s.g.y=s.visY;
    if(s.tagEl){s.tagEl.style.left=`${s.visX+world.x}px`;s.tagEl.style.top=`${s.visY+world.y-24}px`;}}updateCrosshair(dt);});
window.addEventListener('resize',()=>centerCameraNow());

/* ==============================
   TILE RENDERER (kept)
============================== */
const tileRenderer=(()=>{const chunks=new Map();const chunkSizeTiles=16;let tileSize=64,worldTiles=1000;
  function key(cx,cy){return`${cx},${cy}`;}
  function seededHash(x,y){let h=(x*374761393+y*668265263)^0x5bf03635;h=(h^(h>>>13))*1274126177;h=h^(h>>>16);return(h>>>0)/0xffffffff;}
  function tileTypeFor(tx,ty){const n=seededHash(Math.floor(tx/3),Math.floor(ty/3));return n<0.75?'grass':'dirt';}
  function tileColor(type,tx,ty){const v=seededHash(tx,ty)*0.15;if(type==='grass'){const b=[0x2a,0x7d,0x3b];
    return((Math.min(255,b[0]+v*40)<<16)|(Math.min(255,b[1]+v*40)<<8)|Math.min(255,b[2]+v*20))>>>0;}
    const b=[0x7a,0x5c,0x3b];return((Math.min(255,b[0]+v*30)<<16)|(Math.min(255,b[1]+v*25)<<8)|Math.min(255,b[2]+v*20))>>>0;}
  function drawChunk(cx,cy){const gfx=new PIXI.Graphics();const ox=cx*chunkSizeTiles*tileSize,oy=cy*chunkSizeTiles*tileSize;
    for(let ty=0;ty<chunkSizeTiles;ty++){for(let tx=0;tx<chunkSizeTiles;tx++){const tX=cx*chunkSizeTiles+tx,tY=cy*chunkSizeTiles+ty;
      if(tX<0||tY<0||tX>=worldTiles||tY>=worldTiles)continue;const wx=ox+tx*tileSize,wy=oy+ty*tileSize;
      const type=tileTypeFor(tX,tY),col=tileColor(type,tX,tY);gfx.rect(wx,wy,tileSize,tileSize).fill(col);}}
    const tex=app.renderer.generateTexture(gfx);gfx.destroy();const spr=new PIXI.Sprite(tex);spr.x=ox;spr.y=oy;return spr;}
  function ensureChunk(cx,cy){const k=key(cx,cy);if(chunks.has(k))return;const spr=drawChunk(cx,cy);chunks.set(k,{sprite:spr});groundLayer.addChild(spr);}
  function cull(view){for(const [k,obj] of chunks){const[cx,cy]=k.split(',').map(Number);const x=cx*chunkSizeTiles*tileSize,y=cy*chunkSizeTiles*tileSize;
      const w=chunkSizeTiles*tileSize,h=chunkSizeTiles*tileSize,margin=w*1.5;
      const inView=!(x+w<view.x-margin||x>view.x+view.w+margin||y+h<view.y-margin||y>view.y+view.h+margin);
      if(!inView){groundLayer.removeChild(obj.sprite);obj.sprite.destroy();chunks.delete(k);}}}
  return{init({tileSize:ts,worldTiles:wt}){tileSize=ts;worldTiles=wt;},ensureChunks(cx,cy,vw,vh){const hw=Math.ceil(vw/2),hh=Math.ceil(vh/2);
      const minX=cx-hw,minY=cy-hh,maxX=cx+hw,maxY=cy+hh;const chunkPx=chunkSizeTiles*tileSize;
      const cx0=Math.floor(minX/chunkPx)-1,cy0=Math.floor(minY/chunkPx)-1,cx1=Math.floor(maxX/chunkPx)+1,cy1=Math.floor(maxY/chunkPx)+1;
      for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++){if(cx<0||cy<0||cx*chunkSizeTiles>=worldTiles||cy*chunkSizeTiles>=worldTiles)continue;ensureChunk(cx,cy);}
      cull({x:minX,y:minY,w:vw,h:vh});}}})();

/* ==============================
   CLICK CROSSHAIR INDICATOR
============================== */
let crosshair=null, crossTime=0;
function showClickCrosshair(x,y){
  if(!crosshair){
    crosshair=new PIXI.Graphics();
    indicatorLayer.addChild(crosshair);
  }
  crosshair.visible=true;crosshair.alpha=1;crosshair.x=x;crosshair.y=y;crossTime=0;
}
function updateCrosshair(dt){
  if(!crosshair||!crosshair.visible)return;
  crossTime+=dt;
  const pulse=1+Math.sin(crossTime*6)*0.15;
  const size=14*pulse;
  crosshair.clear();
  crosshair.stroke({width:2,color:0x00ff66,alpha:0.9});
  crosshair.moveTo(-size,0).lineTo(size,0);
  crosshair.moveTo(0,-size).lineTo(0,size);
  crosshair.scale.set(1,1);
  // fade after 3s
  if(crossTime>3)crosshair.alpha=Math.max(0,1-(crossTime-3));
  if(crossTime>4)crosshair.visible=false;
}
