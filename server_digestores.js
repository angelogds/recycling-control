// server_digestores.js
// Monolítico final — BLOCOs organizados para edição por partes.
// Substitua totalmente o arquivo antigo por este.

const fs = require("fs");
const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcrypt");
const { Server } = require("socket.io");
const crypto = require("crypto");

// -------------------- PATHS --------------------
const ROOT = __dirname;
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const DEFAULT_DB_PATH = IS_PRODUCTION
  ? path.join("/data", "database.sqlite")
  : path.join(ROOT, "database.sqlite");
const DB_FILE = process.env.DB_FILE || DEFAULT_DB_PATH;
const DB_DIR = path.dirname(DB_FILE);
const SESSION_DB_FILE = process.env.SESSION_DB_FILE || "sessions.sqlite";
const SQL_INIT_FILE = path.join(ROOT, "init_db.sql");

const PUBLIC_DIR = path.join(ROOT, "public");
const VIEWS_DIR = path.join(ROOT, "views");
const REPORTS_DIR = path.join(PUBLIC_DIR, "reports");

// ensure directories
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// optional PDF util
let gerarPDFCicloUtil = null;
try {
  gerarPDFCicloUtil = require(path.join(ROOT, "utils", "pdf_ciclos"));
} catch (e) {
  console.warn("Aviso: utils/pdf_ciclos.js não encontrado — rotas de PDF ficarão indisponíveis.");
}

// -------------------- INIT DB if missing --------------------
function initDatabaseIfMissing() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(DB_FILE)) return resolve();
    if (!fs.existsSync(SQL_INIT_FILE)) {
      console.warn("init_db.sql não encontrado — DB não será criado automaticamente.");
      return resolve();
    }
    console.log("📌 database not found. Creating database from init_db.sql at:", DB_FILE);
    const sql = fs.readFileSync(SQL_INIT_FILE, "utf8");
    const tmp = new sqlite3.Database(DB_FILE, (err) => {
      if (err) return reject(err);
      tmp.exec(sql, (e) => {
        tmp.close();
        if (e) return reject(e);
        console.log("✔ Database created from init_db.sql");
        resolve();
      });
    });
  });
}

// -------------------- APP / SERVER / IO --------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// express config
app.set("views", VIEWS_DIR);
app.set("view engine", "ejs");
app.use(express.static(PUBLIC_DIR));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// sessions
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && IS_PRODUCTION) {
  console.error("❌ SESSION_SECRET não definido em produção. Defina uma chave forte no Railway.");
}
if (!sessionSecret && !IS_PRODUCTION) {
  console.warn("⚠️ SESSION_SECRET não definido. Usando segredo efêmero apenas para ambiente local.");
}
const effectiveSessionSecret = sessionSecret || crypto.randomBytes(32).toString("hex");

app.set("trust proxy", 1);
app.use(session({
  store: new SQLiteStore({ db: SESSION_DB_FILE, dir: DB_DIR }),
  secret: effectiveSessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    secure: IS_PRODUCTION,
    httpOnly: true,
    sameSite: "lax"
  } // 8 horas
}));

// -------------------- BLOCO 1: DB (após init) --------------------
let db; // will be assigned after initDatabaseIfMissing

function openDatabase() {
  return new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(DB_FILE, (err) => {
      if (err) return reject(err);
      db = conn;
      console.log("🔌 Banco SQLite conectado em:", DB_FILE);
      resolve(conn);
    });
  });
}

// -------------------- BLOCO 2: AUTH helpers & LOGIN (edit here) ==== ////

// Middleware: garantir autenticação (usa req.session.user)
function ensureAuth(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }
  // para APIs, preferir 401; para views, redirecionar
  if (req.path && (req.path.startsWith("/api") || req.path.startsWith("/reports") || req.path.startsWith("/pdf"))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return res.redirect("/login");
}

// Middleware: validar papel (role)
function ensureRole(role) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect("/login");
    const userRole = req.session.user.role || "operador";
    if (userRole !== role && userRole !== "admin") return res.status(403).send("Acesso negado");
    return next();
  };
}

// LOGIN (GET)
app.get("/login", (req, res) => {
  // mantém compatibilidade com suas views que esperam 'erro'
  res.render("login", { erro: null, title: "Login" });
});

