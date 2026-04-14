-- ============================================
-- Tabela de usuários (LOGIN)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    nome TEXT,
    role TEXT NOT NULL DEFAULT 'operador',
    password TEXT NOT NULL
);

-- ============================================
-- DIGESTORES
-- ============================================
CREATE TABLE IF NOT EXISTS digestors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    capacidade_tn REAL DEFAULT 0,
    status TEXT DEFAULT 'idle',
    last_cycle_id INTEGER
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
-- ENTRADAS DE CAMINHÕES (PORTARIA)
-- ============================================
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    truck_plate TEXT NOT NULL,
    toneladas_declared REAL,
    arrival_at TEXT DEFAULT CURRENT_TIMESTAMP,
    portaria_user_id INTEGER,
    status TEXT DEFAULT 'arrived'
);

-- ============================================
-- CICLO DE TRITURAÇÃO
-- ============================================
CREATE TABLE IF NOT EXISTS trituration_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    from_tova_id INTEGER,
    toneladas_solicitadas REAL,
    toneladas_trituradas REAL,
    materia_prima TEXT,
    start_tritura_at TEXT,
    end_tritura_at TEXT,
    status TEXT,
    operator_id INTEGER
);

-- ============================================
-- CICLO DE COZIMENTO
-- ============================================
CREATE TABLE IF NOT EXISTS cooking_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    trituration_id INTEGER,
    start_cook_at TEXT,
    end_cook_at TEXT,
    status TEXT,
    operator_id INTEGER
);

-- ============================================
-- CICLO COMPLETO
-- ============================================
CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    trituration_id INTEGER,
    cooking_id INTEGER,
    started_at TEXT,
    ended_at TEXT,
    status TEXT
);

-- ============================================
-- DESCARGA DO DIGESTOR
-- ============================================
CREATE TABLE IF NOT EXISTS digestor_discharges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    trituration_cycle_id INTEGER,
    cooking_cycle_id INTEGER,
    toneladas_discarded REAL,
    operator_id INTEGER,
    notes TEXT,
    discharged_at TEXT DEFAULT CURRENT_TIMESTAMP
);
