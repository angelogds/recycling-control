// server_digestores.js — PARTE 1/4
// Imports, init, session, login/logout, basic middleware

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt"); // para senhas (opcional)
const path = require("path");
const fs = require("fs");
const http = require("http");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// -----------------------------
// Paths & DB
// -----------------------------
const ROOT = __dirname;
const DATA_DIR = path.join("/app", "data"); // Railway-friendly mount
const DEFAULT_DB_PATH = path.join(DATA_DIR, "database.sqlite");
const DB_FILE = process.env.DB_FILE || DEFAULT_DB_PATH;
const SQL_INIT_FILE = path.join(ROOT, "init_db.sql");

const PUBLIC_DIR = path.join(ROOT, "public");
const VIEWS_DIR = path.join(ROOT, "views");
const REPORTS_DIR = path.join(PUBLIC_DIR, "reports");

// Ensure folders exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// If DB missing, initialize from init_db.sql (safe first-run)
if (!fs.existsSync(DB_FILE) && fs.existsSync(SQL_INIT_FILE)) {
  try {
    console.log("📌 database not found. Creating database from init_db.sql at:", DB_FILE);
    const initSql = fs.readFileSync(SQL_INIT_FILE, "utf8");
    const tmpdb = new sqlite3.Database(DB_FILE);
    tmpdb.exec(initSql, (err) => {
      if (err) console.error("Erro ao executar init_db.sql:", err);
      else console.log("✔ Database created from init_db.sql");
      tmpdb.close();
    });
  } catch (e) {
    console.error("Erro ao criar DB automaticamente:", e);
  }
}

// -----------------------------
// Express / EJS / Static / Parsers
// -----------------------------
app.set("views", VIEWS_DIR);
app.set("view engine", "ejs");
app.use(express.static(PUBLIC_DIR));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// -----------------------------
// Session & Auth (dev-friendly)
// -----------------------------
// NOTE: MemoryStore is not for production. Replace with Redis or DB-backed store.
app.use(session({
  name: "rc-sess",
  secret: process.env.SESSION_SECRET || "troque_essasegredo_em_producao",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 horas
}));

// Helper: set req.currentUser from session (if present)
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
  } else {
    req.user = null;
  }
  next();
});

// Simple auth guard middleware
function ensureAuth(req, res, next) {
  if (req.user) return next();
  // if AJAX request, respond 401
  if (req.xhr || req.headers.accept?.includes("application/json")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.redirect("/login");
}

// -----------------------------
// Open DB
// -----------------------------
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error("SQLite open error:", err);
  } else {
    console.log("🔌 Banco SQLite conectado em:", DB_FILE);
  }
});