// LOGIN (POST)
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render("login", { erro: "Usuário e senha são obrigatórios." });
  if (!db || typeof db.get !== "function") return res.render("login", { erro: "Banco de dados ainda não está pronto. Tente novamente." });

  // checar se a tabela users existe (resiliência se DB foi recriado)
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", [], (tblErr, tblRow) => {
    if (tblErr) {
      console.error("Err checking users table:", tblErr);
      return res.render("login", { erro: "Erro interno (tabela users)." });
    }
    if (!tblRow) return res.render("login", { erro: "Sistema não inicializado. Crie a tabela users." });

    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
      if (err) {
        console.error("Err DB login:", err);
        return res.render("login", { erro: "Erro interno." });
      }
      if (!user) return res.render("login", { erro: "Usuário não encontrado." });

      try {
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.render("login", { erro: "Senha inválida." });

        // popular sessão
        req.session.user = {
          id: user.id,
          username: user.username,
          nome: user.nome || user.username,
          role: user.role || "operador"
        };

        return res.redirect("/operador/painel");
      } catch (e) {
        console.error("Err bcrypt compare:", e);
        return res.render("login", { erro: "Erro interno." });
      }
    });
  });
});

// LOGOUT
app.get("/logout", (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.redirect("/login");
    });
  } else {
    res.redirect("/login");
  }
});

//// ==== END BLOCO 2 ==== ////

// -------------------- BLOCO 3: BROADCAST / SOCKET.IO --------------------
function broadcastState() {
  if (!db) return;

  // digestors + their current states
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

    Promise.all(tasks).then(list => io.emit("digestors:update", list)).catch(e => {
      console.error("Error building digestors state:", e);
      io.emit("digestors:update", digestores || []);
    });
  });

  // tovas
  db.all("SELECT id, nome, capacidade_tn, current_tn FROM tovas ORDER BY id", [], (err, rows) => {
    if (err) { console.error("DB error (tovas):", err); io.emit("tovas:update", []); }
    else io.emit("tovas:update", rows || []);
  });

  // entries (portaria)
  db.all("SELECT id, truck_plate, toneladas_declared, arrival_at, status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50", [], (err, rows) => {
    if (err) { console.error("DB error (entries):", err); io.emit("entries:update", []); }
    else io.emit("entries:update", rows || []);
  });
}

// socket events
io.on("connection", socket => {
  console.log("🔌 Socket conectado:", socket.id);
  broadcastState();
  socket.on("ping", () => socket.emit("pong"));
});

// -------------------- BLOCO 4: VIEWS e PORTARIA / TOVAS --------------------

// root redirect
app.get("/", (req, res) => res.redirect("/operador/painel"));

// healthcheck (sem autenticação)
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "recycling-control",
    timestamp: new Date().toISOString()
  });
});

// operador painel
app.get("/operador/painel", ensureAuth, (req, res) => {
  db.all("SELECT * FROM digestors ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).send("Erro ao carregar digestores");
    res.render("operador_painel", { usuario: req.session.user, digestores: rows || [] });
  });
});

// historico view
app.get("/operador/historico", ensureAuth, (req, res) => {
  res.render("operador_historico", { usuario: req.session.user, title: "Histórico de Ciclos" });
});

// dashboard view
app.get("/dashboard", ensureAuth, (req, res) => {
  res.render("dashboard", { usuario: req.session.user, title: "Dashboard" });
});

// portaria views
app.get("/portaria", ensureAuth, ensureRole("portaria"), (req, res) => {
  res.render("portaria_painel", { usuario: req.session.user });
});

app.get("/portaria/chegada", ensureAuth, ensureRole("portaria"), (req, res) => {
  res.render("portaria_chegada_form", { usuario: req.session.user });
});

app.post("/portaria/chegada", ensureAuth, ensureRole("portaria"), (req, res) => {
  const { placa, toneladas } = req.body;
  if (!placa || !toneladas) return res.status(400).send("Placa e toneladas são obrigatórios.");
  db.run("INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id) VALUES (?, ?, ?)", [placa, toneladas, req.session.user.id], function (err) {
    if (err) { console.error("Erro ao inserir entrada:", err); return res.status(500).send("Erro ao registrar chegada."); }
    broadcastState();
    res.redirect("/portaria");
  });
});

