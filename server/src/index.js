import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

import { pool, initSchema } from './db.js';
import { Duel } from './duel.js';
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

  function broadcast(type, d) {
    const msg = JSON.stringify({ t: type, d });
    for (const pid of state.players.keys()) {
      const p = state.players.get(pid);
      if (p?.ws && p.ws.readyState === 1) p.ws.send(msg);
    }
  }
  function sendTo(pid, type, d) {
    const p = state.players.get(pid);
    if (!p?.ws || p.ws.readyState !== 1) return;
    p.ws.send(JSON.stringify({ t: type, d }));
  }

  setInterval(() => {
    state.tick(CONSTANTS.TICK_MS / 1000);
    const payload = Array.from(state.players.values()).map(p => ({ id: p.id, x: p.x, y: p.y }));
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

            const player = {
              id, name, color,
              x: Math.random() * CONSTANTS.WORLD_SIZE,
              y: Math.random() * CONSTANTS.WORLD_SIZE,
              dir: { x: 0, y: 0 },
              ws, duelId: null
            };
            state.addPlayer(player);
            state.addSocket(ws, id);

            ws.send(JSON.stringify({ t: 'WELCOME', d: { id, constants: CONSTANTS } }));
            ws.send(JSON.stringify({ t: 'WORLD_SNAPSHOT', d: state.listSnapshot() }));
            broadcast('PLAYER_JOINED', { id, name, color, x: player.x, y: player.y });
            break;
          }

          case 'MOVE_DIR': {
            const pid = state.sockets.get(ws);
            if (!pid) break;
            const dx = Number(d?.dx || 0), dy = Number(d?.dy || 0);
            state.setMoveDir(pid, dx, dy);
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

          case 'DUEL_REQUEST': {
            const pid = state.sockets.get(ws);
            const targetId = String(d?.targetId || '');
            if (!pid || !state.players.has(targetId)) break;
            const me = state.players.get(pid);
            const target = state.players.get(targetId);
            if (me.duelId || target.duelId) { sendTo(pid, 'ERROR', { message: 'Already in duel' }); break; }

            const duel = new Duel(pid, targetId);
            state.duels.set(duel.id, duel);
            sendTo(targetId, 'DUEL_INVITE', { fromPlayerId: pid, duelId: duel.id });
            break;
          }

          case 'DUEL_ACCEPT': {
            const pid = state.sockets.get(ws);
            const duelId = String(d?.duelId || '');
            const duel = state.duels.get(duelId);
            if (!duel || duel.state !== 'pending') break;
            if (duel.p2 !== pid) break;

            const p1 = state.players.get(duel.p1);
            const p2 = state.players.get(duel.p2);
            p1.duelId = duel.id; p1.dir = { x: 0, y: 0 };
            p2.duelId = duel.id; p2.dir = { x: 0, y: 0 };

            const first = Math.random() < 0.5 ? duel.p1 : duel.p2;
            duel.start(first);

            await pool.query(
              'INSERT INTO duels (id,p1,p2,state,turn_player) VALUES ($1,$2,$3,$4,$5)',
              [duel.id, duel.p1, duel.p2, 'active', duel.turn]
            );

            sendTo(duel.p1, 'DUEL_START', { duelId: duel.id, p1: duel.p1, p2: duel.p2, turn: duel.turn, hp: duel.hp });
            sendTo(duel.p2, 'DUEL_START', { duelId: duel.id, p1: duel.p1, p2: duel.p2, turn: duel.turn, hp: duel.hp });
            break;
          }

          case 'DUEL_ACTION': {
            const pid = state.sockets.get(ws);
            const duelId = String(d?.duelId || '');
            const act = String(d?.action || '');
            const duel = state.duels.get(duelId);
            if (!duel || duel.state !== 'active') break;
            if (duel.turn !== pid) { sendTo(pid, 'ERROR', { message: 'Not your turn' }); break; }
            if (!['strike', 'block', 'heal', 'flee'].includes(act)) { sendTo(pid, 'ERROR', { message: 'Invalid action' }); break; }

            const result = duel.action(pid, act);
            if (result.error) { sendTo(pid, 'ERROR', { message: result.error }); break; }

            await pool.query(
              'INSERT INTO turns (duel_id, turn_no, actor, action) VALUES ($1,$2,$3,$4)',
              [duel.id, duel.turnNo, pid, JSON.stringify({ act, result })]
            );

            await pool.query(
              'UPDATE duels SET turn_player=$2, p1_hp=$3, p2_hp=$4, state=$5, winner=$6, ended_at=CASE WHEN $5 = \'ended\' THEN now() ELSE ended_at END WHERE id=$1',
              [duel.id, duel.turn, duel.hp[duel.p1], duel.hp[duel.p2], duel.state, duel.winner() || null]
            );

            const payload = { duelId: duel.id, hp: duel.hp, turn: duel.turn, lastAction: { actor: pid, act, result } };
            sendTo(duel.p1, 'DUEL_UPDATE', payload);
            sendTo(duel.p2, 'DUEL_UPDATE', payload);

            if (duel.state === 'ended') {
              const w = duel.winner();
              sendTo(duel.p1, 'DUEL_END', { duelId: duel.id, winner: w });
              sendTo(duel.p2, 'DUEL_END', { duelId: duel.id, winner: w });
              const p1 = state.players.get(duel.p1);
              const p2 = state.players.get(duel.p2);
              if (p1) p1.duelId = null;
              if (p2) p2.duelId = null;
            }
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
      state.removeSocket(ws);
      const p = state.players.get(pid);
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
