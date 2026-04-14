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
const PDFDocument = require("pdfkit");
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

function ensureUsersColumns() {
  return new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(users)", [], (err, columns) => {
      if (err) return reject(err);
      const names = new Set((columns || []).map((c) => c.name));
      if (names.has("email")) return resolve();
      db.run("ALTER TABLE users ADD COLUMN email TEXT", [], (alterErr) => {
        if (alterErr) return reject(alterErr);
        resolve();
      });
    });
  });
}

function ensureEntriesColumns() {
  return new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(entries)", [], (err, columns) => {
      if (err) return reject(err);
      const names = new Set((columns || []).map((c) => c.name));
      const alters = [];

      if (!names.has("yard_at")) alters.push("ALTER TABLE entries ADD COLUMN yard_at TEXT");
      if (!names.has("start_unload_at")) alters.push("ALTER TABLE entries ADD COLUMN start_unload_at TEXT");
      if (!names.has("end_unload_at")) alters.push("ALTER TABLE entries ADD COLUMN end_unload_at TEXT");

      function runNext(idx) {
        if (idx >= alters.length) return resolve();
        db.run(alters[idx], [], (alterErr) => {
          if (alterErr) return reject(alterErr);
          runNext(idx + 1);
        });
      }

      runNext(0);
    });
  });
}

