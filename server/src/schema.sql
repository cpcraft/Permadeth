-- Players & sessions
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Simple auth/session token if you later want persistence across reconnects
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Items: unique *instances* found or crafted. UID = playerId + "-" + 10 digits
CREATE TABLE IF NOT EXISTS items (
  uid TEXT PRIMARY KEY,
  base_type TEXT NOT NULL,   -- e.g., "sword_wood", "herb", "ore_iron"
  found_by UUID REFERENCES players(id),
  crafted_by UUID REFERENCES players(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inventory: who currently holds which item
CREATE TABLE IF NOT EXISTS inventories (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_uid TEXT NOT NULL REFERENCES items(uid) ON DELETE CASCADE,
  PRIMARY KEY (player_id, item_uid)
);

-- Duels & turns
CREATE TABLE IF NOT EXISTS duels (
  id UUID PRIMARY KEY,
  p1 UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  p2 UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  state TEXT NOT NULL,             -- "pending" | "active" | "ended"
  turn_player UUID,                -- whose turn it is when active
  p1_hp SMALLINT NOT NULL DEFAULT 100,
  p2_hp SMALLINT NOT NULL DEFAULT 100,
  winner UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS turns (
  duel_id UUID NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  turn_no INT NOT NULL,
  actor UUID NOT NULL REFERENCES players(id),
  action JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (duel_id, turn_no)
);
