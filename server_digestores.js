// server_digestores.js
// Versão final unificada — LOGIN + SESSÕES + DIGESTORES + PORTARIA + TOVAS + HISTÓRICO + PDF (opcional) + Socket.IO
// Save as server_digestores.js

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

// Optional utilities (PDF / QR) — wrapped in try/catch so server runs without them
let gerarPDFCicloUtil = null;
try {
  gerarPDFCicloUtil = require(path.join(__dirname, "utils", "pdf_ciclos"));
} catch (e) {
  console.warn("Aviso: utils/pdf_ciclos.js não encontrado — rotas de PDF ficarão indisponíveis.");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// -------------------- Paths & Files --------------------
const ROOT = __dirname;
const DEFAULT_DB_PATH = path.join("/app/data", "database.sqlite");
const DB_FILE = process.env.DB_FILE || DEFAULT_DB_PATH;
const SQL_INIT_FILE = path.join(ROOT, "init_db.sql");

const PUBLIC_DIR = path.join(ROOT, "public");
const VIEWS_DIR = path.join(ROOT, "views");
const REPORTS_DIR = path.join(PUBLIC_DIR, "reports");

// Ensure directories exist
if (!fs.existsSync(path.dirname(DB_FILE))) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// Initialize DB from SQL file if missing
if (!fs.existsSync(DB_FILE) && fs.existsSync(SQL_INIT_FILE)) {
  try {
    console.log("📌 Database not found. Creating from init_db.sql at:", DB_FILE);
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

// -------------------- Express + EJS --------------------
app.set("views", VIEWS_DIR);
app.set("view engine", "ejs");
app.use(express.static(PUBLIC_DIR));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// -------------------- Sessions --------------------
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: path.dirname(DB_FILE) }),
    secret: process.env.SESSION_SECRET || "troque_essa_chave_em_producao",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
  })
);

// -------------------- Database --------------------
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error("SQLite open error:", err);
  else console.log("🔌 Banco SQLite conectado em:", DB_FILE);
});

// -------------------- Helper middlewares --------------------
function ensureAuth(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }
  // API clients -> 401, views -> redirect
  if (req.path.startsWith("/api") || req.path.startsWith("/reports") || req.path.startsWith("/pdf")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return res.redirect("/login");
}
function ensureRole(role) {
  return (req, res, next) => {
    if (req.session && req.session.user && (req.session.user.role === role || req.session.user.role === "admin")) return next();
    return res.status(403).send("Forbidden");
  };
}

// -------------------- Broadcast (Socket.IO) --------------------
function broadcastState() {
  // Digestors with their active trit/cook/cycle
  db.all("SELECT id, nome, capacidade_tn, status, last_cycle_id FROM digestors ORDER BY id", [], (err, digestores) => {
    if (err) {
      console.error("DB error (digestors):", err);
      io.emit("digestors:update", []);
      return;
    }

    const tasks = digestores.map(d => new Promise(resolve => {
      db.get("SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (e1, trit) => {
        db.get("SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (e2, cook) => {
          db.get("SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1", [d.id], (e3, cyc) => {
            resolve({ ...d, current_tritura: trit || null, current_cooking: cook || null, current_cycle: cyc || null });
          });
        });
      });
    }));

    Promise.all(tasks).then(result => io.emit("digestors:update", result)).catch(e => {
      console.error("Error building digestors state:", e);
      io.emit("digestors:update", digestores || []);
    });
  });

  // Tovas
  db.all("SELECT id, nome, capacidade_tn, current_tn FROM tovas ORDER BY id", [], (err, rows) => {
    if (err) { console.error("DB error (tovas):", err); io.emit("tovas:update", []); }
    else io.emit("tovas:update", rows || []);
  });

  // Entries pending
  db.all("SELECT id, truck_plate, toneladas_declared, arrival_at, status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50", [], (err, rows) => {
    if (err) { console.error("DB error (entries):", err); io.emit("entries:update", []); }
    else io.emit("entries:update", rows || []);
  });
}