function ensureCookingColumns() {
  return new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(cooking_cycles)", [], (err, columns) => {
      if (err) return reject(err);
      const names = new Set((columns || []).map((c) => c.name));
      if (names.has("alert_note")) return resolve();
      db.run("ALTER TABLE cooking_cycles ADD COLUMN alert_note TEXT", [], (alterErr) => {
        if (alterErr) return reject(alterErr);
        resolve();
      });
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
  const identifier = (req.body.identifier || req.body.username || "").trim();
  const { password } = req.body;
  if (!identifier || !password) return res.render("login", { erro: "Usuário/e-mail e senha são obrigatórios." });
  if (!db || typeof db.get !== "function") return res.render("login", { erro: "Banco de dados ainda não está pronto. Tente novamente." });

  // checar se a tabela users existe (resiliência se DB foi recriado)
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", [], (tblErr, tblRow) => {
    if (tblErr) {
      console.error("Err checking users table:", tblErr);
      return res.render("login", { erro: "Erro interno (tabela users)." });
    }
    if (!tblRow) return res.render("login", { erro: "Sistema não inicializado. Crie a tabela users." });

    const loginField = identifier.includes("@") ? "email" : "username";
    db.get(`SELECT * FROM users WHERE ${loginField} = ?`, [identifier], async (err, user) => {
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
  db.all("SELECT id, truck_plate, toneladas_declared, arrival_at, yard_at, start_unload_at, end_unload_at, status FROM entries WHERE status IN ('arrived','yard','unloading') ORDER BY arrival_at DESC LIMIT 50", [], (err, rows) => {
    if (err) { console.error("DB error (entries):", err); io.emit("entries:update", []); }
    else io.emit("entries:update", rows || []);
  });

  db.all("SELECT id, truck_plate, toneladas_declared, arrival_at, end_unload_at FROM entries WHERE status = 'reception_finished' ORDER BY arrival_at DESC LIMIT 50", [], (err, rows) => {
    if (err) { console.error("DB error (entries finished):", err); io.emit("entries:finished:update", []); }
    else io.emit("entries:finished:update", rows || []);
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


app.get("/api/dashboard/productivity", ensureAuth, (req, res) => {
  const dateStr = (req.query.date || new Date().toISOString().slice(0, 10));
  const shift = (req.query.shift || "morning").toLowerCase();
  const dailyGoalTons = Number(process.env.DAILY_GOAL_TONS || 120);

  function shiftRange(referenceDate, selectedShift) {
    const [year, month, day] = referenceDate.split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 1, day, 6, 0, 0));
    const end = new Date(Date.UTC(year, month - 1, day, 14, 0, 0));

    if (selectedShift === "afternoon") {
      start.setUTCHours(14, 0, 0, 0);
      end.setUTCHours(22, 0, 0, 0);
      return { startIso: start.toISOString(), endIso: end.toISOString() };
    }

    if (selectedShift === "night") {
      start.setUTCHours(22, 0, 0, 0);
      end.setUTCDate(end.getUTCDate() + 1);
      end.setUTCHours(6, 0, 0, 0);
      return { startIso: start.toISOString(), endIso: end.toISOString() };
    }

    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }

  const { startIso, endIso } = shiftRange(dateStr, shift);

  db.get("SELECT COALESCE(SUM(toneladas_trituradas), 0) AS toneladas_hoje FROM trituration_cycles WHERE date(end_tritura_at) = date('now')", [], (tonsErr, tonsRow) => {
    if (tonsErr) return res.status(500).json({ error: tonsErr.message });

    db.get("SELECT COUNT(*) AS entradas_hoje FROM entries WHERE date(arrival_at) = date('now')", [], (entriesErr, entriesRow) => {
      if (entriesErr) return res.status(500).json({ error: entriesErr.message });

      db.get("SELECT COUNT(*) AS ciclos_ativos FROM cycles WHERE status = 'in_progress'", [], (activeErr, activeRow) => {
        if (activeErr) return res.status(500).json({ error: activeErr.message });

        db.get("SELECT COUNT(*) AS ciclos_finalizados_hoje FROM cycles WHERE status = 'finished' AND date(ended_at) = date('now')", [], (finishedErr, finishedRow) => {
          if (finishedErr) return res.status(500).json({ error: finishedErr.message });

          db.all(`SELECT d.id, d.nome,
                         COALESCE(SUM(CASE WHEN date(tc.end_tritura_at) = date('now') THEN tc.toneladas_trituradas ELSE 0 END), 0) AS toneladas_hoje,
                         COALESCE(COUNT(DISTINCT CASE WHEN date(cy.ended_at) = date('now') THEN cy.id END), 0) AS ciclos_hoje
                  FROM digestors d
                  LEFT JOIN trituration_cycles tc ON tc.digestor_id = d.id
                  LEFT JOIN cycles cy ON cy.digestor_id = d.id
                  GROUP BY d.id, d.nome
                  ORDER BY d.id`, [], (digestorErr, digestorRows) => {
            if (digestorErr) return res.status(500).json({ error: digestorErr.message });

            db.all(`SELECT
                      COALESCE(u.nome, u.email, 'Operador #' || tc.operator_id) AS operador,
                      COUNT(tc.id) AS ciclos,
                      COALESCE(SUM(tc.toneladas_trituradas), 0) AS toneladas
                    FROM trituration_cycles tc
                    LEFT JOIN users u ON u.id = tc.operator_id
                    WHERE tc.start_tritura_at >= ? AND tc.start_tritura_at < ?
                    GROUP BY tc.operator_id, u.nome, u.email
                    ORDER BY toneladas DESC, ciclos DESC
                    LIMIT 10`, [startIso, endIso], (rankingErr, rankingRows) => {
              if (rankingErr) return res.status(500).json({ error: rankingErr.message });

              const toneladasHoje = Number(tonsRow?.toneladas_hoje || 0);
              const goalProgress = dailyGoalTons > 0 ? Math.min(100, (toneladasHoje / dailyGoalTons) * 100) : 0;

              res.json({
                meta_diaria_tn: dailyGoalTons,
                progresso_meta_percentual: Number(goalProgress.toFixed(1)),
                resumo: {
                  entradas_hoje: Number(entriesRow?.entradas_hoje || 0),
                  toneladas_hoje: Number(toneladasHoje.toFixed(2)),
                  ciclos_ativos: Number(activeRow?.ciclos_ativos || 0),
                  ciclos_finalizados_hoje: Number(finishedRow?.ciclos_finalizados_hoje || 0)
                },
                throughput_por_digestor: (digestorRows || []).map((row) => ({
                  digestor_id: row.id,
                  digestor_nome: row.nome,
                  toneladas_hoje: Number(Number(row.toneladas_hoje || 0).toFixed(2)),
                  ciclos_hoje: Number(row.ciclos_hoje || 0)
                })),
                ranking_turno: rankingRows || [],
                turno: {
                  referencia: dateStr,
                  nome: shift,
                  inicio: startIso,
                  fim: endIso
                }
              });
            });
          });
        });
      });
    });
  });
});

// portaria views
app.get("/portaria", ensureAuth, ensureRole("portaria"), (req, res) => {
  res.render("portaria_painel", { usuario: req.session.user });
});

app.get("/portaria/chegada", ensureAuth, ensureRole("portaria"), (req, res) => {
  res.render("portaria_chegada_form", { usuario: req.session.user });
});

app.post("/portaria/chegada", ensureAuth, ensureRole("portaria"), (req, res) => {
  const frota = (req.body.frota || req.body.placa || "").trim();
  const toneladas = req.body.toneladas;
  if (!frota || !toneladas) return res.status(400).send("Frota e toneladas são obrigatórios.");
  const now = new Date().toISOString();
  db.run("INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id, status, yard_at, arrival_at) VALUES (?, ?, ?, 'yard', ?, ?)", [frota, toneladas, req.session.user.id, now, now], function (err) {
    if (err) { console.error("Erro ao inserir entrada:", err); return res.status(500).send("Erro ao registrar chegada."); }
    broadcastState();
    res.redirect("/portaria");
  });
});

app.post("/api/entries/:id/finish", ensureAuth, ensureRole("portaria"), (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  db.run("UPDATE entries SET status = 'reception_finished' WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    broadcastState();
    return res.json({ ok: true });
  });
});

app.get("/api/entries/yard", ensureAuth, (req, res) => {
  db.all(
    "SELECT id, truck_plate, toneladas_declared, arrival_at, yard_at, start_unload_at, end_unload_at, status FROM entries WHERE status IN ('arrived','yard','unloading') ORDER BY arrival_at DESC LIMIT 100",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      return res.json(rows || []);
    }
  );
});

app.post("/api/entries/:id/start-unload", ensureAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const now = new Date().toISOString();
  db.run(
    "UPDATE entries SET status = 'unloading', start_unload_at = COALESCE(start_unload_at, ?) WHERE id = ? AND status IN ('arrived','yard','unloading')",
    [now, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Entrada não encontrada ou já finalizada." });
      broadcastState();
      return res.json({ ok: true, started_at: now });
    }
  );
});

