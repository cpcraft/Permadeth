// server/broadcastState.js
// Called on each physics tick (~20 Hz)
let seq = 0;

export function makeStatePayload(world, perPlayerSeqMap = null) {
  // world.entities: Map/obj of {id:{x,y,r}}
  const entities = {};
  for (const [id, e] of world.entities) {
    entities[id] = { x: Math.round(e.x * 100) / 100, y: Math.round(e.y * 100) / 100, r: e.r ?? 0, seq: e.seqAck ?? 0 };
  }
  const ts = Date.now(); // or performance.timeOrigin+performance.now() mirrored
  seq++;

  const base = { op: 'STATE', ts, entities, seq };
  if (perPlayerSeqMap) base.seqFor = perPlayerSeqMap; // e.g., { [playerId]: lastProcessedClientSeq }
  return base;
}
