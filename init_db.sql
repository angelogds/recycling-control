-- init_db.sql
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  nome TEXT,
  role TEXT,
  password TEXT
);

CREATE TABLE IF NOT EXISTS digestors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  capacidade_tn REAL,
  status TEXT DEFAULT 'idle',
  last_cycle_id INTEGER
);

CREATE TABLE IF NOT EXISTS tovas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  capacidade_tn REAL,
  current_tn REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  truck_plate TEXT,
  toneladas_declared REAL,
  arrival_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'arrived',
  portaria_user_id INTEGER
);

CREATE TABLE IF NOT EXISTS trituration_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digestor_id INTEGER,
  from_tova_id INTEGER,
  toneladas_solicitadas REAL,
  start_tritura_at TEXT,
  end_tritura_at TEXT,
  toneladas_trituradas REAL,
  status TEXT DEFAULT 'created',
  operator_id INTEGER
);

CREATE TABLE IF NOT EXISTS cooking_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digestor_id INTEGER,
  trituration_id INTEGER,
  start_cook_at TEXT,
  end_cook_at TEXT,
  status TEXT DEFAULT 'created',
  operator_id INTEGER
);

CREATE TABLE IF NOT EXISTS cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digestor_id INTEGER,
  trituration_id INTEGER,
  cooking_id INTEGER,
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  status TEXT DEFAULT 'in_progress'
);

CREATE TABLE IF NOT EXISTS digestor_discharges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digestor_id INTEGER,
  trituration_cycle_id INTEGER,
  cooking_cycle_id INTEGER,
  toneladas_discarded REAL,
  operator_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- seed minimal
INSERT INTO users (username, nome, role) VALUES ('operador','Operador A','operador');
INSERT INTO digestors (nome, capacidade_tn, status) VALUES ('Digestor 1',20,'idle'),('Digestor 2',20,'idle'),('Digestor 3',25,'idle'),('Digestor 4',25,'idle');
INSERT INTO tovas (nome, capacidade_tn, current_tn) VALUES ('Tova 1',100,0),('Tova 2',100,0);

COMMIT;
