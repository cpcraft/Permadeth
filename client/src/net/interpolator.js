// client/src/net/interpolator.js
// Keeps a short buffer of server snapshots, then renders at now - INTERP_DELAY
// so movement is smooth even if server ticks at 20 Hz.

export class SnapshotBuffer {
  constructor({ delayMs = 100, maxMs = 1000 } = {}) {
    this.delayMs = delayMs;     // render 100ms in the past for stability
    this.maxMs = maxMs;         // keep up to 1s of snapshots
    this.snaps = [];            // [{ts, state:{entities:{id:{x,y,vx,vy}}}}]
  }

  push(snapshot) {
    if (!snapshot || typeof snapshot.ts !== 'number') return;
    this.snaps.push(snapshot);
    const cutoff = performance.now() - this.maxMs;
    // drop old
    while (this.snaps.length && this.snaps[0].ts < cutoff) this.snaps.shift();
  }

  // Returns interpolated entity map for render time
  getInterpolated(now = performance.now()) {
    const renderTs = now - this.delayMs;

    if (this.snaps.length === 0) return { entities: {} };
    if (this.snaps.length === 1) return structuredClone(this.snaps[0].state);

    // find bracketing snapshots around renderTs
    let a = this.snaps[0], b = this.snaps[this.snaps.length - 1];
    for (let i = 0; i < this.snaps.length - 1; i++) {
      const s0 = this.snaps[i], s1 = this.snaps[i + 1];
      if (s0.ts <= renderTs && renderTs <= s1.ts) { a = s0; b = s1; break; }
      if (renderTs < this.snaps[0].ts) { a = b = this.snaps[0]; break; }
      if (renderTs > this.snaps[this.snaps.length - 1].ts) { a = b = this.snaps[this.snaps.length - 1]; break; }
    }

    const out = { entities: {} };
    const dt = Math.max(1, b.ts - a.ts);
    const t = a === b ? 1 : (renderTs - a.ts) / dt;

    // interpolate per-entity (based on presence in either snapshot)
    const ids = new Set([
      ...Object.keys(a.state.entities || {}),
      ...Object.keys(b.state.entities || {}),
    ]);

    ids.forEach(id => {
      const ea = a.state.entities[id];
      const eb = b.state.entities[id];
      if (!ea && eb) { out.entities[id] = { x: eb.x, y: eb.y, r: eb.r, seq: eb.seq }; return; }
      if (ea && !eb) { out.entities[id] = { x: ea.x, y: ea.y, r: ea.r, seq: ea.seq }; return; }
      // lerp x/y, carry rotation (r) if present
      const x = ea.x + (eb.x - ea.x) * t;
      const y = ea.y + (eb.y - ea.y) * t;
      const r = (typeof ea.r === 'number' && typeof eb.r === 'number')
        ? ea.r + (eb.r - ea.r) * t
        : (ea.r ?? eb.r);
      out.entities[id] = { x, y, r, seq: eb.seq ?? ea.seq };
    });

    return out;
  }
}
