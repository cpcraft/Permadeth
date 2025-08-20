// client/src/net/localPrediction.js
// Predicts your own movement immediately on click-to-move, then reconciles when an
// authoritative snapshot with seq >= last applied arrives.

export class LocalPredictor {
  constructor(playerId) {
    this.playerId = playerId;
    this.pendingInputs = []; // [{seq, targetX, targetY, t0}]
    this.lastAckSeq = 0;     // server authoritative seq we’ve matched
  }

  // call when user clicks somewhere
  queueMove(seq, targetX, targetY) {
    this.pendingInputs.push({ seq, targetX, targetY, t0: performance.now() });
  }

  // apply prediction on the client state BEFORE rendering
  // speedPxPerSec should match server speed (e.g., 220)
  predict(currentPos, speedPxPerSec) {
    if (!currentPos) return currentPos;
    if (this.pendingInputs.length === 0) return currentPos;

    const last = this.pendingInputs[this.pendingInputs.length - 1];
    // Predict toward the LAST target (basic click-to-move)
    const now = performance.now();
    const dt = (now - (last._lastTime || last.t0)) / 1000;
    last._lastTime = now;

    const dx = last.targetX - currentPos.x;
    const dy = last.targetY - currentPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return currentPos;

    const step = speedPxPerSec * dt;
    const nx = currentPos.x + (dx / dist) * Math.min(step, dist);
    const ny = currentPos.y + (dy / dist) * Math.min(step, dist);

    return { ...currentPos, x: nx, y: ny };
  }

  // call when server snapshot arrives to drop confirmed inputs
  ack(seq) {
    this.lastAckSeq = Math.max(this.lastAckSeq, seq || 0);
    while (this.pendingInputs.length && this.pendingInputs[0].seq <= this.lastAckSeq) {
      this.pendingInputs.shift();
    }
  }
}