// -------------------- Views: auth + painel --------------------
app.get("/login", (req, res) => {
  if (req.session && req.session.user) return res.redirect("/operador/painel");
  res.render("login", { error: null, title: "Login" });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render("login", { error: "Usuário e senha são obrigatórios." });

  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (err) { console.error("Err DB login:", err); return res.render("login", { error: "Erro interno." }); }
    if (!user) return res.render("login", { error: "Usuário não encontrado." });

    try {
      // Support both hashed password column 'password' and legacy 'password_plain'
      const hash = user.password || user.password_hash || null;
      const plain = user.password_plain || null;
      let match = false;
      if (hash) match = await bcrypt.compare(password, hash);
      else if (plain) match = (password === plain);
      else match = false;

      if (!match) return res.render("login", { error: "Senha inválida." });

      req.session.user = { id: user.id, nome: user.nome || user.username, username: user.username, role: user.role || "operador" };
      return res.redirect("/operador/painel");
    } catch (e) {
      console.error("Err bcrypt:", e);
      return res.render("login", { error: "Erro interno." });
    }
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// Protected root/painel
app.get("/", (req, res) => res.redirect("/operador/painel"));
app.get("/operador/painel", ensureAuth, (req, res) => {
  db.all("SELECT * FROM digestors ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).send("Erro ao carregar digestores");
    res.render("operador_painel", { usuario: req.session.user, digestores: rows || [] });
  });
});

// Portaria (require role 'portaria' or admin)
app.get("/portaria", ensureAuth, ensureRole("portaria"), (req, res) => {
  res.render("portaria_painel", { usuario: req.session.user });
});
app.get("/portaria/chegada", ensureAuth, ensureRole("portaria"), (req, res) => res.render("portaria_chegada_form", { usuario: req.session.user }));

app.post("/portaria/chegada", ensureAuth, ensureRole("portaria"), (req, res) => {
  const { placa, toneladas } = req.body;
  if (!placa || !toneladas) return res.status(400).send("Placa e toneladas são obrigatórios.");
  db.run("INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id) VALUES (?, ?, ?)", [placa, toneladas, req.session.user.id], function(err) {
    if (err) { console.error("Erro ao inserir entrada:", err); return res.status(500).send("Erro ao registrar chegada."); }
    broadcastState();
    res.redirect("/portaria");
  });
});

// Tovas views
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
  db.run("UPDATE tovas SET nome = ?, capacidade_tn = ? WHERE id = ?", [nome, capacidade_tn, id], function(err) {
    if (err) { console.error(err); return res.status(500).send('Erro ao atualizar tova'); }
    broadcastState();
    res.redirect('/tovas');
  });
});

