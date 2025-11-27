PRAGMA foreign_keys = ON;

-- ============================================
-- TABELA: usuários (operador / admin / portaria)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT UNIQUE,
  senha_hash TEXT,
  role TEXT NOT NULL CHECK(role IN ('portaria','operador','admin')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Tabelas de Frota e Veículos
-- ============================================
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
  FOREIGN KEY (fleet_id) REFERENCES fleets(id)
);

-- ============================================
-- Chegada de Caminhões (PORTARIA)
-- ============================================
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  truck_plate TEXT,
  toneladas_declared REAL NOT NULL,
  arrival_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  portaria_user_id INTEGER,
  status TEXT DEFAULT 'registered'
    CHECK(status IN ('registered','in_reception','reception_finished','cancelled')),
  FOREIGN KEY (portaria_user_id) REFERENCES users(id)
);

-- ============================================
-- TOVAS
-- ============================================
CREATE TABLE IF NOT EXISTS tovas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  capacidade_tn REAL DEFAULT 0,
  current_tn REAL DEFAULT 0
);

-- ============================================
-- DIGESTORES
-- ============================================
CREATE TABLE IF NOT EXISTS digestors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  capacidade_tn REAL DEFAULT 0,
  status TEXT DEFAULT 'idle'
    CHECK(status IN ('idle','loading','triturating','cooking','waiting_discharge','maintenance')),
  last_cycle_id INTEGER
);

-- ============================================
-- TRITURAÇÃO
-- ============================================
CREATE TABLE IF NOT EXISTS trituration_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digestor_id INTEGER NOT NULL,
  from_tova_id INTEGER,
  toneladas_solicitadas REAL,
  start_tritura_at DATETIME,
  end_tritura_at DATETIME,
  toneladas_trituradas REAL,
  status TEXT DEFAULT 'created'
    CHECK(status IN ('created','started','finished','interrupted','cancelled')),
  operator_id INTEGER,
  FOREIGN KEY (digestor_id) REFERENCES digestors(id),
  FOREIGN KEY (from_tova_id) REFERENCES tovas(id),
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

-- ============================================
-- COZIMENTO
-- ============================================
CREATE TABLE IF NOT EXISTS cooking_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trituration_cycle_id INTEGER NOT NULL,
  digestor_id INTEGER NOT NULL,
  start_cook_at DATETIME,
  end_cook_at DATETIME,
  operator_id INTEGER,
  status TEXT DEFAULT 'created'
    CHECK(status IN ('created','started','finished','interrupted','cancelled')),
  FOREIGN KEY (trituration_cycle_id) REFERENCES trituration_cycles(id),
  FOREIGN KEY (digestor_id) REFERENCES digestors(id),
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

-- ============================================
-- CICLOS PRINCIPAIS (cada carga completa)
-- ============================================
CREATE TABLE IF NOT EXISTS cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digestor_id INTEGER,
  trituration_id INTEGER,
  cooking_id INTEGER,
  status TEXT DEFAULT 'in_progress'
    CHECK(status IN ('in_progress','finished','cancelled')),
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  FOREIGN KEY (digestor_id) REFERENCES digestors(id),
  FOREIGN KEY (trituration_id) REFERENCES trituration_cycles(id),
  FOREIGN KEY (cooking_id) REFERENCES cooking_cycles(id)
);

-- ============================================
-- DESCARGA FINAL DO DIGESTOR
-- ============================================
CREATE TABLE IF NOT EXISTS digestor_discharges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digestor_id INTEGER NOT NULL,
  trituration_cycle_id INTEGER,
  cooking_cycle_id INTEGER,
  discharged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  toneladas_discarded REAL,
  operator_id INTEGER,
  notes TEXT,
  FOREIGN KEY (digestor_id) REFERENCES digestors(id)
);

-- ============================================
-- TRIGGERS automáticos
-- ============================================

-- Quando FINALIZA TRITURAÇÃO → cria cozinhar
CREATE TRIGGER IF NOT EXISTS trg_trit_finish
AFTER UPDATE ON trituration_cycles
WHEN NEW.status='finished'
BEGIN
  INSERT INTO cooking_cycles (trituration_cycle_id, digestor_id, start_cook_at, status, operator_id)
  VALUES (NEW.id, NEW.digestor_id, NEW.end_tritura_at, 'started', NEW.operator_id);

  UPDATE digestors SET status='cooking' WHERE id=NEW.digestor_id;

  INSERT INTO cycles (digestor_id, trituration_id, status, started_at)
  VALUES (NEW.digestor_id, NEW.id, 'in_progress', NEW.start_tritura_at);
END;

-- Quando FINALIZA COZIMENTO → finaliza ciclo
CREATE TRIGGER IF NOT EXISTS trg_cook_finish
AFTER UPDATE ON cooking_cycles
WHEN NEW.status='finished'
BEGIN
  UPDATE digestors SET status='waiting_discharge' WHERE id=NEW.digestor_id;

  UPDATE cycles
  SET cooking_id = NEW.id,
      ended_at = NEW.end_cook_at,
      status = 'finished'
  WHERE trituration_id = NEW.trituration_cycle_id AND status='in_progress';
END;

-- ============================================
-- SEEDS INICIAIS
-- ============================================

INSERT INTO users (nome, role) VALUES ('Portaria', 'portaria');
INSERT INTO users (nome, role) VALUES ('Operador A', 'operador');
INSERT INTO users (nome, role) VALUES ('Admin', 'admin');

INSERT INTO tovas (nome, capacidade_tn, current_tn) VALUES ('Tova 1', 100, 20);
INSERT INTO tovas (nome, capacidade_tn, current_tn) VALUES ('Tova 2', 90, 10);

INSERT INTO digestors(nome, capacidade_tn) VALUES ('Digestor 1', 20);
INSERT INTO digestors(nome, capacidade_tn) VALUES ('Digestor 2', 20);
INSERT INTO digestors(nome, capacidade_tn) VALUES ('Digestor 3', 25);
INSERT INTO digestors(nome, capacidade_tn) VALUES ('Digestor 4', 25);