// -----------------------------
// Optional: ensure users table exists (safe fallback)
// -----------------------------
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    nome TEXT,
    role TEXT,
    password TEXT
  )`);
});

// -----------------------------
// Login / Logout routes
// -----------------------------

// Render login form (simple)
app.get("/login", (req, res) => {
  // if already logged, redirect to painel
  if (req.user) return res.redirect("/operador/painel");
  res.render("login", { title: "Login", error: null });
});

// Handle login post
app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username) return res.render("login", { title: "Login", error: "Informe usuário" });

  // lookup user
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (err) {
      console.error("Erro DB login:", err);
      return res.render("login", { title: "Login", error: "Erro no servidor" });
    }

    if (!user) {
      // no user found
      return res.render("login", { title: "Login", error: "Usuário ou senha inválidos" });
    }

    // If password is set (hashed) compare, else accept if password empty or matches raw (dev convenience)
    try {
      const pwStored = user.password;
      if (!pwStored || pwStored.trim() === "") {
        // Accept login if no password stored (dev mode)
        req.session.user = { id: user.id, nome: user.nome || user.username, username: user.username, role: user.role || "operador" };
        return res.redirect("/operador/painel");
      }

      // if password looks hashed (starts with $2b$ or $2a$), use bcrypt compare
      if (pwStored.startsWith("$2a$") || pwStored.startsWith("$2b$") || pwStored.startsWith("$2y$")) {
        const ok = await bcrypt.compare(password || "", pwStored);
        if (!ok) return res.render("login", { title: "Login", error: "Usuário ou senha inválidos" });
        req.session.user = { id: user.id, nome: user.nome || user.username, username: user.username, role: user.role || "operador" };
        return res.redirect("/operador/painel");
      }

      // fallback: plaintext compare (not recommended)
      if (password === pwStored) {
        req.session.user = { id: user.id, nome: user.nome || user.username, username: user.username, role: user.role || "operador" };
        return res.redirect("/operador/painel");
      }

      return res.render("login", { title: "Login", error: "Usuário ou senha inválidos" });
    } catch (e) {
      console.error("Erro auth:", e);
      return res.render("login", { title: "Login", error: "Erro no servidor" });
    }
  });
});

// logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("rc-sess");
    res.redirect("/login");
  });
});

// -----------------------------
// Example protected route usage (you'll use this later)
// -----------------------------
app.get("/operador/protegido-exemplo", ensureAuth, (req, res) => {
  res.send(`Olá ${req.user.nome}, área protegida.`);
});

// -----------------------------
// Expose db and ensure server continues in next parts
// -----------------------------
module.exports = { app, server, io, db, ensureAuth };

// End of PARTE 1
// server_digestores.js — PARTE 2/4
// Rotas de views + Portaria + Tovas

const { app, db, ensureAuth } = module.exports;

// ------------------------------------------------------------
// VIEWS — Painéis principais
// ------------------------------------------------------------

// Página inicial → redireciona para login ou painel
app.get("/", (req, res) => {
  if (!req.user) return res.redirect("/login");
  res.redirect("/operador/painel");
});

// Painel do operador (PROTEGIDO)
app.get("/operador/painel", ensureAuth, (req, res) => {
  db.all("SELECT * FROM digestors ORDER BY id", [], (err, digestores) => {
    if (err) return res.status(500).send("Erro ao carregar digestores");

    res.render("operador_painel", {
      usuario: req.user,
      digestores: digestores || [],
      title: "Painel do Operador"
    });
  });
});

// Histórico do operador
app.get("/operador/historico", ensureAuth, (req, res) => {
  res.render("operador_historico", {
    usuario: req.user,
    title: "Histórico de Ciclos"
  });
});

// ------------------------------------------------------------
// PORTARIA — Views protegidas
// ------------------------------------------------------------

// Tela principal da portaria
app.get("/portaria", ensureAuth, (req, res) => {
  res.render("portaria_painel", {
    usuario: req.user,
    title: "Controle de Chegadas"
  });
});

// Formulário para registrar chegada
app.get("/portaria/chegada", ensureAuth, (req, res) => {
  res.render("portaria_chegada_form", {
    usuario: req.user,
    title: "Registrar Chegada"
  });
});

// Registrar chegada de caminhão
app.post("/portaria/chegada", ensureAuth, (req, res) => {
  const { placa, toneladas } = req.body;

  if (!placa || !toneladas)
    return res.status(400).send("Placa e toneladas são obrigatórios.");

  db.run(
    `INSERT INTO entries 
     (truck_plate, toneladas_declared, portaria_user_id) 
     VALUES (?, ?, ?)`,
    [placa, toneladas, req.user.id],
    function (err) {
      if (err) {
        console.error("Erro ao inserir entrada:", err);
        return res.status(500).send("Erro ao registrar chegada.");
      }

      // Atualiza painel em tempo real
      if (global.broadcastState) broadcastState();
      res.redirect("/portaria");
    }
  );
});

// ------------------------------------------------------------
// TOVAS (Tanques de Matéria Prima)
// ------------------------------------------------------------

// Dashboard das Tovas
app.get("/tovas", ensureAuth, (req, res) => {
  db.all("SELECT * FROM tovas ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).send("Erro ao carregar tovas");

    res.render("tovas_dashboard", {
      usuario: req.user,
      tovas: rows || [],
      title: "Tovas — Matéria Prima"
    });
  });
});

// Tela para editar uma tova
app.get("/tovas/:id/editar", ensureAuth, (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM tovas WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).send("Erro DB");
    if (!row) return res.status(404).send("Tova não encontrada");

    res.render("tovas_editar", {
      usuario: req.user,
      tova: row,
      title: `Editar: ${row.nome}`
    });
  });
});

// Aplicar atualização da tova
app.post("/tovas/:id/update", ensureAuth, (req, res) => {
  const id = req.params.id;
  const { nome, capacidade_tn } = req.body;

  db.run(
    `UPDATE tovas 
     SET nome = ?, capacidade_tn = ? 
     WHERE id = ?`,
    [nome, capacidade_tn, id],
    function (err) {
      if (err) {
        console.error("Erro atualizando tova:", err);
        return res.status(500).send("Erro ao atualizar tova.");
      }

      if (global.broadcastState) broadcastState();
      res.redirect("/tovas");
    }
  );
});

// ------------------------------------------------------------
// Exportar parcialmente para continuação da PARTE 3
// ------------------------------------------------------------
module.exports.broadcastState = global.broadcastState;
// ---------------------------
// PARTE 3: APIs e helpers
// ---------------------------

// Helper: atualiza status do digestor
function setDigestorStatus(id, status, cb = () => {}) {
  db.run("UPDATE digestors SET status = ? WHERE id = ?", [status, id], cb);
}

/* TRITURAÇÃO - START
   body: { digestor_id, from_tova_id, toneladas_solicitadas, materia_prima }
*/
app.post("/api/trituracao/start", (req, res) => {
  const { digestor_id, from_tova_id, toneladas_solicitadas, materia_prima } = req.body;
  if (!digestor_id || !from_tova_id) return res.status(400).json({ error: "Dados incompletos" });

  const now = new Date().toISOString();
  db.run(
    `INSERT INTO trituration_cycles 
      (digestor_id, from_tova_id, toneladas_solicitadas, materia_prima, start_tritura_at, status, operator_id)
     VALUES (?, ?, ?, ?, ?, 'started', ?)`,
    [digestor_id, from_tova_id, toneladas_solicitadas || 0, materia_prima || null, now, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const tritId = this.lastID;
      // create cycle and link tritura
      db.run("INSERT INTO cycles (digestor_id, trituration_id, started_at, status) VALUES (?, ?, ?, 'in_progress')", [digestor_id, tritId, now], function (cErr) {
        if (cErr) console.error("Err create cycle:", cErr);

        setDigestorStatus(digestor_id, "operating", () => {
          broadcastState();
          res.json({ trituration_id: tritId, started_at: now });
        });
      });
    }
  );
});

/* TRITURAÇÃO - FINISH
   body: { trituration_id, toneladas_trituradas }
   -> automaticamente inicia cozimento
*/
app.post("/api/trituracao/finish", (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  if (!trituration_id) return res.status(400).json({ error: "ID inválido" });

  const now = new Date().toISOString();
  db.run(
    `UPDATE trituration_cycles SET end_tritura_at = ?, toneladas_trituradas = ?, status = 'finished' WHERE id = ?`,
    [now, toneladas_trituradas || 0, trituration_id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      // busca digestor e inicia cozimento automaticamente
      db.get("SELECT digestor_id FROM trituration_cycles WHERE id = ?", [trituration_id], (e, row) => {
        if (e || !row) {
          broadcastState();
          return res.json({ ok: true });
        }
        // start cooking
        startCooking(row.digestor_id, trituration_id, res);
      });
    }
  );
});

// Helper: inicia cozimento (usada acima)
function startCooking(digestor_id, trituration_id, res = null) {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO cooking_cycles (digestor_id, trituration_id, start_cook_at, status, operator_id)
     VALUES (?, ?, ?, 'started', ?)`,
    [digestor_id, trituration_id, now, 1],
    function (err) {
      if (err) {
        console.error("Err start cooking:", err);
        if (res && !res.headersSent) return res.status(500).json({ error: err.message });
        return;
      }
      const cookingId = this.lastID;
      db.run("UPDATE cycles SET cooking_id = ? WHERE trituration_id = ? AND status = 'in_progress'", [cookingId, trituration_id], uErr => {
        if (uErr) console.error("Err linking cook to cycle:", uErr);
        setDigestorStatus(digestor_id, "cooking", () => {
          broadcastState();
          if (res && !res.headersSent) res.json({ cooking_id: cookingId, started_at: now });
        });
      });
    }
  );
}