app.post("/api/entries/:id/finish-unload", ensureAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const now = new Date().toISOString();
  db.run(
    "UPDATE entries SET status = 'reception_finished', end_unload_at = ?, start_unload_at = COALESCE(start_unload_at, ?) WHERE id = ? AND status IN ('arrived','yard','unloading')",
    [now, now, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Entrada não encontrada ou já finalizada." });
      broadcastState();
      return res.json({ ok: true, finished_at: now });
    }
  );
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

// Trituração FINISH
app.post("/api/trituracao/finish", ensureAuth, (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  if (!trituration_id) return res.status(400).json({ error: 'Dados incompletos' });

  const now = new Date().toISOString();
  db.get("SELECT digestor_id FROM trituration_cycles WHERE id = ?", [trituration_id], (findErr, trit) => {
    if (findErr) return res.status(500).json({ error: findErr.message });
    if (!trit) return res.status(404).json({ error: "Trituração não encontrada" });

    db.run(`UPDATE trituration_cycles SET end_tritura_at = ?, toneladas_trituradas = ?, status = 'finished' WHERE id = ?`, [now, toneladas_trituradas || 0, trituration_id], function (err) {
      if (err) { console.error('Err finish trit:', err); return res.status(500).json({ error: err.message }); }

      db.get("SELECT id FROM cooking_cycles WHERE trituration_id = ? AND status IN ('created','started') LIMIT 1", [trituration_id], (cookErr, row) => {
        if (cookErr) return res.status(500).json({ error: cookErr.message });
        if (row) {
          broadcastState();
          return res.json({ ok: true, finished_at: now, cooking_already_started: true });
        }
        return startCooking(trit.digestor_id, trituration_id, req.session.user, res);
      });
    });
  });
});

// helper to start cooking
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

app.post("/api/cooking/start", ensureAuth, (req, res) => {
  const { digestor_id, trituration_id } = req.body;
  if (!digestor_id || !trituration_id) return res.status(400).json({ error: "digestor_id e trituration_id são obrigatórios" });
  db.get("SELECT id FROM cooking_cycles WHERE trituration_id = ? AND status IN ('created','started') LIMIT 1", [trituration_id], (e, row) => {
    if (e) return res.status(500).json({ error: e.message });
    if (row) return res.status(409).json({ error: "Já existe cozimento ativo para esta trituração." });
    return startCooking(digestor_id, trituration_id, req.session.user, res);
  });
});

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

app.post("/api/cooking/:id/alert-note", ensureAuth, (req, res) => {
  const id = Number(req.params.id);
  const note = String(req.body.note || "").trim();
  if (!id) return res.status(400).json({ error: "cooking_id inválido" });
  if (!note) return res.status(400).json({ error: "Descrição é obrigatória." });

  db.run("UPDATE cooking_cycles SET alert_note = ? WHERE id = ?", [note, id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    broadcastState();
    return res.json({ ok: true });
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
  db.all("SELECT id, username, nome, email, role FROM users ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).send("Erro DB");
    db.get("SELECT COUNT(*) AS total_gestores FROM users WHERE role = 'admin'", [], (countErr, countRow) => {
      if (countErr) return res.status(500).send("Erro DB");
      db.get("SELECT COUNT(*) AS total_digestores FROM digestors", [], (digErr, digRow) => {
        if (digErr) return res.status(500).send("Erro DB");
        res.render("admin_users_list", {
          usuario: req.session.user,
          users: rows || [],
          totalGestores: Number(countRow?.total_gestores || 0),
          totalDigestores: Number(digRow?.total_digestores || 0)
        });
      });
    });
  });
});

// new form
app.get("/admin/users/new", ensureAuth, ensureRole("admin"), (req, res) => {
  res.render("admin_users_new", { usuario: req.session.user, error: null });
});

// create
app.post("/admin/users", ensureAuth, ensureRole("admin"), async (req, res) => {
  const { username, nome, email, password, role } = req.body;
  if (!username || !password) return res.render("admin_users_new", { usuario: req.session.user, error: "Usuário e senha obrigatórios" });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      "INSERT INTO users (username, nome, email, role, password) VALUES (?, ?, ?, ?, ?)",
      [username, nome || username, email || null, role || "operador", hash],
      (err) => {
        if (err) { console.error("Err create user:", err); return res.render("admin_users_new", { usuario: req.session.user, error: "Erro ao criar usuário" }); }
        res.redirect("/admin/users");
      }
    );
  } catch (e) {
    console.error("Err bcrypt create:", e);
    res.render("admin_users_new", { usuario: req.session.user, error: "Erro interno" });
  }
});

