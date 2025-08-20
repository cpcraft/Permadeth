// client/src/main.js
import * as PIXI from 'pixi.js';
import { SnapshotBuffer } from './net/interpolator.js';
import { LocalPredictor } from './net/localPrediction.js';

// ==== SETUP PIXI ====
const app = new PIXI.Application({
  width: 1280,
  height: 720,
  antialias: true,
  backgroundColor: 0x0f0f12
});
document.getElementById('game').appendChild(app.view);

// Ensure ticker is not capped at 20/30fps
app.ticker.maxFPS = 0; // use rAF (uncapped; sync to display)
app.ticker.minFPS = 0;

// World containers
const world = new PIXI.Container();
app.stage.addChild(world);

// Simple camera container that follows the player DIRECTLY (no lerp)
const camera = new PIXI.Container();
world.addChild(camera);

// Entities map: id -> sprite
const sprites = new Map();

// Networking state
const socket = new WebSocket(`ws://${location.hostname}:3000/ws`);
socket.binaryType = 'arraybuffer';

// Client rendering helpers
const snaps = new SnapshotBuffer({ delayMs: 100, maxMs: 1000 });
let myId = null;
const predictor = new LocalPredictor(null);
const SPEED = 220; // must match server

// ===== INPUT: click-to-move =====
app.view.addEventListener('mousedown', (e) => {
  if (!myId) return;
  const rect = app.view.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  // convert screen to world coords (no camera smoothing, so it's stable)
  const worldX = screenX + camera.x;
  const worldY = screenY + camera.y;

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
  }

  if (msg.op === 'STATE') {
    // expected: { op:'STATE', ts:<ms>, seq:<lastProcessedSeq>, entities:{ id:{x,y,r} } }
    snaps.push({ ts: msg.ts, state: { entities: msg.entities } });
    if (myId) predictor.ack(msg.seqFor?.[myId] ?? msg.seq); // support per-player ack or global seq
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
    }
  }
});
