import crypto from 'crypto';

export const ALLOWED_OPS = new Set([
  'JOIN', 'MOVE_DIR', 'CHAT_SEND', 'LOOT_PICK', 'DUEL_REQUEST', 'DUEL_ACCEPT', 'DUEL_ACTION', 'PING'
]);

export const MAX_MSG_BYTES = 2048;
export const MAX_MSG_RATE = 50;

// ---- WORLD ----
export const WORLD_TILES = 1000;
export const TILE_SIZE = 64;                 // px per tile
const WORLD_SIZE = WORLD_TILES * TILE_SIZE;  // 64,000 px

const SPEED = 220;        // px/s
const TICK_MS = 50;       // 20Hz
const LOOT_RADIUS = 40;
const PICK_RADIUS = 48;

export class GameState {
  constructor() {
    this.players = new Map(); // playerId -> {id,name,color,x,y,dir:{x,y},ws,duelId}
    this.sockets = new Map(); // ws -> playerId
    this.loot = new Map();    // lootId -> {id,x,y,base_type}
    this.duels = new Map();   // duelId -> Duel
  }

  addSocket(ws, playerId) {
    this.sockets.set(ws, playerId);
    const p = this.players.get(playerId);
    if (p) p.ws = ws;
  }

  removeSocket(ws) {
    const pid = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (!pid) return;
    const p = this.players.get(pid);
    if (p) p.ws = null;
  }

  addPlayer(player) {
    this.players.set(player.id, player);
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
  }

  spawnInitialLoot(count = 400) {
    for (let i = 0; i < count; i++) {
      const id = crypto.randomUUID();
      this.loot.set(id, {
        id,
        x: Math.floor(Math.random() * WORLD_SIZE),
        y: Math.floor(Math.random() * WORLD_SIZE),
        base_type: Math.random() < 0.5 ? 'herb' : 'ore_iron'
      });
    }
  }

  listSnapshot() {
    return {
      players: Array.from(this.players.values()).map(p => ({
        id: p.id, name: p.name, color: p.color, x: p.x, y: p.y
      })),
      loot: Array.from(this.loot.values())
    };
  }

  setMoveDir(playerId, dx, dy) {
    const p = this.players.get(playerId);
    if (!p || p.duelId) return; // locked during duel
    const len = Math.hypot(dx, dy) || 1;
    p.dir = { x: dx / len, y: dy / len };
  }

  tick(dt) {
    for (const p of this.players.values()) {
      if (p.duelId) continue;
      const nx = p.x + p.dir.x * SPEED * dt;
      const ny = p.y + p.dir.y * SPEED * dt;
      p.x = Math.max(0, Math.min(WORLD_SIZE, nx));
      p.y = Math.max(0, Math.min(WORLD_SIZE, ny));
    }
  }
}

// Token bucket per socket
export function makeRateLimiter() {
  return {
    tokens: MAX_MSG_RATE,
    last: Date.now(),
    take(n = 1) {
      const now = Date.now();
      const elapsed = (now - this.last) / 1000;
      this.last = now;
      this.tokens = Math.min(MAX_MSG_RATE, this.tokens + elapsed * MAX_MSG_RATE);
      if (this.tokens >= n) {
        this.tokens -= n;
        return true;
      }
      return false;
    }
  };
}

// Helpers
export function genItemUid(finderId) {
  const n = crypto.randomInt(0, 10_000_000_000);
  return `${finderId}-${n.toString().padStart(10, '0')}`;
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const CONSTANTS = {
  TICK_MS,
  SPEED,
  WORLD_TILES,
  TILE_SIZE,
  WORLD_SIZE,
  LOOT_RADIUS,
  PICK_RADIUS
};
