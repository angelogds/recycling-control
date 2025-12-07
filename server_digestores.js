// server_digestores.js
// Versão completa — login/session, painel operador, portaria, tovas, histórico, realtime, PDF opcional
const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const bcrypt = require("bcrypt");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// -------------------- Paths / DB --------------------
const ROOT = __dirname;
const DATA_DIR = path.join("/app", "data"); // Railway mount suggestion
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "database.sqlite");
const SQL_INIT_FILE = path.join(ROOT, "init_db.sql");

const PUBLIC_DIR = path.join(ROOT, "public");
const VIEWS_DIR = path.join(ROOT, "views");
const REPORTS_DIR = path.join(PUBLIC_DIR, "reports");

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// Create DB from SQL if missing
if (!fs.existsSync(DB_FILE) && fs.existsSync(SQL_INIT_FILE)) {
  try {
    console.log("📌 database not found. Creating database from init_db.sql at:", DB_FILE);
    const sql = fs.readFileSync(SQL_INIT_FILE, "utf8");
    const tmp = new sqlite3.Database(DB_FILE);
    tmp.exec(sql, (err) => {
      if (err) console.error("Erro ao executar init_db.sql:", err);
      else console.log("✔ Database created from init_db.sql");
      tmp.close();
    });
  } catch (e) {
    console.error("Erro criando DB:", e);
  }
}

// -------------------- Express / View engine / Middlewares --------------------
app.set("views", VIEWS_DIR);
app.set("view engine", "ejs");
app.use(express.static(PUBLIC_DIR));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// session (dev-friendly MemoryStore — change in production)
app.use(session({
  name: "rc.sid",
  secret: process.env.SESSION_SECRET || "change-me-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 3600 * 1000 } // 1 day
}));

// -------------------- Database --------------------
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error("SQLite open error:", err);
  else console.log("🔌 SQLite conectado em:", DB_FILE);
});

// -------------------- Optional PDF util --------------------
let gerarPDFCiclo = null;
try {
  gerarPDFCiclo = require(path.join(ROOT, "utils", "pdf_ciclos"));
} catch (e) {
  console.warn("Aviso: utils/pdf_ciclos.js não encontrado ou falhou ao requerer. Rotas de PDF ficarão indisponíveis (se desejar, adicione utils/pdf_ciclos.js).");
}

// -------------------- Auth helpers --------------------
function ensureAuth(req, res, next) {
  if (req.session && req.session.userId) {
    // fetch user quick attach (optional)
    db.get("SELECT id, username, nome, role FROM users WHERE id = ?", [req.session.userId], (err, user) => {
      if (!err && user) {
        req.user = user;
        return next();
      }
      return res.redirect("/login");
    });
  } else {
    return res.redirect("/login");
  }
}

// Render login page (simple)
app.get("/login", (req, res) => {
  res.render("login", { error: null, title: "Login" });
});

// Handle login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render("login", { error: "Usuário e senha são obrigatórios." });

  db.get("SELECT * FROM users WHERE username = ? LIMIT 1", [username], (err, user) => {
    if (err) {
      console.error("DB err login:", err);
      return res.render("login", { error: "Erro no servidor." });
    }
    if (!user) return res.render("login", { error: "Usuário não encontrado." });

    // try bcrypt compare, fallback to plain text (if DB seeded without hash)
    const tryCompare = async () => {
      try {
        const match = await bcrypt.compare(password, user.password || "");
        return match;
      } catch (e) {
        return false;
      }
    };

    (async () => {
      const isMatch = (user.password && user.password.startsWith("$2b$")) ? await tryCompare() : (user.password === password);
      if (!isMatch) return res.render("login", { error: "Senha incorreta." });

      // set session
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect("/operador/painel");
    })();
  });
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// small middleware to attach user when session exists (for views)
app.use((req, res, next) => {
  if (req.session && req.session.userId) {
    db.get("SELECT id, username, nome, role FROM users WHERE id = ?", [req.session.userId], (err, user) => {
      if (!err && user) res.locals.usuario = user;
      next();
    });
  } else {
    res.locals.usuario = null;
    next();
  }
});

// -------------------- Broadcast state (Socket.IO) --------------------
function broadcastState() {
  // digestors
  db.all("SELECT * FROM digestors ORDER BY id", [], (err, digestors) => {
    if (err) {
      console.error("Err digestors:", err);
      io.emit("digestors:update", []);
    } else {
      const tasks = digestors.map(d =>
        new Promise(resolve => {
          db.get("SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (e1, trit) => {
            db.get("SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (e2, cook) => {
              db.get("SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1", [d.id], (e3, cyc) => {
                resolve({ ...d, current_tritura: trit || null, current_cooking: cook || null, current_cycle: cyc || null });
              });
            });
          });
        })
      );
      Promise.all(tasks).then(all => io.emit("digestors:update", all)).catch(e => {
        console.error("Err building digestors state:", e);
        io.emit("digestors:update", digestors || []);
      });
    }
  });

  // tovas
  db.all("SELECT * FROM tovas ORDER BY id", [], (err, rows) => {
    if (err) { console.error("Err tovas:", err); io.emit("tovas:update", []); }
    else io.emit("tovas:update", rows || []);
  });

  // entries pending
  db.all("SELECT id, truck_plate, toneladas_declared, arrival_at, status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50", [], (err, rows) => {
    if (err) { console.error("Err entries:", err); io.emit("entries:update", []); }
    else io.emit("entries:update", rows || []);
  });
}

