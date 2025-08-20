export const TICK_MS = 50;              // 20 Hz
export const SPEED = 220;               // px/s
export const WORLD_TILES = 1000;
export const TILE_SIZE = 64;
export const WORLD_SIZE = WORLD_TILES * TILE_SIZE;
export const TOUCH_RADIUS = 32;         // px

export const ALLOWED_OPS = new Set([
  "JOIN", "MOVE_TARGET", "CHAT_SEND", "ENGAGE_LEAVE", "PING"
]);
export const MAX_MSG_BYTES = 2048;
export const MAX_MSG_RATE = 50; // msgs / sec

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

export class GameState {
  constructor() {
    this.players = new Map(); // id -> {id,name,color,x,y,target?,engageWith?}
    this.lastTick = Date.now();
  }

  addPlayer(p) { this.players.set(p.id, p); }
  removePlayer(id) { this.players.delete(id); }

  setMoveTarget(id, x, y) {
    const p = this.players.get(id);
    if (!p) return;
    p.target = { x: clamp(x, 0, WORLD_SIZE), y: clamp(y, 0, WORLD_SIZE) };
  }

  leaveEngagement(id) {
    const p = this.players.get(id);
    if (!p) return;
    const otherId = p.engageWith;
    p.engageWith = null;
    if (otherId && this.players.has(otherId)) {
      this.players.get(otherId).engageWith = null;
    }
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(200, now - this.lastTick) / 1000;
    this.lastTick = now;

    // Move
    for (const p of this.players.values()) {
      if (!p.target || p.engageWith) continue;
      const dx = p.target.x - p.x;
      const dy = p.target.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) continue;
      const step = SPEED * dt;
      const nx = p.x + dx / (d || 1) * step;
      const ny = p.y + dy / (d || 1) * step;
      p.x = clamp(nx, 0, WORLD_SIZE);
      p.y = clamp(ny, 0, WORLD_SIZE);
    }

    // Touch detection
    const arr = Array.from(this.players.values());
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (a.engageWith) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (b.engageWith) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d <= TOUCH_RADIUS) {
          a.engageWith = b.id;
          b.engageWith = a.id;
        }
      }
    }
  }

  snapshot() {
    return {
      players: Array.from(this.players.values()).map(p => ({
        id: p.id, name: p.name, color: p.color,
        x: Math.round(p.x), y: Math.round(p.y),
        engageWith: p.engageWith || null
      })),
      constants: { TICK_MS, SPEED, WORLD_TILES, TILE_SIZE, WORLD_SIZE, TOUCH_RADIUS }
    };
  }
}
