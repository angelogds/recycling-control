// ====================== PART 1 ======================
// server_digestores.js - Parte 1/6
// Imports, paths, initialize DB, express, session
// ====================================================

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const http = require("http");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------------- Paths / files ----------------
const ROOT = __dirname;
const DEFAULT_DB_PATH = path.join("/app/data", "database.sqlite");
const DB_FILE = process.env.DB_FILE || DEFAULT_DB_PATH;
const SQL_INIT_FILE = path.join(ROOT, "init_db.sql");

const PUBLIC_DIR = path.join(ROOT, "public");
const VIEWS_DIR = path.join(ROOT, "views");
const REPORTS_DIR = path.join(PUBLIC_DIR, "reports");

// Ensure folders
if (!fs.existsSync(path.dirname(DB_FILE))) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ---------------- Init DB if missing ----------------
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
    console.error("Erro ao criar DB:", e);
  }
}

// ---------------- Express + EJS ----------------
app.set("views", VIEWS_DIR);
app.set("view engine", "ejs");
app.use(express.static(PUBLIC_DIR));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ---------------- Session middleware ----------------
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: path.dirname(DB_FILE) }),
  secret: process.env.SESSION_SECRET || "troque_essa_chave_em_producao",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 horas
}));

// ---------------- Open DB ----------------
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error("SQLite open error:", err);
  else console.log("🔌 Banco SQLite conectado em:", DB_FILE);
});

// ---------------- Optional PDF util (non-fatal) ----------------
let gerarPDFCicloUtil = null;
try {
  gerarPDFCicloUtil = require(path.join(ROOT, "utils", "pdf_ciclos"));
} catch (e) {
  console.warn("Aviso: utils/pdf_ciclos.js não encontrado — rotas de PDF ficarão indisponíveis.");
}
// ====================== PART 2 ======================
// Auth helpers, routes login/logout, seed admin user
// ====================================================

// ---------- Middleware helpers ----------
function ensureAuth(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }

  // API → retorna 401
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/reports") ||
    req.path.startsWith("/pdf")
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // View → redireciona
  return res.redirect("/login");
}

function ensureRole(role) {
  return (req, res, next) => {
    if (
      req.session &&
      req.session.user &&
      (req.session.user.role === role ||
        req.session.user.role === "admin")
    ) {
      return next();
    }

    return res.status(403).send("Forbidden");
  };
}

// ---------- Login / Logout routes ----------
app.get("/login", (req, res) => {
  res.render("login", { erro: null, title: "Login" });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render("login", { erro: "Usuário e senha são obrigatórios." });
  }

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, user) => {
      if (err) {
        console.error("Erro na consulta de login:", err);
        return res.render("login", { erro: "Erro interno no servidor." });
      }

      if (!user) {
        return res.render("login", { erro: "Usuário não encontrado." });
      }

      try {
        const ok = await bcrypt.compare(password, user.password);

        if (!ok) {
          return res.render("login", { erro: "Senha inválida." });
        }

        // Criar sessão
        req.session.user = {
          id: user.id,
          nome: user.nome || user.username,
          username: user.username,
          role: user.role || "operador"
        };

        return res.redirect("/operador/painel");

      } catch (e) {
        console.error("Erro ao validar senha:", e);
        return res.render("login", { erro: "Erro interno ao validar senha." });
      }
    }
  );
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ---------- Seed: criar usuário admin se não existir ----------
db.get("SELECT COUNT(*) AS cnt FROM users", [], (err, row) => {
  if (err) {
    console.error("Erro ao verificar usuários:", err);
    return;
  }

  if ((row?.cnt || 0) === 0) {
    const admin = {
      username: "angelo",
      nome: "Administrador",
      role: "admin",
      senha: "@nloFa1107"
    };

    bcrypt.hash(admin.senha, 10)
      .then(hash => {
        db.run(
          "INSERT INTO users (username, nome, role, password) VALUES (?, ?, ?, ?)",
          [admin.username, admin.nome, admin.role, hash],
          err => {
            if (err) {
              console.error("Erro ao criar admin:", err);
            } else {
              console.log("✔ Usuário admin criado: angelo / @nloFa1107");
            }
          }
        );
      })
      .catch(err => console.error("Erro ao gerar hash:", err));
  }
});

// ====================== PART 3 ======================
// server_digestores.js - Parte 3/6
// Views: painel operador, historico, portaria, tovas; portaria POST
// ====================================================

// Root redirect
app.get("/", (req, res) => res.redirect("/operador/painel"));