// -------------------- Views --------------------
// login already defined

app.get("/", (req, res) => res.redirect("/operador/painel"));

// operador painel (protected)
app.get("/operador/painel", ensureAuth, (req, res) => {
  db.all("SELECT * FROM digestors ORDER BY id", [], (err, digestors) => {
    if (err) return res.status(500).send("Erro ao carregar digestores");
    res.render("operador_painel", { usuario: res.locals.usuario || req.user, digestores: digestors || [] });
  });
});

// histórico (protected)
app.get("/operador/historico", ensureAuth, (req, res) => {
  res.render("operador_historico", { usuario: res.locals.usuario || req.user, title: "Histórico de Ciclos" });
});

// portaria
app.get("/portaria", ensureAuth, (req, res) => res.render("portaria_painel", { usuario: res.locals.usuario || req.user }));
app.get("/portaria/chegada", ensureAuth, (req, res) => res.render("portaria_chegada_form", { usuario: res.locals.usuario || req.user }));
app.post("/portaria/chegada", ensureAuth, (req, res) => {
  const { placa, toneladas } = req.body;
  if (!placa || !toneladas) return res.status(400).send("Placa e toneladas obrigatórios");
  db.run("INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id) VALUES (?, ?, ?)", [placa, toneladas, req.session.userId], function(err) {
    if (err) { console.error("Err insert entry:", err); return res.status(500).send("Erro ao registrar chegada"); }
    broadcastState();
    res.redirect("/portaria");
  });
});

// tovas views
app.get("/tovas", ensureAuth, (req, res) => {
  db.all("SELECT * FROM tovas ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).send("Erro tovas");
    res.render("tovas_dashboard", { usuario: res.locals.usuario, tovas: rows || [] });
  });
});

// -------------------- APIs --------------------