// Tovas list / edit
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
  db.run("UPDATE tovas SET nome = ?, capacidade_tn = ? WHERE id = ?", [nome, capacidade_tn, id], function (err) {
    if (err) { console.error(err); return res.status(500).send('Erro ao atualizar tova'); }
    broadcastState();
    res.redirect('/tovas');
  });
});

// -------------------- BLOCO 5: API — TRITURAÇÃO / COZIMENTO / DISCARGA / CYCLES --------------------

// API digestors details
app.get("/api/digestors", ensureAuth, (req, res) => {
  db.all("SELECT id, nome, capacidade_tn, status, last_cycle_id FROM digestors ORDER BY id", [], async (err, digestores) => {
    if (err) return res.status(500).json({ error: err.message });
    const result = [];
    for (const d of digestores) {
      const trit = await new Promise(r => db.get("SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (_, row) => r(row || null)));
      const cook = await new Promise(r => db.get("SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (_, row) => r(row || null)));
      const cycle = await new Promise(r => db.get("SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1", [d.id], (_, row) => r(row || null)));
      result.push({ ...d, current_tritura: trit, current_cooking: cook, current_cycle: cycle });
    }
    res.json(result);
  });
});

// Trituração START
app.post("/api/trituracao/start", ensureAuth, (req, res) => {
  const { digestor_id, from_tova_id, toneladas_solicitadas, materia_prima } = req.body;
  if (!digestor_id || !from_tova_id) return res.status(400).json({ error: 'Dados incompletos' });

  const now = new Date().toISOString();
  db.run(`INSERT INTO trituration_cycles (digestor_id, from_tova_id, toneladas_solicitadas, materia_prima, start_tritura_at, status, operator_id)
          VALUES (?, ?, ?, ?, ?, 'started', ?)`, [digestor_id, from_tova_id, toneladas_solicitadas || 0, materia_prima || null, now, req.session.user.id], function (err) {
    if (err) { console.error('Err start trit:', err); return res.status(500).json({ error: err.message }); }
    const tritId = this.lastID;
    db.run(`INSERT INTO cycles (digestor_id, trituration_id, started_at, status) VALUES (?, ?, ?, 'in_progress')`, [digestor_id, tritId, now], function (cErr) {
      if (cErr) console.error("Err Create Cycle:", cErr);
      db.run("UPDATE digestors SET status = ? WHERE id = ?", ['operating', digestor_id], () => {
        broadcastState();
        res.json({ trituration_id: tritId, started_at: now });
      });
    });
  });
});

// Trituração FINISH -> start cooking automatically
app.post("/api/trituracao/finish", ensureAuth, (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  if (!trituration_id) return res.status(400).json({ error: 'Dados incompletos' });

  const now = new Date().toISOString();
  db.run(`UPDATE trituration_cycles SET end_tritura_at = ?, toneladas_trituradas = ?, status = 'finished' WHERE id = ?`, [now, toneladas_trituradas || 0, trituration_id], function (err) {
    if (err) { console.error('Err finish trit:', err); return res.status(500).json({ error: err.message }); }
    db.get("SELECT digestor_id FROM trituration_cycles WHERE id = ?", [trituration_id], (e, row) => {
      if (e || !row) { broadcastState(); return res.json({ ok: true }); }
      startCooking(row.digestor_id, trituration_id, req.session.user, res);
    });
  });
});

// helper to start cooking automatically
function startCooking(digestor_id, trituration_id, operatorUser = { id: 1 }, res = null) {
  const now = new Date().toISOString();
  db.run(`INSERT INTO cooking_cycles (digestor_id, trituration_id, start_cook_at, status, operator_id) VALUES (?, ?, ?, 'started', ?)`, [digestor_id, trituration_id, now, operatorUser.id], function (err) {
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

// Cooking FINISH
app.post("/api/cooking/finish", ensureAuth, (req, res) => {
  const { cooking_id } = req.body;
  if (!cooking_id) return res.status(400).json({ error: 'cooking_id required' });

  const now = new Date().toISOString();
  db.run("UPDATE cooking_cycles SET end_cook_at = ?, status = 'finished' WHERE id = ?", [now, cooking_id], function (err) {
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

// Discharge
app.post("/api/digestor/discharge", ensureAuth, (req, res) => {
  const { digestor_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;
  if (!digestor_id) return res.status(400).json({ error: 'digestor_id required' });

  db.run(`INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes)
          VALUES (?, NULL, ?, ?, ?, ?)`, [digestor_id, cooking_cycle_id || null, toneladas_discarded || 0, req.session.user.id, notes || null], function (err) {
    if (err) { console.error('Err discharge:', err); return res.status(500).json({ error: err.message }); }
    db.run("UPDATE digestors SET status = ? WHERE id = ?", ['idle', digestor_id], () => {
      broadcastState();
      res.json({ discharge_id: this.lastID });
    });
  });
});

// Cycles history
app.get("/api/cycles/all", ensureAuth, (req, res) => {
  const sql = `SELECT cy.id, cy.digestor_id, cy.trituration_id, cy.cooking_id, cy.started_at, cy.ended_at, cy.status,
                      d.nome AS digestor_name,
                      tc.start_tritura_at, tc.end_tritura_at, tc.toneladas_trituradas,
                      cc.start_cook_at, cc.end_cook_at
               FROM cycles cy
               LEFT JOIN digestors d ON cy.digestor_id = d.id
               LEFT JOIN trituration_cycles tc ON cy.trituration_id = tc.id
               LEFT JOIN cooking_cycles cc ON cy.cooking_id = cc.id
               ORDER BY cy.id DESC LIMIT 200`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get("/api/cycles/:id", ensureAuth, (req, res) => {
  const id = req.params.id;
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
    WHERE cy.id = ?`;
  db.get(sql, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Ciclo não encontrado" });
    res.json(row);
  });
});

// PDF route (optional)
app.get("/reports/cycle/:id", ensureAuth, (req, res) => {
  if (!gerarPDFCicloUtil) return res.status(500).send("PDF util não disponível.");
  const id = req.params.id;
  const sql = `SELECT cy.*, d.nome AS digestor_name, tc.*, cc.*, dd.* FROM cycles cy
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
      console.error("Erro gerando PDF:", e);
      res.status(500).send("Erro ao gerar PDF");
    }
  });
});

// -------------------- BLOCO 6: ADMIN USERS CRUD --------------------

// list
app.get("/admin/users", ensureAuth, ensureRole("admin"), (req, res) => {
  db.all("SELECT id, username, nome, role FROM users ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).send("Erro DB");
    res.render("admin_users_list", { usuario: req.session.user, users: rows || [] });
  });
});

// new form
app.get("/admin/users/new", ensureAuth, ensureRole("admin"), (req, res) => {
  res.render("admin_users_new", { usuario: req.session.user, error: null });
});

// create
app.post("/admin/users", ensureAuth, ensureRole("admin"), async (req, res) => {
  const { username, nome, password, role } = req.body;
  if (!username || !password) return res.render("admin_users_new", { usuario: req.session.user, error: "Usuário e senha obrigatórios" });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run("INSERT INTO users (username, nome, role, password) VALUES (?, ?, ?, ?)", [username, nome || username, role || "operador", hash], (err) => {
      if (err) { console.error("Err create user:", err); return res.render("admin_users_new", { usuario: req.session.user, error: "Erro ao criar usuário" }); }
      res.redirect("/admin/users");
    });
  } catch (e) {
    console.error("Err bcrypt create:", e);
    res.render("admin_users_new", { usuario: req.session.user, error: "Erro interno" });
  }
});

// edit form
app.get("/admin/users/:id/edit", ensureAuth, ensureRole("admin"), (req, res) => {
  const id = req.params.id;
  db.get("SELECT id, username, nome, role FROM users WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).send("Erro DB");
    if (!row) return res.status(404).send("Usuário não encontrado");
    res.render("admin_users_edit", { usuario: req.session.user, user: row, error: null });
  });
});

// update
app.post("/admin/users/:id/update", ensureAuth, ensureRole("admin"), async (req, res) => {
  const id = req.params.id;
  const { nome, role, password } = req.body;
  if (password && password.length > 0) {
    try {
      const hash = await bcrypt.hash(password, 10);
      db.run("UPDATE users SET nome = ?, role = ?, password = ? WHERE id = ?", [nome, role, hash, id], (err) => {
        if (err) { console.error("Err update user:", err); return res.status(500).send("Erro ao atualizar"); }
        res.redirect("/admin/users");
      });
    } catch (e) {
      console.error("Err bcrypt update:", e); return res.status(500).send("Erro interno");
    }
  } else {
    db.run("UPDATE users SET nome = ?, role = ? WHERE id = ?", [nome, role, id], (err) => {
      if (err) { console.error("Err update user:", err); return res.status(500).send("Erro ao atualizar"); }
      res.redirect("/admin/users");
    });
  }
});

// delete
app.post("/admin/users/:id/delete", ensureAuth, ensureRole("admin"), (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM users WHERE id = ?", [id], (err) => {
    if (err) { console.error("Err delete user:", err); return res.status(500).send("Erro ao excluir"); }
    res.redirect("/admin/users");
  });
});

// -------------------- Error handler --------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (!res.headersSent) res.status(500).send("Internal Server Error");
});

// -------------------- BOOTSTRAP: init DB, open, seed admin --------------------
function seedAdminIfNeeded() {
  return new Promise((resolve) => {
    if (!db || typeof db.get !== "function") {
      console.error("DB não inicializado: seed de admin ignorado para evitar crash.");
      return resolve("ignored_db_not_ready");
    }

    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", [], (err, tbl) => {
      if (err) {
        console.error("Erro ao verificar tabela users:", err);
        return resolve("ignored_users_table_check_error");
      }
      if (!tbl) {
        console.warn("⚠️ Tabela 'users' não encontrada. Seed de admin ignorado.");
        return resolve("ignored_users_table_missing");
      }

      db.get("SELECT COUNT(*) AS cnt FROM users", [], (err2, row) => {
        if (err2) {
          console.error("Erro ao contar usuários:", err2);
          return resolve("ignored_users_count_error");
        }

        const cnt = row?.cnt || 0;
        if (cnt > 0) {
          console.log(`ℹ️ Seed admin ignorado: já existem ${cnt} usuário(s) cadastrados.`);
          return resolve("ignored_users_exist");
        }

        const adminUsername = process.env.ADMIN_USERNAME;
        const adminNome = process.env.ADMIN_NOME || "Administrador";
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminUsername || !adminPassword) {
          console.warn("⚠️ Seed admin ignorado: defina ADMIN_USERNAME e ADMIN_PASSWORD para criação automática do primeiro usuário.");
          return resolve("ignored_missing_env");
        }

        bcrypt.hash(adminPassword, 10)
          .then((hash) => {
            db.run(
              "INSERT INTO users (username, nome, role, password) VALUES (?, ?, ?, ?)",
              [adminUsername, adminNome, "admin", hash],
              (e) => {
                if (e) {
                  console.error("Erro ao criar admin automático:", e);
                  return resolve("error_insert_admin");
                }
                console.log(`✅ Usuário admin inicial criado: ${adminUsername}`);
                return resolve("created_admin");
              }
            );
          })
          .catch((e) => {
            console.error("Erro ao gerar hash do admin automático:", e);
            return resolve("error_hash_admin");
          });
      });
    });
  });
}

(async function bootstrap() {
  console.log("🟦 Boot do recycling-control iniciado");
  console.log(`🌎 Ambiente: ${NODE_ENV}`);
  console.log(`🗄️ Banco SQLite: ${DB_FILE}`);
  console.log(`🧾 Sessões SQLite: ${path.join(DB_DIR, SESSION_DB_FILE)}`);

  try {
    const databaseExisted = fs.existsSync(DB_FILE);
    await initDatabaseIfMissing();
    console.log(databaseExisted ? "ℹ️ Banco existente reutilizado." : "✅ Banco criado automaticamente a partir do init_db.sql.");
  } catch (e) {
    console.error("❌ Erro ao inicializar banco:", e);
  }

  let adminSeedStatus = "not_started";
  try {
    await openDatabase();
    adminSeedStatus = await seedAdminIfNeeded();
  } catch (err) {
    console.error("❌ Erro ao conectar no SQLite:", err);
  }

  const PORT = process.env.PORT || 3002;
  server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado na porta ${PORT}`);
    console.log(`❤️ Healthcheck disponível em /health`);
    console.log(`👤 Seed admin status: ${adminSeedStatus}`);
  });
})();
