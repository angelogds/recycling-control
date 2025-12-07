-- ============================================================
-- BANCO DE DADOS COMPLETO — SISTEMA CAMPO DO GADO
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================
-- TABELA DE USUÁRIOS
-- ============================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    nome TEXT,
    role TEXT NOT NULL DEFAULT 'operador',
    password TEXT NOT NULL
);

-- ============================
-- DIGESTORES
-- ============================
CREATE TABLE IF NOT EXISTS digestors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    capacidade_tn REAL DEFAULT 0,
    status TEXT DEFAULT 'idle',
    last_cycle_id INTEGER
);

-- ============================
-- TOVAS
-- ============================
CREATE TABLE IF NOT EXISTS tovas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    capacidade_tn REAL DEFAULT 0,
    current_tn REAL DEFAULT 0
);

-- ============================
-- ENTRADAS (PORTARIA)
-- ============================
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    truck_plate TEXT NOT NULL,
    toneladas_declared REAL DEFAULT 0,
    toneladas_confirmed REAL,
    portaria_user_id INTEGER,
    status TEXT DEFAULT 'waiting',
    arrival_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================
-- CICLO PRINCIPAL
-- ============================
CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    trituration_id INTEGER,
    cooking_id INTEGER,
    started_at TEXT,
    ended_at TEXT,
    status TEXT DEFAULT 'in_progress',
    FOREIGN KEY (digestor_id) REFERENCES digestors(id)
);

-- ============================
-- TRITURAÇÃO
-- ============================
CREATE TABLE IF NOT EXISTS trituration_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    from_tova_id INTEGER,
    toneladas_solicitadas REAL DEFAULT 0,
    toneladas_trituradas REAL,
    materia_prima TEXT,
    start_tritura_at TEXT,
    end_tritura_at TEXT,
    status TEXT DEFAULT 'created',
    operator_id INTEGER,
    FOREIGN KEY (digestor_id) REFERENCES digestors(id),
    FOREIGN KEY (from_tova_id) REFERENCES tovas(id)
);

-- ============================
-- COZIMENTO
-- ============================
CREATE TABLE IF NOT EXISTS cooking_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    trituration_id INTEGER,
    start_cook_at TEXT,
    end_cook_at TEXT,
    status TEXT DEFAULT 'created',
    operator_id INTEGER,
    FOREIGN KEY (digestor_id) REFERENCES digestors(id),
    FOREIGN KEY (trituration_id) REFERENCES trituration_cycles(id)
);

-- ============================
-- DESCARGA DO DIGESTOR
-- ============================
CREATE TABLE IF NOT EXISTS digestor_discharges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    trituration_cycle_id INTEGER,
    cooking_cycle_id INTEGER,
    toneladas_discarded REAL DEFAULT 0,
    operator_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (digestor_id) REFERENCES digestors(id)
);

-- ============================
-- SEED — DIGESTORES PADRÃO
-- ============================
INSERT INTO digestors (nome, capacidade_tn, status)
VALUES
('Digestor 1', 12, 'idle'),
('Digestor 2', 12, 'idle'),
('Digestor 3', 12, 'idle'),
('Digestor 4', 12, 'idle');

-- ============================
-- SEED — TOVAS PADRÃO
-- ============================
INSERT INTO tovas (nome, capacidade_tn, current_tn)
VALUES
('Tova 1', 20, 0),
('Tova 2', 20, 0),
('Tova 3', 20, 0);