// get digestors (detailed)
app.get("/api/digestors", ensureAuth, (req, res) => {
  db.all("SELECT id, nome, capacidade_tn, status, last_cycle_id FROM digestors ORDER BY id", [], async (err, digestors) => {
    if (err) return res.status(500).json({ error: err.message });
    const out = [];
    for (const d of digestors) {
      const trit = await new Promise(r => db.get("SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (_, row) => r(row || null)));
      const cook = await new Promise(r => db.get("SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (_, row) => r(row || null)));
      const cyc = await new Promise(r => db.get("SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1", [d.id], (_, row) => r(row || null)));
      out.push({ ...d, current_tritura: trit, current_cooking: cook, current_cycle: cyc });
    }
    res.json(out);
  });
});

// tritura start
app.post("/api/trituracao/start", ensureAuth, (req, res) => {
  const { digestor_id, from_tova_id, toneladas_solicitadas, materia_prima } = req.body;
  if (!digestor_id || !from_tova_id) return res.status(400).json({ error: "Dados incompletos" });
  const now = new Date().toISOString();
  db.run("INSERT INTO trituration_cycles (digestor_id, from_tova_id, toneladas_solicitadas, start_tritura_at, status, operator_id) VALUES (?, ?, ?, ?, 'started', ?)",
    [digestor_id, from_tova_id, toneladas_solicitadas || 0, now, req.session.userId],
    function(err) {
      if (err) { console.error("Err start trit:", err); return res.status(500).json({ error: err.message }); }
      const tritId = this.lastID;
      db.run("INSERT INTO cycles (digestor_id, trituration_id, started_at, status) VALUES (?, ?, ?, 'in_progress')", [digestor_id, tritId, now], function(cErr) {
        if (cErr) console.error("Err create cycle:", cErr);
        db.run("UPDATE digestors SET status = ? WHERE id = ?", ['operating', digestor_id], () => {
          broadcastState();
          res.json({ trituration_id: tritId, started_at: now });
        });
      });
    });
});

// tritura finish -> auto start cook
app.post("/api/trituracao/finish", ensureAuth, (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  if (!trituration_id) return res.status(400).json({ error: "Dados incompletos" });
  const now = new Date().toISOString();
  db.run("UPDATE trituration_cycles SET end_tritura_at = ?, toneladas_trituradas = ?, status = 'finished' WHERE id = ?", [now, toneladas_trituradas || 0, trituration_id], function(err) {
    if (err) { console.error("Err finish trit:", err); return res.status(500).json({ error: err.message }); }
    db.get("SELECT digestor_id FROM trituration_cycles WHERE id = ?", [trituration_id], (e, row) => {
      if (e || !row) { broadcastState(); return res.json({ ok: true }); }
      // start cooking automatically
      startCooking(row.digestor_id, trituration_id, res);
    });
  });
});

// helper to start cooking (used by finish trit)
function startCooking(digestor_id, trituration_id, res) {
  const now = new Date().toISOString();
  db.run("INSERT INTO cooking_cycles (digestor_id, trituration_id, start_cook_at, status, operator_id) VALUES (?, ?, ?, 'started', ?)", [digestor_id, trituration_id, now, 1], function(err) {
    if (err) {
      console.error("Err start cooking:", err);
      if (res && !res.headersSent) return res.status(500).json({ error: err.message });
      return;
    }
    const cookingId = this.lastID;
    db.run("UPDATE cycles SET cooking_id = ? WHERE trituration_id = ? AND status = 'in_progress'", [cookingId, trituration_id], function(uErr) {
      if (uErr) console.error("Err link cooking:", uErr);
      db.run("UPDATE digestors SET status = ? WHERE id = ?", ['cooking', digestor_id], () => {
        broadcastState();
        if (res && !res.headersSent) res.json({ cooking_id: cookingId, started_at: now });
      });
    });
  });
}

// cooking finish
app.post("/api/cooking/finish", ensureAuth, (req, res) => {
  const { cooking_id } = req.body;
  if (!cooking_id) return res.status(400).json({ error: "cooking_id required" });
  const now = new Date().toISOString();
  db.run("UPDATE cooking_cycles SET end_cook_at = ?, status = 'finished' WHERE id = ?", [now, cooking_id], function(err) {
    if (err) { console.error("Err finish cook:", err); return res.status(500).json({ error: err.message }); }
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

// discharge
app.post("/api/digestor/discharge", ensureAuth, (req, res) => {
  const { digestor_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;
  if (!digestor_id) return res.status(400).json({ error: "digestor_id required" });
  db.run("INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes) VALUES (?, NULL, ?, ?, ?, ?)",
    [digestor_id, cooking_cycle_id || null, toneladas_discarded || 0, req.session.userId, notes || null], function(err) {
      if (err) { console.error("Err discharge:", err); return res.status(500).json({ error: err.message }); }
      db.run("UPDATE digestors SET status = 'idle' WHERE id = ?", [digestor_id], () => {
        broadcastState();
        res.json({ discharge_id: this.lastID });
      });
    });
});

// cycles history
app.get("/api/cycles/all", ensureAuth, (req, res) => {
  const sql = `SELECT cy.id, cy.digestor_id, cy.trituration_id, cy.cooking_id, cy.started_at, cy.ended_at, cy.status, d.nome AS digestor_name
               FROM cycles cy LEFT JOIN digestors d ON d.id = cy.digestor_id ORDER BY cy.id DESC LIMIT 200`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get("/api/cycles/:id", ensureAuth, (req, res) => {
  const id = req.params.id;
  const sql = `SELECT cy.*, d.nome AS digestor_name, tc.start_tritura_at, tc.end_tritura_at, tc.toneladas_trituradas,
               cc.start_cook_at, cc.end_cook_at, dd.toneladas_discarded, dd.notes
               FROM cycles cy
               LEFT JOIN digestors d ON d.id = cy.digestor_id
               LEFT JOIN trituration_cycles tc ON tc.id = cy.trituration_id
               LEFT JOIN cooking_cycles cc ON cc.id = cy.cooking_id
               LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
               WHERE cy.id = ?`;
  db.get(sql, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Ciclo não encontrado" });
    res.json(row);
  });
});

// PDF route optional
app.get("/reports/cycle/:id", ensureAuth, (req, res) => {
  if (!gerarPDFCiclo) return res.status(500).send("PDF util não disponível no servidor.");
  const id = req.params.id;
  const sql = `SELECT cy.*, d.nome as digestor_name, tc.*, cc.*, dd.* FROM cycles cy
               LEFT JOIN digestors d ON d.id = cy.digestor_id
               LEFT JOIN trituration_cycles tc ON tc.id = cy.trituration_id
               LEFT JOIN cooking_cycles cc ON cc.id = cy.cooking_id
               LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
               WHERE cy.id = ?`;
  db.get(sql, [id], async (err, ciclo) => {
    if (err || !ciclo) return res.status(404).send("Ciclo não encontrado");
    try {
      const fileName = `ciclo_${id}_${Date.now()}.pdf`;
      const filePath = path.join(REPORTS_DIR, fileName);
      await gerarPDFCiclo(ciclo, filePath);
      res.json({ url: `/reports/${fileName}` });
    } catch (e) {
      console.error("Erro gerar PDF:", e);
      res.status(500).send("Erro gerando PDF");
    }
  });
});

// -------------------- Socket.IO --------------------
io.on("connection", (socket) => {
  console.log("🔌 Socket conectado:", socket.id);
  broadcastState();
  socket.on("ping", () => socket.emit("pong"));
});

// -------------------- Error handler & start --------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (!res.headersSent) res.status(500).send("Internal Server Error");
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log("🚀 Servidor rodando na porta", PORT));
