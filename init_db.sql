PRAGMA foreign_keys = ON;

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT UNIQUE,
  senha_hash TEXT,
  role TEXT NOT NULL CHECK(role IN ('portaria','operador','admin')),
  foto TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fleets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  identificador TEXT,
  contato TEXT
);

CREATE TABLE IF NOT EXISTS trucks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  placa TEXT UNIQUE,
  fleet_id INTEGER,
  observacoes TEXT,
  FOREIGN KEY (fleet_id) REFERENCES fleets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  truck_id INTEGER,
  truck_plate TEXT,
  fleet_id INTEGER,
  toneladas_declared REAL NOT NULL,
  arrival_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  portaria_user_id INTEGER,
  arrival_photo TEXT,
  status TEXT DEFAULT 'registered' CHECK(status IN ('registered','in_reception','reception_finished','cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (truck_id) REFERENCES trucks(id) ON DELETE SET NULL,
  FOREIGN KEY (fleet_id) REFERENCES fleets(id) ON DELETE SET NULL,
  FOREIGN KEY (portaria_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tovas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  capacidade_tn REAL DEFAULT 0,
  current_tn REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reception_loads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  tova_id INTEGER NOT NULL,
  start_at DATETIME,
  end_at DATETIME,
  toneladas REAL,
  operator_id INTEGER,
  photo TEXT,
  status TEXT DEFAULT 'started' CHECK(status IN ('started','finished','cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (tova_id) REFERENCES tovas(id) ON DELETE RESTRICT,
  FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS digestors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  capacidade_tn REAL DEFAULT 0,
  status TEXT DEFAULT 'idle' CHECK(status IN ('idle','loading','triturating','cooking','waiting_discharge','maintenance')),
  last_cycle_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trituration_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reception_load_id INTEGER,
  from_tova_id INTEGER,
  digestor_id INTEGER NOT NULL,
  toneladas_solicitadas REAL,
  start_tritura_at DATETIME,
  end_tritura_at DATETIME,
  toneladas_trituradas REAL,
  operator_id INTEGER,
  status TEXT DEFAULT 'created' CHECK(status IN ('created','started','finished','interrupted','cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reception_load_id) REFERENCES reception_loads(id) ON DELETE SET NULL,
  FOREIGN KEY (from_tova_id) REFERENCES tovas(id) ON DELETE SET NULL,
  FOREIGN KEY (digestor_id) REFERENCES digestors(id) ON DELETE RESTRICT,
  FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS cooking_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trituration_cycle_id INTEGER NOT NULL,
  digestor_id INTEGER NOT NULL,
  start_cook_at DATETIME,
  end_cook_at DATETIME,
  operator_id INTEGER,
  notes TEXT,
  status TEXT DEFAULT 'created' CHECK(status IN ('created','started','finished','interrupted','cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trituration_cycle_id) REFERENCES trituration_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (digestor_id) REFERENCES digestors(id) ON DELETE RESTRICT,
  FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER,
  reception_load_id INTEGER,
  trituration_id INTEGER,
  cooking_id INTEGER,
  digestor_id INTEGER,
  status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress','finished','cancelled')),
  started_at DATETIME,
  ended_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL,
  FOREIGN KEY (reception_load_id) REFERENCES reception_loads(id) ON DELETE SET NULL,
  FOREIGN KEY (trituration_id) REFERENCES trituration_cycles(id) ON DELETE SET NULL,
  FOREIGN KEY (cooking_id) REFERENCES cooking_cycles(id) ON DELETE SET NULL,
  FOREIGN KEY (digestor_id) REFERENCES digestors(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shift_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  shift_start DATETIME,
  shift_end DATETIME,
  signature_image TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_type TEXT,
  ref_id INTEGER,
  path TEXT,
  uploaded_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS digestor_discharges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digestor_id INTEGER NOT NULL,
  trituration_cycle_id INTEGER,
  cooking_cycle_id INTEGER,
  discharged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  toneladas_discarded REAL,
  operator_id INTEGER,
  notes TEXT,
  FOREIGN KEY (digestor_id) REFERENCES digestors(id),
  FOREIGN KEY (trituration_cycle_id) REFERENCES trituration_cycles(id),
  FOREIGN KEY (cooking_cycle_id) REFERENCES cooking_cycles(id),
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
CREATE INDEX IF NOT EXISTS idx_reception_tova ON reception_loads(tova_id);
CREATE INDEX IF NOT EXISTS idx_tritura_digestor ON trituration_cycles(digestor_id);
CREATE INDEX IF NOT EXISTS idx_cooking_tritura ON cooking_cycles(trituration_cycle_id);
CREATE INDEX IF NOT EXISTS idx_cycles_digestor ON cycles(digestor_id);

-- TRIGGERS (simplificados)
CREATE TRIGGER IF NOT EXISTS trg_reception_after_finish
AFTER UPDATE ON reception_loads
WHEN NEW.status = 'finished' AND (OLD.status IS NULL OR OLD.status != 'finished')
BEGIN
  UPDATE tovas
    SET current_tn = COALESCE(current_tn,0) + COALESCE(NEW.toneladas,0)
    WHERE id = NEW.tova_id;
  INSERT INTO audit_logs(user_id, action, details) VALUES (NEW.operator_id, 'reception_finished', 'reception_id=' || NEW.id || ' toneladas=' || NEW.toneladas);
END;

CREATE TRIGGER IF NOT EXISTS trg_tritura_start_decrement_tova
AFTER INSERT ON trituration_cycles
WHEN NEW.start_tritura_at IS NOT NULL AND NEW.toneladas_solicitadas IS NOT NULL
BEGIN
  UPDATE tovas
    SET current_tn = current_tn - COALESCE(NEW.toneladas_solicitadas,0)
    WHERE id = NEW.from_tova_id;

  UPDATE digestors SET status = 'triturating' WHERE id = NEW.digestor_id;

  INSERT INTO cycles(entry_id, reception_load_id, trituration_id, digestor_id, status, started_at, created_at)
    VALUES (NEW.reception_load_id, NEW.reception_load_id, NEW.id, NEW.digestor_id, 'in_progress', NEW.start_tritura_at, CURRENT_TIMESTAMP);

  INSERT INTO audit_logs(user_id, action, details) VALUES (NEW.operator_id, 'tritura_started', 'tritura_id=' || NEW.id || ' digestor=' || NEW.digestor_id || ' toneladas=' || NEW.toneladas_solicitadas);
END;

CREATE TRIGGER IF NOT EXISTS trg_tritura_finish_create_cook
AFTER UPDATE ON trituration_cycles
WHEN NEW.status = 'finished' AND NEW.end_tritura_at IS NOT NULL
BEGIN
  INSERT INTO cooking_cycles(trituration_cycle_id, digestor_id, start_cook_at, status, created_at, operator_id)
    VALUES (NEW.id, NEW.digestor_id, NEW.end_tritura_at, 'started', CURRENT_TIMESTAMP, NEW.operator_id);

  UPDATE digestors SET status = 'cooking', last_cycle_id = (SELECT id FROM cycles WHERE trituration_id = NEW.id LIMIT 1) WHERE id = NEW.digestor_id;

  INSERT INTO audit_logs(user_id, action, details) VALUES (NEW.operator_id, 'tritura_finished', 'tritura_id=' || NEW.id || ' created_cooking_for_tritura=' || NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS trg_cooking_finish
AFTER UPDATE ON cooking_cycles
WHEN NEW.status = 'finished' AND NEW.end_cook_at IS NOT NULL
BEGIN
  UPDATE digestors SET status = 'waiting_discharge' WHERE id = NEW.digestor_id;

  UPDATE cycles
    SET ended_at = NEW.end_cook_at,
        status = 'finished',
        cooking_id = NEW.id
    WHERE trituration_id = NEW.trituration_cycle_id AND status != 'finished';

  INSERT INTO audit_logs(user_id, action, details) VALUES (NEW.operator_id, 'cooking_finished', 'cooking_id=' || NEW.id || ' digestor=' || NEW.digestor_id);
END;

-- SEEDS (exemplo)
INSERT INTO users(nome,email,senha_hash,role) VALUES ('Portaria','portaria@empresa.local','<hash>','portaria');
INSERT INTO users(nome,email,senha_hash,role) VALUES ('Operador A','opA@empresa.local','<hash>','operador');
INSERT INTO users(nome,email,senha_hash,role) VALUES ('Admin','admin@empresa.local','<hash>','admin');

INSERT INTO tovas(nome,capacidade_tn,current_tn) VALUES ('Tova Recepção 1', 100.0, 50.0);
INSERT INTO tovas(nome,capacidade_tn,current_tn) VALUES ('Tova Recepção 2', 80.0, 20.0);

INSERT INTO digestors(nome,capacidade_tn,status) VALUES ('Digestor 1', 20.0, 'idle');
INSERT INTO digestors(nome,capacidade_tn,status) VALUES ('Digestor 2', 25.0, 'idle');
INSERT INTO digestors(nome,capacidade_tn,status) VALUES ('Digestor 3', 30.0, 'idle');
INSERT INTO digestors(nome,capacidade_tn,status) VALUES ('Digestor 4', 30.0, 'idle');
