-- ========== BASE TABLES ==========
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2dd4bf',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  password_hash TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  uid TEXT PRIMARY KEY,
  base_type TEXT NOT NULL,
  found_by UUID REFERENCES players(id),
  crafted_by UUID REFERENCES players(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventories (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_uid TEXT NOT NULL REFERENCES items(uid) ON DELETE CASCADE,
  PRIMARY KEY (player_id, item_uid)
);

CREATE TABLE IF NOT EXISTS duels (
  id UUID PRIMARY KEY,
  p1 UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  p2 UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  turn_player UUID,
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

-- ========== DATA CLEANUP BEFORE UNIQUE INDEX ==========
-- If duplicate usernames exist, keep the newest row per name and rename older ones with a short suffix.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT lower(name) AS nm, COUNT(*) c FROM players GROUP BY lower(name) HAVING COUNT(*) > 1
    ) dup
  ) THEN
    WITH ranked AS (
      SELECT id, name, created_at,
             ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY created_at DESC, id) AS rn
      FROM players
    )
    UPDATE players p
    SET name = p.name || '_' || SUBSTRING(p.id::text, 1, 4)
    FROM ranked r
    WHERE p.id = r.id AND r.rn > 1;
  END IF;
END
$$;

-- ========== CASE-INSENSITIVE UNIQUE USERNAME ==========
-- Enforce uniqueness on LOWER(name) so "Bob" and "bob" are considered the same.
CREATE UNIQUE INDEX IF NOT EXISTS players_name_key ON players (lower(name));
