import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

import { pool, initSchema } from './db.js';
import {
  GameState, ALLOWED_OPS, MAX_MSG_BYTES, makeRateLimiter,
  genItemUid, dist, CONSTANTS
} from './game.js';

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  await initSchema();

  const app = express();
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    originAgentCluster: false
  }));
  app.use(express.json());

  // ---------- Static client ----------
  const clientDir = path.resolve(__dirname, '../../client');
  const indexPath = path.join(clientDir, 'index.html');
  app.use(express.static(clientDir));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api') || _req.path.startsWith('/ws')) return next();
    if (!fs.existsSync(indexPath)) return res.status(500).send('client/index.html missing');
    res.sendFile(indexPath);
  });

  // ---------- Auth API ----------
  app.post('/api/register', async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        return res.status(400).json({ error: 'Username must be 3-16 chars (A-Z, a-z, 0-9, _)' });
      }
      if (password.length < 6) return res.status(400).json({ error: 'Password too short' });

      const check = await pool.query('SELECT 1 FROM players WHERE lower(name)=lower($1) LIMIT 1', [username]);
      if (check.rowCount) return res.status(409).json({ error: 'Username already taken' });

      const id = uuidv4();
      const hash = await bcrypt.hash(password, 10);
      const color = '#2dd4bf';

      await pool.query(
        'INSERT INTO players (id, name, color, password_hash) VALUES ($1,$2,$3,$4)',
        [id, username, color, hash]
      );

      const token = uuidv4();
      await pool.query('INSERT INTO sessions (token, player_id) VALUES ($1,$2)', [token, id]);

      res.json({ token, player: { id, username, color } });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Registration failed' });
    }
  });

  app.post('/api/login', async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

      const { rows } = await pool.query(
        'SELECT id, name, color, password_hash FROM players WHERE lower(name)=lower($1)',
        [username]
      );
      if (!rows.length || !rows[0].password_hash) return res.status(401).json({ error: 'Invalid username or password' });

      const ok = await bcrypt.compare(password, rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

      const token = uuidv4();
      await pool.query('INSERT INTO sessions (token, player_id) VALUES ($1,$2)', [token, rows[0].id]);
      res.json({ token, player: { id: rows[0].id, username: rows[0].name, color: rows[0].color } });
    } catch {
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // ---------- WS + Game ----------
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const state = new GameState();
  state.spawnInitialLoot(400);

  const broadcast = (type, d) => {
    const msg = JSON.stringify({ t: type, d });
    for (const pid of state.players.keys()) {
      const p = state.players.get(pid);
      if (p?.ws && p.ws.readyState === 1) p.ws.send(msg);
    }
  };
  const sendTo = (pid, type, d) => {
    const p = state.players.get(pid);
    if (!p?.ws || p.ws.readyState !== 1) return;
    p.ws.send(JSON.stringify({ t: type, d }));
  };

  // physics + engagement detection
  setInterval(() => {
    state.tick(CONSTANTS.TICK_MS / 1000);

    // --- detect new touches (naive O(n^2) for now) ---
    const touched = [];
    const arr = Array.from(state.players.values());
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (a.engageWith || b.engageWith) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d <= CONSTANTS.TOUCH_RADIUS) {
          a.engageWith = b.id;
          b.engageWith = a.id;
          touched.push([a.id, b.id]);
        }
      }
    }
    for (const [p1, p2] of touched) {
      sendTo(p1, 'ENGAGE_START', { with: p2 });
      sendTo(p2, 'ENGAGE_START', { with: p1 });
      broadcast('ENGAGE_FLAGS', { pairs: [[p1, p2]] }); // tell others to show "fighting"
    }

    // movement broadcast
    const payload = arr.map(p => ({ id: p.id, x: p.x, y: p.y }));
    broadcast('PLAYER_MOVES', payload);
  }, CONSTANTS.TICK_MS);

  wss.on('connection', (ws) => {
    const rl = makeRateLimiter();

    ws.on('message', async (raw) => {
      if (typeof raw === 'string' ? raw.length > MAX_MSG_BYTES : raw.byteLength > MAX_MSG_BYTES) {
        ws.close(1009, 'Message too large');
        return;
      }
      if (!rl.take(1)) return;

      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const { op, d } = msg || {};
      if (!ALLOWED_OPS.has(op)) return;

      try {
        switch (op) {
          case 'JOIN': {
            const token = String(d?.token || '');
            if (!token) { ws.send(JSON.stringify({ t: 'ERROR', d: { message: 'Missing token' } })); return; }

            const { rows } = await pool.query(
              `SELECT s.player_id AS id, p.name, p.color
               FROM sessions s JOIN players p ON p.id = s.player_id
               WHERE s.token = $1`, [token]
            );
            if (!rows.length) { ws.send(JSON.stringify({ t: 'ERROR', d: { message: 'Invalid token' } })); return; }

            const { id, name, color } = rows[0];

            // Spawn inside top-left 10x10 tiles
            const tiles = 10;
            const size = CONSTANTS.TILE_SIZE * tiles;
            const player = {
              id, name, color,
              x: Math.random() * size,
              y: Math.random() * size,
              dir: { x: 0, y: 0 },
              ws,
              engageWith: null
            };
            state.addPlayer(player);
            state.addSocket(ws, id);

            ws.send(JSON.stringify({ t: 'WELCOME', d: { id, constants: CONSTANTS } }));
            ws.send(JSON.stringify({ t: 'WORLD_SNAPSHOT', d: state.listSnapshot() }));
            broadcast('PLAYER_JOINED', { id, name, color, x: player.x, y: player.y, engageWith: null });
            break;
          }

          case 'MOVE_DIR': {
            const pid = state.sockets.get(ws);
            if (!pid) break;
            const dx = Number(d?.dx || 0), dy = Number(d?.dy || 0);
            state.setMoveDir(pid, dx, dy);
            break;
          }

          case 'ENGAGE_LEAVE': {
            const pid = state.sockets.get(ws);
            if (!pid) break;
            const me = state.players.get(pid);
            const otherId = me?.engageWith;
            if (!otherId) break;
            const other = state.players.get(otherId);
            if (other) other.engageWith = null;
            me.engageWith = null;
            sendTo(pid, 'ENGAGE_END', { with: otherId });
            if (other) sendTo(other.id, 'ENGAGE_END', { with: pid });
            broadcast('ENGAGE_FLAGS_CLEAR', { ids: [pid, otherId].filter(Boolean) });
            break;
          }

          case 'CHAT_SEND': {
            const pid = state.sockets.get(ws);
            if (!pid) break;
            const p = state.players.get(pid);
            const text = String(d?.msg || '').trim().slice(0, 256);
            if (!text) break;
            broadcast('CHAT', { from: { id: p.id, name: p.name, color: p.color }, msg: text });
            break;
          }

          case 'LOOT_PICK': {
            const pid = state.sockets.get(ws);
            if (!pid) break;
            const p = state.players.get(pid);
            const lootId = String(d?.id || '');
            const loot = state.loot.get(lootId);
            if (!loot) break;
            if (dist(p, loot) > CONSTANTS.PICK_RADIUS) {
              sendTo(pid, 'ERROR', { message: 'Too far from loot' });
              break;
            }

            const uid = genItemUid(pid);
            await pool.query('INSERT INTO items (uid, base_type, found_by) VALUES ($1,$2,$3)', [uid, loot.base_type, pid]);
            await pool.query('INSERT INTO inventories (player_id, item_uid) VALUES ($1,$2)', [pid, uid]);

            state.loot.delete(lootId);
            broadcast('LOOT_REMOVE', { id: lootId });
            sendTo(pid, 'INV_ADD', { item: { uid, base_type: loot.base_type } });
            break;
          }

          case 'PING':
            ws.send(JSON.stringify({ t: 'PONG' }));
            break;
        }
      } catch (err) {
        console.error('Handler error', err);
        try { ws.send(JSON.stringify({ t: 'ERROR', d: { message: 'Server error' } })); } catch {}
      }
    });

    ws.on('close', () => {
      const pid = state.sockets.get(ws);
      if (!pid) return;
      const p = state.players.get(pid);
      // clear engagement if any
      if (p?.engageWith) {
        const other = state.players.get(p.engageWith);
        if (other) {
          other.engageWith = null;
          sendTo(other.id, 'ENGAGE_END', { with: pid });
        }
        broadcast('ENGAGE_FLAGS_CLEAR', { ids: [pid, p?.engageWith].filter(Boolean) });
      }
      state.removeSocket(ws);
      if (p) {
        state.removePlayer(pid);
        broadcast('PLAYER_LEFT', { id: pid });
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`Permadeth server on http://localhost:${PORT}`);
    console.log('WebSocket path: /ws');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