// -------------------- API: digestors (detailed) --------------------
app.get("/api/digestors", ensureAuth, (req, res) => {
  db.all("SELECT id, nome, capacidade_tn, status, last_cycle_id FROM digestors ORDER BY id", [], async (err, digestores) => {
    if (err) return res.status(500).json({ error: err.message });
    const result = [];
    for (const d of digestores) {
      const trit = await new Promise(resolve => db.get("SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (_, r) => resolve(r || null)));
      const cook = await new Promise(resolve => db.get("SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (_, r) => resolve(r || null)));
      const cycle = await new Promise(resolve => db.get("SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1", [d.id], (_, r) => resolve(r || null)));
      result.push({ ...d, current_tritura: trit, current_cooking: cook, current_cycle: cycle });
    }
    res.json(result);
  });
});

// -------------------- API: trituration START --------------------
app.post("/api/trituracao/start", ensureAuth, (req, res) => {
  const { digestor_id, from_tova_id, toneladas_solicitadas, materia_prima } = req.body;
  if (!digestor_id || !from_tova_id) return res.status(400).json({ error: 'Dados incompletos' });

  const now = new Date().toISOString();
  db.run(`INSERT INTO trituration_cycles (digestor_id, from_tova_id, toneladas_solicitadas, start_tritura_at, status, operator_id)
          VALUES (?, ?, ?, ?, 'started', ?)`, [digestor_id, from_tova_id, toneladas_solicitadas || 0, now, req.session.user.id], function(err) {
    if (err) { console.error('Err start trit:', err); return res.status(500).json({ error: err.message }); }
    const tritId = this.lastID;

    // create cycle row
    db.run(`INSERT INTO cycles (digestor_id, trituration_id, started_at, status) VALUES (?, ?, ?, 'in_progress')`, [digestor_id, tritId, now], function(cErr) {
      if (cErr) console.error("Err Create Cycle:", cErr);
      db.run("UPDATE digestors SET status = ? WHERE id = ?", ['operating', digestor_id], () => {
        broadcastState();
        res.json({ trituration_id: tritId, started_at: now });
      });
    });
  });
});

// -------------------- API: trituration FINISH (auto start cooking) --------------------
app.post("/api/trituracao/finish", ensureAuth, (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  if (!trituration_id) return res.status(400).json({ error: 'Dados incompletos' });

  const now = new Date().toISOString();
  db.run("UPDATE trituration_cycles SET end_tritura_at = ?, toneladas_trituradas = ?, status = 'finished' WHERE id = ?", [now, toneladas_trituradas || 0, trituration_id], function(err) {
    if (err) { console.error('Err finish trit:', err); return res.status(500).json({ error: err.message }); }

    // get digestor and start cooking
    db.get("SELECT digestor_id FROM trituration_cycles WHERE id = ?", [trituration_id], (e, row) => {
      if (e || !row) { broadcastState(); return res.json({ ok: true }); }
      startCooking(row.digestor_id, trituration_id, req.session.user, res);
    });
  });
});

// Helper to start cooking
function startCooking(digestor_id, trituration_id, operatorUser = { id: 1 }, res = null) {
  const now = new Date().toISOString();
  db.run("INSERT INTO cooking_cycles (digestor_id, trituration_id, start_cook_at, status, operator_id) VALUES (?, ?, ?, 'started', ?)", [digestor_id, trituration_id, now, operatorUser.id], function(err) {
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

// -------------------- API: cooking FINISH --------------------
app.post("/api/cooking/finish", ensureAuth, (req, res) => {
  const { cooking_id } = req.body;
  if (!cooking_id) return res.status(400).json({ error: 'cooking_id required' });

  const now = new Date().toISOString();
  db.run("UPDATE cooking_cycles SET end_cook_at = ?, status = 'finished' WHERE id = ?", [now, cooking_id], function(err) {
    if (err) { console.error('Err finish cook:', err); return res.status(500).json({ error: err.message }); }

    db.get("SELECT id, digestor_id FROM cycles WHERE cooking_id = ? AND status = 'in_progress' LIMIT 1", [cooking_id], (e, cyc) => {
      if (e) { console.error("Err find cycle:", e); broadcastState(); return res.json({ ok: true }); }
      if (!cyc) { broadcastState(); return res.json({ ok: true }); }

      db.run("UPDATE cycles SET ended_at = ?, status = 'finished' WHERE id = ?", [now, cyc.id], (uErr) => {
        if (uErr) console.error("Err end cycle:", uErr);
        db.run("UPDATE digestors SET status = ? WHERE id = ?", ['waiting_discharge', cyc.digestor_id], () => {
          broadcastState();
          res.json({ ok: true });
        });
      });
    });
  });
});

// -------------------- API: discharge --------------------
app.post("/api/digestor/discharge", ensureAuth, (req, res) => {
  const { digestor_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;
  if (!digestor_id) return res.status(400).json({ error: 'digestor_id required' });

  db.run("INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes) VALUES (?, NULL, ?, ?, ?, ?)",
    [digestor_id, cooking_cycle_id || null, toneladas_discarded || 0, req.session.user.id, notes || null], function(err) {
      if (err) { console.error('Err discharge:', err); return res.status(500).json({ error: err.message }); }
      db.run("UPDATE digestors SET status = ? WHERE id = ?", ['idle', digestor_id], () => {
        broadcastState();
        res.json({ discharge_id: this.lastID });
      });
    });
});

// -------------------- Historico APIs --------------------
app.get("/operador/historico", ensureAuth, (req, res) => res.render("operador_historico", { usuario: req.session.user, title: "Histórico de Ciclos" }));

app.get("/api/cycles/all", ensureAuth, (req, res) => {
  const sql = `SELECT cy.id, cy.digestor_id, cy.trituration_id, cy.cooking_id, cy.started_at, cy.ended_at, cy.status, d.nome AS digestor_name
               FROM cycles cy LEFT JOIN digestors d ON cy.digestor_id = d.id ORDER BY cy.id DESC LIMIT 200`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get("/api/cycles/:id", ensureAuth, (req, res) => {
  const { id } = req.params;
  const sql = `
    SELECT cy.*, d.nome AS digestor_name,
           tc.start_tritura_at, tc.end_tritura_at, tc.toneladas_trituradas,
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

// -------------------- PDF route (optional) --------------------
app.get("/reports/cycle/:id", ensureAuth, (req, res) => {
  if (!gerarPDFCicloUtil) return res.status(500).send("PDF util não disponível.");

  const { id } = req.params;
  const sql = `SELECT cy.*, d.nome as digestor_name, tc.*, cc.*, dd.* FROM cycles cy
               LEFT JOIN digestors d ON d.id = cy.digestor_id
               LEFT JOIN trituration_cycles tc ON tc.id = cy.trituration_id
               LEFT JOIN cooking_cycles cc ON cc.id = cy.cooking_id
               LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
               WHERE cy.id = ?`;
  db.get(sql, [id], async (err, ciclo) => {
    if (err || !ciclo) return res.status(404).send("Ciclo não encontrado");
    const fileName = `ciclo_${id}_${Date.now()}.pdf`;
    const filePath = path.join(REPORTS_DIR, fileName);
    try {
      await gerarPDFCicloUtil(ciclo, filePath);
      res.json({ url: `/reports/${fileName}` });
    } catch (e) {
      console.error("Erro gerar PDF:", e);
      res.status(500).send("Erro ao gerar PDF");
    }
  });
});

//------------------------------------------------------------
// CRIA USUÁRIO ADMINISTRADOR PADRÃO (angelo / @nloFa1107)
//------------------------------------------------------------
db.get("SELECT COUNT(*) AS cnt FROM users WHERE username = 'angelo'", [], (err, row) => {
  if (err) {
    console.error("Erro ao verificar usuário admin:", err);
    return;
  }

  if (row && row.cnt === 0) {
    console.log("📌 Criando usuário administrador padrão: angelo");

    const adminUser = "angelo";
    const adminPassword = "@nloFa1107"; // senha fornecida
    const adminName = "Administrador Angelo";

    bcrypt.hash(adminPassword, 10).then(hash => {
      db.run(
        "INSERT INTO users (username, nome, role, password) VALUES (?, ?, ?, ?)",
        [adminUser, adminName, "admin", hash],
        (e) => {
          if (e) console.error("Erro ao criar admin:", e);
          else console.log("✔ Usuário admin criado: angelo / @nloFa1107");
        }
      );
    });
  } else {
    console.log("✔ Usuário admin já existe.");
  }
});

// -------------------- Socket.IO --------------------
io.on("connection", (socket) => {
  console.log("🔌 Socket conectado:", socket.id);
  broadcastState();
  socket.on("ping", () => socket.emit("pong"));
});

// -------------------- Error handler --------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (!res.headersSent) res.status(500).send("Internal Server Error");
});

// -------------------- Start server --------------------
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log("🚀 Servidor rodando na porta", PORT));
