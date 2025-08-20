import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import { WebSocketServer } from 'ws';
import { GameState, ALLOWED_OPS, MAX_MSG_BYTES, MAX_MSG_RATE } from './game.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  originAgentCluster: false
}));
app.use(express.json());

// Static client
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, '../../client');
app.use(express.static(clientDir));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG_BYTES });

const game = new GameState();
const sockets = new Map(); // id -> ws
const nameTaken = new Set();

function uid() { return Math.random().toString(36).slice(2, 10); }

function broadcast(op, data) {
  const msg = JSON.stringify({ op, data });
  for (const ws of sockets.values()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}
function send(id, op, data) {
  const ws = sockets.get(id);
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op, data }));
}

wss.on('connection', (ws) => {
  ws._bucket = { ts: Date.now(), count: 0 };
  ws.on('message', (buf) => {
    if (buf.length > MAX_MSG_BYTES) return;
    const now = Date.now();
    const bucket = ws._bucket;
    if (now - bucket.ts > 1000) { bucket.ts = now; bucket.count = 0; }
    if (++bucket.count > MAX_MSG_RATE) return;

    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); }
    catch { return; }
    const { op, data } = msg || {};
    if (!ALLOWED_OPS.has(op)) return;

    if (op === 'JOIN') {
      const name = String((data?.name || '')).slice(0, 16) || 'anon';
      if (nameTaken.has(name)) return send(null, 'ERROR', { error: 'Name in use' });
      const id = uid();
      sockets.set(id, ws);
      nameTaken.add(name);
      const color = data?.color || '#4cc9f0';
      const x = Math.floor(Math.random() * 8000) + 2000;
      const y = Math.floor(Math.random() * 8000) + 2000;
      game.addPlayer({ id, name, color, x, y, target: null, engageWith: null });
      ws._id = id;
      send(id, 'WELCOME', { id, snapshot: game.snapshot() });
      broadcast('PLAYERS', game.snapshot());
      return;
    }

    const id = ws._id;
    if (!id) return;

    if (op === 'MOVE_TARGET') {
      const x = Number(data?.x), y = Number(data?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) game.setMoveTarget(id, x, y);
      return;
    }

    if (op === 'ENGAGE_LEAVE') {
      game.leaveEngagement(id);
      broadcast('PLAYERS', game.snapshot());
      return;
    }

    if (op === 'CHAT_SEND') {
      const text = String((data?.text || '')).slice(0, 180);
      if (!text) return;
      broadcast('CHAT', { from: id, text });
      return;
    }

    if (op === 'PING') { send(id, 'PONG', {}); return; }
  });

  ws.on('close', () => {
    const id = ws._id;
    if (!id) return;
    const p = game.players.get(id);
    if (p) { nameTaken.delete(p.name); game.removePlayer(id); }
    sockets.delete(id);
    broadcast('PLAYERS', game.snapshot());
  });
});

setInterval(() => {
  game.tick();
  broadcast('PLAYERS', game.snapshot());
}, 50);

server.listen(PORT, () => {
  console.log(`Permadeth server on http://localhost:${PORT}`);
  console.log('WebSocket path: /ws');
});
