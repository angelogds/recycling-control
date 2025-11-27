DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS digestors;
DROP TABLE IF EXISTS tovas;
DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS cycles;
DROP TABLE IF EXISTS trituration_cycles;
DROP TABLE IF EXISTS cooking_cycles;
DROP TABLE IF EXISTS digestor_discharges;

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    role TEXT NOT NULL
);

CREATE TABLE digestors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    capacidade_tn REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    last_cycle_id INTEGER
);

CREATE TABLE tovas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    capacidade_tn REAL NOT NULL,
    current_tn REAL NOT NULL DEFAULT 0
);

CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    truck_plate TEXT,
    toneladas_declared REAL,
    arrival_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'arrived',
    portaria_user_id INTEGER
);

CREATE TABLE cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    trituration_id INTEGER,
    cooking_id INTEGER,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    status TEXT DEFAULT 'in_progress'
);

CREATE TABLE trituration_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    from_tova_id INTEGER,
    toneladas_solicitadas REAL,
    toneladas_trituradas REAL,
    operator_id INTEGER,
    start_tritura_at DATETIME,
    end_tritura_at DATETIME,
    status TEXT DEFAULT 'created'
);

CREATE TABLE cooking_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    operator_id INTEGER,
    start_cook_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_cook_at DATETIME,
    status TEXT DEFAULT 'created'
);

CREATE TABLE digestor_discharges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digestor_id INTEGER,
    trituration_cycle_id INTEGER,
    cooking_cycle_id INTEGER,
    toneladas_discarded REAL,
    operator_id INTEGER,
    notes TEXT,
    dt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- USUÁRIOS PADRÃO
INSERT INTO users (nome, role) VALUES ('Operador A', 'operador');
INSERT INTO users (nome, role) VALUES ('Portaria', 'portaria');

-- DIGESTORES PADRÃO
INSERT INTO digestors (nome, capacidade_tn, status) VALUES ('Digestor 1', 5, 'idle');
INSERT INTO digestors (nome, capacidade_tn, status) VALUES ('Digestor 2', 5, 'idle');
INSERT INTO digestors (nome, capacidade_tn, status) VALUES ('Digestor 3', 5, 'idle');
INSERT INTO digestors (nome, capacidade_tn, status) VALUES ('Digestor 4', 5, 'idle');

-- TOVA PADRÃO
INSERT INTO tovas (nome, capacidade_tn, current_tn) VALUES ('Tova de Recepção', 12, 0);