// edit form
app.get("/admin/users/:id/edit", ensureAuth, ensureRole("admin"), (req, res) => {
  const id = req.params.id;
  db.get("SELECT id, username, nome, email, role FROM users WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).send("Erro DB");
    if (!row) return res.status(404).send("Usuário não encontrado");
    res.render("admin_users_edit", { usuario: req.session.user, user: row, error: null });
  });
});

// update
app.post("/admin/users/:id/update", ensureAuth, ensureRole("admin"), async (req, res) => {
  const id = req.params.id;
  const { nome, email, role, password } = req.body;
  if (password && password.length > 0) {
    try {
      const hash = await bcrypt.hash(password, 10);
      db.run("UPDATE users SET nome = ?, email = ?, role = ?, password = ? WHERE id = ?", [nome, email || null, role, hash, id], (err) => {
        if (err) { console.error("Err update user:", err); return res.status(500).send("Erro ao atualizar"); }
        res.redirect("/admin/users");
      });
    } catch (e) {
      console.error("Err bcrypt update:", e); return res.status(500).send("Erro interno");
    }
  } else {
    db.run("UPDATE users SET nome = ?, email = ?, role = ? WHERE id = ?", [nome, email || null, role, id], (err) => {
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

function parseReportDateInput(inputDate) {
  const d = inputDate && /^\d{4}-\d{2}-\d{2}$/.test(inputDate) ? inputDate : new Date().toISOString().slice(0, 10);
  const start = new Date(`${d}T00:00:00.000Z`).toISOString();
  const end = new Date(`${d}T23:59:59.999Z`).toISOString();
  return { date: d, start, end };
}

function getDailyReportData(inputDate, callback) {
  const { date, start, end } = parseReportDateInput(inputDate);
  const report = { date, toneladas_processadas_dia: 0, frotas_utilizadas: [], digestores: [] };
  db.get(
    `SELECT COALESCE(SUM(toneladas_trituradas), 0) AS total
     FROM trituration_cycles
     WHERE end_tritura_at BETWEEN ? AND ?`,
    [start, end],
    (errT, tonRow) => {
      if (errT) return callback(errT);
      report.toneladas_processadas_dia = Number(tonRow?.total || 0);
      db.all(
        `SELECT DISTINCT truck_plate AS frota
         FROM entries
         WHERE arrival_at BETWEEN ? AND ?
         ORDER BY truck_plate`,
        [start, end],
        (errF, frotaRows) => {
          if (errF) return callback(errF);
          report.frotas_utilizadas = (frotaRows || []).map((r) => r.frota).filter(Boolean);
          const sqlDigestores = `
            SELECT
              d.id,
              d.nome,
              COALESCE(SUM(tc.toneladas_trituradas), 0) AS toneladas_processadas,
              COALESCE(SUM((julianday(cy.ended_at) - julianday(cy.started_at)) * 24 * 60), 0) AS tempo_total_min,
              COUNT(cy.id) AS ciclos_total
            FROM digestors d
            LEFT JOIN cycles cy
              ON cy.digestor_id = d.id
              AND cy.started_at BETWEEN ? AND ?
              AND cy.status = 'finished'
            LEFT JOIN trituration_cycles tc ON tc.id = cy.trituration_id
            GROUP BY d.id, d.nome
            ORDER BY d.id
          `;
          db.all(sqlDigestores, [start, end], (errD, digRows) => {
            if (errD) return callback(errD);
            const digestores = (digRows || []).map((d) => ({
              id: d.id,
              nome: d.nome,
              toneladas_processadas: Number(d.toneladas_processadas || 0),
              tempo_total_min: Math.round(Number(d.tempo_total_min || 0)),
              ciclos_total: Number(d.ciclos_total || 0),
              ciclos: []
            }));
            const cycleSql = `
              SELECT
                cy.id AS cycle_id,
                cy.digestor_id,
                cy.started_at,
                cy.ended_at,
                ROUND((julianday(cy.ended_at) - julianday(cy.started_at)) * 24 * 60) AS tempo_ciclo_min
              FROM cycles cy
              WHERE cy.started_at BETWEEN ? AND ?
                AND cy.status = 'finished'
              ORDER BY cy.digestor_id, cy.id
            `;
            db.all(cycleSql, [start, end], (errC, cycleRows) => {
              if (errC) return callback(errC);
              const byDigestor = new Map(digestores.map((d) => [d.id, d]));
              (cycleRows || []).forEach((c) => {
                const group = byDigestor.get(c.digestor_id);
                if (!group) return;
                group.ciclos.push({
                  cycle_id: c.cycle_id,
                  started_at: c.started_at,
                  ended_at: c.ended_at,
                  tempo_ciclo_min: Number(c.tempo_ciclo_min || 0)
                });
              });
              report.digestores = digestores;
              return callback(null, report);
            });
          });
        }
      );
    }
  );
}

app.get("/admin/reports", ensureAuth, ensureRole("admin"), (req, res) => {
  res.render("admin_reports", { usuario: req.session.user, defaultDate: new Date().toISOString().slice(0, 10) });
});

app.get("/api/admin/reports/daily", ensureAuth, ensureRole("admin"), (req, res) => {
  getDailyReportData(req.query.date, (err, report) => {
    if (err) return res.status(500).json({ error: err.message });
    return res.json(report);
  });
});

app.get("/admin/reports/daily/pdf", ensureAuth, ensureRole("admin"), (req, res) => {
  const { date } = parseReportDateInput(req.query.date);
  getDailyReportData(date, (err, report) => {
    if (err) return res.status(500).send("Erro ao gerar relatório diário");
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=relatorio_diario_${date}.pdf`);
    doc.pipe(res);

    doc.fontSize(18).text("Relatório Diário de Produção");
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Data: ${report.date}`);
    doc.text(`Toneladas processadas no dia: ${report.toneladas_processadas_dia}`);
    doc.text(`Frotas utilizadas: ${report.frotas_utilizadas.join(", ") || "Nenhuma"}`);
    doc.moveDown();

    report.digestores.forEach((d) => {
      doc.fontSize(13).text(`${d.nome}`, { underline: true });
      doc.fontSize(11).text(`Toneladas: ${d.toneladas_processadas}`);
      doc.text(`Tempo total de processamento: ${d.tempo_total_min} min`);
      doc.text(`Ciclos do dia: ${d.ciclos_total}`);
      d.ciclos.forEach((c) => doc.text(`• Ciclo ${c.cycle_id}: ${c.tempo_ciclo_min} min (${c.started_at} → ${c.ended_at})`));
      doc.moveDown(0.6);
    });
    doc.end();
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

function seedFactoryDefaultsIfNeeded() {
  return new Promise((resolve) => {
    if (!db || typeof db.get !== "function") {
      console.error("DB não inicializado: seed de fábrica ignorado.");
      return resolve("ignored_db_not_ready");
    }

    db.get("SELECT COUNT(*) AS cnt FROM digestors", [], (digErr, digRow) => {
      if (digErr) {
        console.error("Erro ao contar digestores:", digErr);
        return resolve("error_count_digestors");
      }

      const digestorCount = Number(digRow?.cnt || 0);
      if (digestorCount === 0) {
        db.run(
          `INSERT INTO digestors (id, nome, capacidade_tn, status)
           VALUES
             (1, 'Digestor 1', 20, 'idle'),
             (2, 'Digestor 2', 20, 'idle'),
             (3, 'Digestor 3', 25, 'idle'),
             (4, 'Digestor 4', 25, 'idle')`,
          [],
          (insertErr) => {
            if (insertErr) {
              console.error("Erro ao inserir digestores padrão:", insertErr);
              return resolve("error_insert_digestors");
            }
            console.log("✅ Digestores padrão criados (1 a 4).");
          }
        );
      }

      db.get("SELECT COUNT(*) AS cnt FROM tovas", [], (tovaErr, tovaRow) => {
        if (tovaErr) {
          console.error("Erro ao contar tovas:", tovaErr);
          return resolve(digestorCount === 0 ? "created_digestors_only" : "error_count_tovas");
        }

        const tovaCount = Number(tovaRow?.cnt || 0);
        if (tovaCount > 0) {
          return resolve(digestorCount === 0 ? "created_digestors" : "already_seeded");
        }

        db.run(
          `INSERT INTO tovas (id, nome, capacidade_tn, current_tn)
           VALUES
             (1, 'Tova A', 15, 8),
             (2, 'Tova B', 20, 15),
             (3, 'Tova C', 18, 12)`,
          [],
          (insertTovaErr) => {
            if (insertTovaErr) {
              console.error("Erro ao inserir tovas padrão:", insertTovaErr);
              return resolve(digestorCount === 0 ? "created_digestors_error_tovas" : "error_insert_tovas");
            }
            console.log("✅ Tovas padrão criadas (A, B e C).");
            return resolve(digestorCount === 0 ? "created_digestors_and_tovas" : "created_tovas");
          }
        );
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
  let factorySeedStatus = "not_started";
  try {
    await openDatabase();
    await ensureUsersColumns();
    await ensureEntriesColumns();
    await ensureCookingColumns();
    adminSeedStatus = await seedAdminIfNeeded();
    factorySeedStatus = await seedFactoryDefaultsIfNeeded();
  } catch (err) {
    console.error("❌ Erro ao conectar no SQLite:", err);
  }

  const PORT = process.env.PORT || 3002;
  server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado na porta ${PORT}`);
    console.log(`❤️ Healthcheck disponível em /health`);
    console.log(`👤 Seed admin status: ${adminSeedStatus}`);
    console.log(`🏭 Seed fábrica status: ${factorySeedStatus}`);
  });
})();
