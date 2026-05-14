CREATE TABLE IF NOT EXISTS runes (
  rune_id INTEGER PRIMARY KEY,
  style_id INTEGER NOT NULL,
  style_name TEXT NOT NULL,
  rune_key TEXT,
  name TEXT NOT NULL,
  icon TEXT,
  patch TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS summoner_spells (
  spell_id INTEGER PRIMARY KEY,
  spell_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  patch TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_runes_patch_style
  ON runes(patch, style_id);

CREATE INDEX IF NOT EXISTS idx_summoner_spells_patch
  ON summoner_spells(patch);