// Operador painel (protected)
app.get("/operador/painel", ensureAuth, (req, res) => {
  db.all("SELECT * FROM digestors ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).send("Erro ao carregar digestores");
    res.render("operador_painel", { usuario: req.session.user, digestores: rows || [] });
  });
});

// Histórico (protected)
app.get("/operador/historico", ensureAuth, (req, res) => {
  res.render("operador_historico", { usuario: req.session.user, title: "Histórico de Ciclos" });
});

// Portaria views (role 'portaria' or admin)
app.get("/portaria", ensureAuth, ensureRole("portaria"), (req, res) => {
  res.render("portaria_painel", { usuario: req.session.user, title: "Portaria" });
});
app.get("/portaria/chegada", ensureAuth, ensureRole("portaria"), (req, res) => {
  res.render("portaria_chegada_form", { usuario: req.session.user, title: "Registrar Chegada" });
});

// Handle portaria arrival
app.post("/portaria/chegada", ensureAuth, ensureRole("portaria"), (req, res) => {
  const { placa, toneladas } = req.body;
  if (!placa || !toneladas) return res.status(400).send("Placa e toneladas são obrigatórios.");
  db.run("INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id) VALUES (?, ?, ?)", [placa, toneladas, req.session.user.id], function(err) {
    if (err) { console.error("Erro ao inserir entrada:", err); return res.status(500).send("Erro ao registrar chegada."); }
    broadcastState();
    res.redirect("/portaria");
  });
});

// Tovas list & edit views (protected)
app.get("/tovas", ensureAuth, (req, res) => {
  db.all("SELECT * FROM tovas ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).send("Erro DB tovas");
    res.render("tovas_dashboard", { usuario: req.session.user, tovas: rows || [] });
  });
});

app.get("/tovas/:id/editar", ensureAuth, (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM tovas WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).send("Erro DB");
    if (!row) return res.status(404).send("Tova não encontrada");
    res.render("tovas_editar", { usuario: req.session.user, tova: row });
  });
});

app.post("/tovas/:id/update", ensureAuth, (req, res) => {
  const id = req.params.id;
  const { nome, capacidade_tn } = req.body;
  db.run("UPDATE tovas SET nome = ?, capacidade_tn = ? WHERE id = ?", [nome, capacidade_tn || 0, id], function (err) {
    if (err) { console.error("Err update tova:", err); return res.status(500).send("Erro ao atualizar tova"); }
    broadcastState();
    res.redirect("/tovas");
  });
});
// ====================== PART 4 ======================
// server_digestores.js - Parte 4/6
// APIs: /api/digestors, tritura start/finish, helper startCooking
// ====================================================