/* COZIMENTO - FINISH
   body: { cooking_id }
*/
app.post("/api/cooking/finish", (req, res) => {
  const { cooking_id } = req.body;
  if (!cooking_id) return res.status(400).json({ error: "ID inválido" });

  const now = new Date().toISOString();
  db.run("UPDATE cooking_cycles SET end_cook_at = ?, status = 'finished' WHERE id = ?", [now, cooking_id], function (err) {
    if (err) return res.status(500).json({ error: err.message });

    // fechar ciclo e marcar digestor como 'waiting_discharge'
    db.get("SELECT id, digestor_id FROM cycles WHERE cooking_id = ? AND status = 'in_progress' LIMIT 1", [cooking_id], (e, cyc) => {
      if (e) { console.error(e); broadcastState(); return res.json({ ok: true }); }
      if (!cyc) { broadcastState(); return res.json({ ok: true }); }

      db.run("UPDATE cycles SET ended_at = ?, status = 'finished' WHERE id = ?", [now, cyc.id], uErr => {
        if (uErr) console.error("Err close cycle:", uErr);
        setDigestorStatus(cyc.digestor_id, "waiting_discharge", () => {
          broadcastState();
          res.json({ ok: true });
        });
      });
    });
  });
});

/* DESCARGA
   body: { digestor_id, cooking_cycle_id, toneladas_discarded, notes }
*/
app.post("/api/digestor/discharge", (req, res) => {
  const { digestor_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;
  if (!digestor_id) return res.status(400).json({ error: "digestor_id required" });

  db.run(`INSERT INTO digestor_discharges (digestor_id, cooking_cycle_id, toneladas_discarded, operator_id, notes) VALUES (?, ?, ?, ?, ?)`,
    [digestor_id, cooking_cycle_id || null, toneladas_discarded || 0, req.user.id, notes || null], function (err) {
      if (err) return res.status(500).json({ error: err.message });

      // finalmente deixa o digestor idle
      setDigestorStatus(digestor_id, "idle", () => {
        broadcastState();
        res.json({ discharge_id: this.lastID });
      });
    });
});
//----------------------------------------------------------
// LOGIN REAL
//----------------------------------------------------------
const session = require("express-session");
const bcrypt = require("bcrypt");

app.use(session({
    secret: "supersegredo-mudar",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 horas logado
}));

// Middleware: exige login
function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect("/login");
    req.user = req.session.user;
    next();
}
