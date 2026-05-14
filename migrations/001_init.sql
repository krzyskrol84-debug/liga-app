CREATE TABLE IF NOT EXISTS patches (
  version TEXT PRIMARY KEY,
  is_current INTEGER NOT NULL DEFAULT 0,
  released_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS champions (
  champion_id INTEGER PRIMARY KEY,
  champion_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  title TEXT,
  roles_json TEXT NOT NULL DEFAULT '[]',
  image_url TEXT,
  patch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patch) REFERENCES patches(version)
);

CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  champion_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('top', 'jungle', 'middle', 'bottom', 'utility')),
  primary_style TEXT NOT NULL,
  sub_style TEXT NOT NULL,
  selected_perk_ids_json TEXT NOT NULL,
  summoner_spell_ids_json TEXT NOT NULL,
  win_rate REAL NOT NULL,
  pick_rate REAL NOT NULL,
  games_count INTEGER NOT NULL,
  patch TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (champion_id, role, patch),
  FOREIGN KEY (champion_id) REFERENCES champions(champion_id) ON DELETE CASCADE,
  FOREIGN KEY (patch) REFERENCES patches(version)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'json',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  champion_id INTEGER,
  champion_name TEXT NOT NULL,
  role TEXT NOT NULL,
  patch TEXT NOT NULL,
  action TEXT NOT NULL,
  success INTEGER NOT NULL,
  message TEXT,
  recommendation_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (champion_id) REFERENCES champions(champion_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_recommendations_champion_role
  ON recommendations(champion_id, role);

CREATE INDEX IF NOT EXISTS idx_recommendations_patch
  ON recommendations(patch);

CREATE INDEX IF NOT EXISTS idx_history_created_at
  ON history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_history_champion_role
  ON history(champion_name, role);