// API: digestors detailed (used by operador.js in frontend)
app.get("/api/digestors", ensureAuth, (req, res) => {
  db.all("SELECT id, nome, capacidade_tn, status, last_cycle_id FROM digestors ORDER BY id", [], async (err, digestores) => {
    if (err) return res.status(500).json({ error: err.message });
    const result = [];
    for (const d of digestores) {
      const trit = await new Promise(r => db.get("SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (_, row) => r(row || null)));
      const cook = await new Promise(r => db.get("SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (_, row) => r(row || null)));
      const cyc = await new Promise(r => db.get("SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1", [d.id], (_, row) => r(row || null)));
      result.push({ ...d, current_tritura: trit, current_cooking: cook, current_cycle: cyc });
    }
    res.json(result);
  });
});

// API: Trituração START
app.post("/api/trituracao/start", ensureAuth, (req, res) => {
  const { digestor_id, from_tova_id, toneladas_solicitadas, materia_prima } = req.body;
  if (!digestor_id || !from_tova_id) return res.status(400).json({ error: 'Dados incompletos' });

  const now = new Date().toISOString();
  db.run(`INSERT INTO trituration_cycles (digestor_id, from_tova_id, toneladas_solicitadas, materia_prima, start_tritura_at, status, operator_id)
          VALUES (?, ?, ?, ?, ?, 'started', ?)`, [digestor_id, from_tova_id, toneladas_solicitadas || 0, materia_prima || null, now, req.session.user.id], function(err) {
    if (err) { console.error('Err start trit:', err); return res.status(500).json({ error: err.message }); }
    const tritId = this.lastID;

    // create cycle row
    db.run(`INSERT INTO cycles (digestor_id, trituration_id, started_at, status) VALUES (?, ?, ?, 'in_progress')`, [digestor_id, tritId, now], function(cErr) {
      if (cErr) console.error("Err Create Cycle:", cErr);
      // update digestor status to operating
      db.run("UPDATE digestors SET status = ? WHERE id = ?", ['operating', digestor_id], () => {
        broadcastState();
        res.json({ trituration_id: tritId, started_at: now });
      });
    });
  });
});

// API: Trituração FINISH (auto starts cooking)
app.post("/api/trituracao/finish", ensureAuth, (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  if (!trituration_id) return res.status(400).json({ error: 'Dados incompletos' });

  const now = new Date().toISOString();
  db.run("UPDATE trituration_cycles SET end_tritura_at = ?, toneladas_trituradas = ?, status = 'finished' WHERE id = ?", [now, toneladas_trituradas || 0, trituration_id], function(err) {
    if (err) { console.error('Err finish trit:', err); return res.status(500).json({ error: err.message }); }

    // get digestor id and start cooking
    db.get("SELECT digestor_id FROM trituration_cycles WHERE id = ?", [trituration_id], (e, row) => {
      if (e || !row) {
        broadcastState();
        return res.json({ ok: true });
      }
      startCooking(row.digestor_id, trituration_id, req.session.user, res);
    });
  });
});

// Helper: startCooking
function startCooking(digestor_id, trituration_id, operatorUser = { id: 1 }, res = null) {
  const now = new Date().toISOString();
  db.run("INSERT INTO cooking_cycles (digestor_id, trituration_id, start_cook_at, status, operator_id) VALUES (?, ?, ?, 'started', ?)",
    [digestor_id, trituration_id, now, operatorUser.id],
    function(err) {
      if (err) {
        console.error("Err start cook:", err);
        if (res && !res.headersSent) return res.status(500).json({ error: err.message });
        return;
      }
      const cookingId = this.lastID;

      db.run("UPDATE cycles SET cooking_id = ? WHERE trituration_id = ? AND status = 'in_progress'", [cookingId, trituration_id], (uErr) => {
        if (uErr) console.error("Err linking cooking to cycle:", uErr);
        db.run("UPDATE digestors SET status = ? WHERE id = ?", ['cooking', digestor_id], () => {
          broadcastState();
          if (res && !res.headersSent) return res.json({ cooking_id: cookingId, started_at: now });
        });
      });
    });
}
// ====================== PART 5 ======================
// server_digestores.js - Parte 5/6
// APIs: cooking finish, discharge, histórico e PDF
// ====================================================

// API: Cooking FINISH
app.post("/api/cooking/finish", ensureAuth, (req, res) => {
  const { cooking_id } = req.body;
  if (!cooking_id) return res.status(400).json({ error: 'cooking_id required' });

  const now = new Date().toISOString();
  db.run("UPDATE cooking_cycles SET end_cook_at = ?, status = 'finished' WHERE id = ?", [now, cooking_id], function(err) {
    if (err) { console.error('Err finish cook:', err); return res.status(500).json({ error: err.message }); }

    // finalize related cycle
    db.get("SELECT id, digestor_id FROM cycles WHERE cooking_id = ? AND status = 'in_progress' LIMIT 1", [cooking_id], (e, cyc) => {
      if (e) { console.error("Err find cycle:", e); broadcastState(); return res.json({ ok: true }); }
      if (!cyc) { broadcastState(); return res.json({ ok: true }); }

      db.run("UPDATE cycles SET ended_at = ?, status = 'finished' WHERE id = ?", [now, cyc.id], (uErr) => {
        if (uErr) console.error("Err end cycle:", uErr);
        // set digestor status to waiting discharge
        db.run("UPDATE digestors SET status = ? WHERE id = ?", ['waiting_discharge', cyc.digestor_id], () => {
          broadcastState();
          res.json({ ok: true });
        });
      });
    });
  });
});

// API: Discharge digestor
app.post("/api/digestor/discharge", ensureAuth, (req, res) => {
  const { digestor_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;
  if (!digestor_id) return res.status(400).json({ error: 'digestor_id required' });

  db.run(`INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes)
          VALUES (?, NULL, ?, ?, ?, ?)`, [digestor_id, cooking_cycle_id || null, toneladas_discarded || 0, req.session.user.id, notes || null], function(err) {
    if (err) { console.error('Err discharge:', err); return res.status(500).json({ error: err.message }); }

    // update digestor to idle
    db.run("UPDATE digestors SET status = 'idle' WHERE id = ?", [digestor_id], () => {
      broadcastState();
      res.json({ discharge_id: this.lastID });
    });
  });
});

// API: histórico - list
app.get("/api/cycles/all", ensureAuth, (req, res) => {
  const sql = `
    SELECT cy.id, cy.digestor_id, cy.trituration_id, cy.cooking_id, cy.started_at, cy.ended_at, cy.status,
           d.nome AS digestor_name
    FROM cycles cy
    LEFT JOIN digestors d ON cy.digestor_id = d.id
    ORDER BY cy.id DESC LIMIT 200
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// API: histórico - detalhe
app.get("/api/cycles/:id", ensureAuth, (req, res) => {
  const id = req.params.id;
  const sql = `
    SELECT cy.*, d.nome AS digestor_name,
           tc.start_tritura_at, tc.end_tritura_at, tc.toneladas_trituradas, tc.materia_prima,
           cc.start_cook_at, cc.end_cook_at,
           dd.toneladas_discarded, dd.notes
    FROM cycles cy
    LEFT JOIN digestors d ON cy.digestor_id = d.id
    LEFT JOIN trituration_cycles tc ON cy.trituration_id = tc.id
    LEFT JOIN cooking_cycles cc ON cy.cooking_id = cc.id
    LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
    WHERE cy.id = ?
  `;
  db.get(sql, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Ciclo não encontrado" });
    res.json(row);
  });
});

// Reports (PDF) - optional
app.get("/reports/cycle/:id", ensureAuth, (req, res) => {
  if (!gerarPDFCicloUtil) return res.status(500).send("PDF util não disponível.");
  const { id } = req.params;
  const sql = `
    SELECT cy.*, d.nome as digestor_name, tc.*, cc.*, dd.*
    FROM cycles cy
    LEFT JOIN digestors d ON d.id = cy.digestor_id
    LEFT JOIN trituration_cycles tc ON tc.id = cy.trituration_id
    LEFT JOIN cooking_cycles cc ON cc.id = cy.cooking_id
    LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
    WHERE cy.id = ?
  `;
  db.get(sql, [id], async (err, ciclo) => {
    if (err || !ciclo) return res.status(404).send("Ciclo não encontrado");
    try {
      const fileName = `ciclo_${id}_${Date.now()}.pdf`;
      const filePath = path.join(REPORTS_DIR, fileName);
      await gerarPDFCicloUtil(ciclo, filePath);
      res.json({ url: `/reports/${fileName}` });
    } catch (e) {
      console.error("Erro PDF:", e);
      res.status(500).send("Erro ao gerar PDF");
    }
  });
});
// ====================== PART 6 ======================
// server_digestores.js - Parte 6/6
// broadcastState, socket.io, error handler, start server
// ====================================================

// Broadcast state to connected sockets
function broadcastState() {
  // Digestores + ciclos
  db.all("SELECT id, nome, capacidade_tn, status, last_cycle_id FROM digestors ORDER BY id", [], (err, digestores) => {
    if (err) { console.error("DB error (digestors):", err); io.emit("digestors:update", []); return; }

    const tasks = digestores.map(d => new Promise(resolve => {
      db.get("SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (e1, trit) => {
        db.get("SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (e2, cook) => {
          db.get("SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1", [d.id], (e3, cyc) => {
            resolve({ ...d, current_tritura: trit || null, current_cooking: cook || null, current_cycle: cyc || null });
          });
        });
      });
    }));

    Promise.all(tasks).then(result => io.emit("digestors:update", result)).catch(e => { console.error("Error building digestors state:", e); io.emit("digestors:update", digestores || []); });
  });

  // Tovas
  db.all("SELECT id, nome, capacidade_tn, current_tn FROM tovas ORDER BY id", [], (err, rows) => {
    if (err) { console.error("DB error (tovas):", err); io.emit("tovas:update", []); return; }
    io.emit("tovas:update", rows || []);
  });

  // Entries pending
  db.all("SELECT id, truck_plate, toneladas_declared, arrival_at, status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50", [], (err, rows) => {
    if (err) { console.error("DB error (entries):", err); io.emit("entries:update", []); return; }
    io.emit("entries:update", rows || []);
  });
}

// Socket.IO
io.on("connection", (socket) => {
  console.log("🔌 Socket conectado:", socket.id);
  broadcastState();
  socket.on("ping", () => socket.emit("pong"));
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (!res.headersSent) res.status(500).send("Internal Server Error");
});

// Start server
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta", PORT);
});
