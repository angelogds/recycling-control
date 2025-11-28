// server.js — FINAL revisado (Railway-friendly, PDF via utils, realtime, histórico, APIs)

const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Paths & DB file (use mount /app/data on Railway)
const ROOT = __dirname;
const DEFAULT_DB_PATH = path.join("/app/data", "database.sqlite");
const DB_FILE = process.env.DB_FILE || DEFAULT_DB_PATH;
const SQL_INIT_FILE = path.join(ROOT, "init_db.sql");

const PUBLIC_DIR = path.join(ROOT, "public");
const VIEWS_DIR = path.join(ROOT, "views");
const REPORTS_DIR = path.join(PUBLIC_DIR, "reports");

// Ensure directories exist
if (!fs.existsSync(path.dirname(DB_FILE))) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// If DB missing, initialize from SQL (safe first-run behavior)
if (!fs.existsSync(DB_FILE)) {
  if (fs.existsSync(SQL_INIT_FILE)) {
    try {
      console.log("📌 database not found. Creating database from init_db.sql at:", DB_FILE);
      const sqlite3tmp = require("sqlite3").verbose();
      const initSql = fs.readFileSync(SQL_INIT_FILE, "utf8");
      const dbtmp = new sqlite3tmp.Database(DB_FILE);
      dbtmp.exec(initSql, (err) => {
        if (err) console.error("Erro ao executar init_db.sql:", err);
        else console.log("✔ Database created from init_db.sql");
        dbtmp.close();
      });
    } catch (e) {
      console.error("Erro ao criar DB:", e);
    }
  } else {
    console.warn("⚠ init_db.sql not found — database not created automatically.");
  }
}

// Express + EJS
app.set("views", VIEWS_DIR);
app.set("view engine", "ejs");
app.use(express.static(PUBLIC_DIR));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Open DB
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error("SQLite open error:", err);
  else console.log("🔌 Banco SQLite conectado em:", DB_FILE);
});

// Mock auth middleware (dev) — replace with real auth later
app.use((req, res, next) => {
  // Default dev user
  req.user = { id: 1, nome: "Operador A", role: "operador" };
  next();
});

// Import PDF generator util (does its own PDFKit / QR handling)
let gerarPDFCicloPremium = null;
try {
  gerarPDFCicloPremium = require(path.join(ROOT, "utils", "pdf_ciclos"));
} catch (e) {
  console.warn("Aviso: utils/pdf_ciclos.js não encontrado ou falhou ao requerer. Rota de PDF ficará indisponível até adicionar o util.", e.message || e);
}

/* -------------------------
   broadcastState()
   envia digestores, tovas, entradas via socket.io
-------------------------*/
function broadcastState() {
  // Digestores + ciclos ativos
  db.all("SELECT id, nome, capacidade_tn, status, last_cycle_id FROM digestors ORDER BY id", [], (err, digestores) => {
    if (err) {
      console.error("DB error (digestors):", err);
      io.emit("digestors:update", []);
      return;
    }

    const promises = digestores.map(d => new Promise(resolve => {
      db.get("SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (e1, trit) => {
        db.get("SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1", [d.id], (e2, cook) => {
          db.get("SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1", [d.id], (e3, cyc) => {
            resolve({ ...d, current_tritura: trit || null, current_cooking: cook || null, current_cycle: cyc || null });
          });
        });
      });
    }));

    Promise.all(promises).then(result => io.emit("digestors:update", result)).catch(e => {
      console.error("Error building digestors state:", e);
      io.emit("digestors:update", digestores || []);
    });
  });

  // Tovas
  db.all("SELECT id, nome, capacidade_tn, current_tn FROM tovas ORDER BY id", [], (err2, tovas) => {
    if (err2) {
      console.error("DB error (tovas):", err2);
      io.emit("tovas:update", []);
      return;
    }
    io.emit("tovas:update", tovas || []);
  });

  // Entradas pendentes
  db.all("SELECT id, truck_plate, toneladas_declared, arrival_at, status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50", [], (err3, rows) => {
    if (err3) {
      console.error("DB error (entries):", err3);
      io.emit("entries:update", []);
      return;
    }
    io.emit("entries:update", rows || []);
  });
}

/* -------------------------
   VIEWS
-------------------------*/

// Root -> operador painel
app.get("/", (req, res) => res.redirect("/operador/painel"));

// Operador - painel (socket-driven)
app.get("/operador/painel", (req, res) => {
  res.render("operador_painel", { usuario: req.user, title: "Painel do Operador" });
});

// Histórico (view)
app.get("/operador/historico", (req, res) => {
  res.render("operador_historico", { usuario: req.user, title: "Histórico de Ciclos" });
});

// Portaria
app.get("/portaria", (req, res) => res.render("portaria_painel", { usuario: req.user, title: "Portaria" }));
app.get("/portaria/chegada", (req, res) => res.render("portaria_chegada_form", { usuario: req.user, title: "Registrar Chegada" }));

app.post("/portaria/chegada", (req, res) => {
  const { placa, toneladas } = req.body;
  if (!placa || !toneladas) return res.status(400).send("Placa e toneladas são obrigatórios.");
  db.run("INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id) VALUES (?, ?, ?)", [placa, toneladas, req.user.id], function(err) {
    if (err) {
      console.error("Erro ao inserir entrada:", err);
      return res.status(500).send("Erro ao registrar chegada.");
    }
    broadcastState();
    res.redirect("/portaria");
  });
});

// Tovas views (basic)
app.get("/tovas", (req, res) => {
  db.all("SELECT * FROM tovas ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).send("Erro DB tovas");
    res.render("tovas_dashboard", { usuario: req.user, title: "Tovas", tovas: rows || [] });
  });
});
app.get("/tovas/:id/editar", (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM tovas WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).send("Erro DB");
    if (!row) return res.status(404).send("Tova não encontrada");
    res.render("tovas_editar", { usuario: req.user, title: "Editar Tova", tova: row });
  });
});
app.post("/tovas/:id/update", (req, res) => {
  const id = req.params.id;
  const { nome, capacidade_tn } = req.body;
  db.run("UPDATE tovas SET nome = ?, capacidade_tn = ? WHERE id = ?", [nome, capacidade_tn, id], function(err) {
    if (err) { console.error(err); return res.status(500).send('Erro ao atualizar tova'); }
    broadcastState();
    res.redirect('/tovas');
  });
});

/* -------------------------
   APIs JSON
-------------------------*/

// Digestores full
app.get("/api/digestors", (req, res) => {
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

// Tovas
app.get("/api/tovas", (req, res) => {
  db.all("SELECT id, nome, capacidade_tn, current_tn FROM tovas ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Entradas pendentes
app.get("/api/entries/pending", (req, res) => {
  db.all("SELECT id, truck_plate, toneladas_declared, arrival_at, status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Trituração - iniciar
app.post("/api/trituracao/start", (req, res) => {
  const { digestor_id, from_tova_id, toneladas_solicitadas } = req.body;
  if (!digestor_id || !from_tova_id || !toneladas_solicitadas) return res.status(400).json({ error: 'Dados incompletos' });
  const now = new Date().toISOString();
  db.run("INSERT INTO trituration_cycles (digestor_id, from_tova_id, toneladas_solicitadas, start_tritura_at, status, operator_id) VALUES (?,?,?,?, 'started', ?)", [digestor_id, from_tova_id, toneladas_solicitadas, now, req.user.id], function(err) {
    if (err) { console.error('Err start trit:', err); return res.status(500).json({ error: err.message }); }
    // optionally create cycles row linking trituration -> cycle
    db.run("INSERT INTO cycles (digestor_id, trituration_id, started_at, status) VALUES (?, ?, ?, 'in_progress')", [digestor_id, this.lastID, now], function(cErr) {
      if (cErr) console.error("Err creating cycle:", cErr);
      broadcastState();
      res.json({ trituration_id: this.lastID });
    });
  });
});

// Trituração - finalizar
app.post("/api/trituracao/finish", (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  if (!trituration_id) return res.status(400).json({ error: 'Dados incompletos' });
  const now = new Date().toISOString();
  db.run("UPDATE trituration_cycles SET end_tritura_at = ?, toneladas_trituradas = ?, status = 'finished' WHERE id = ?", [now, toneladas_trituradas, trituration_id], function(err) {
    if (err) { console.error('Err finish trit:', err); return res.status(500).json({ error: err.message }); }
    broadcastState();
    res.json({ ok: true });
  });
});

// Cooking - start (optional route if you need)
app.post("/api/cooking/start", (req, res) => {
  const { cooking_id, digestor_id, trituration_id } = req.body;
  const now = new Date().toISOString();
  if (!digestor_id || !trituration_id) return res.status(400).json({ error: 'Dados incompletos' });

  // create cooking_cycles row and link to cycles
  db.run("INSERT INTO cooking_cycles (digestor_id, trituration_id, start_cook_at, status, operator_id) VALUES (?, ?, ?, 'started', ?)", [digestor_id, trituration_id, now, req.user.id], function(err) {
    if (err) { console.error('Err start cook:', err); return res.status(500).json({ error: err.message }); }
    const cookingId = this.lastID;
    // update cycles row to include cooking_id
    db.run("UPDATE cycles SET cooking_id = ? WHERE trituration_id = ? AND status = 'in_progress'", [cookingId, trituration_id], () => {
      broadcastState();
      res.json({ cooking_id: cookingId });
    });
  });
});

// Cooking - finish
app.post("/api/cooking/finish", (req, res) => {
  const { cooking_id } = req.body;
  if (!cooking_id) return res.status(400).json({ error: 'cooking_id required' });
  const now = new Date().toISOString();
  db.run("UPDATE cooking_cycles SET end_cook_at = ?, status = 'finished' WHERE id = ?", [now, cooking_id], function(err) {
    if (err) { console.error('Err finish cook:', err); return res.status(500).json({ error: err.message }); }
    // close cycle if present
    db.get("SELECT * FROM cycles WHERE cooking_id = ? OR trituration_id = (SELECT trituration_id FROM cooking_cycles WHERE id = ?)", [cooking_id, cooking_id], (e, cyc) => {
      if (cyc) {
        db.run("UPDATE cycles SET ended_at = ?, status = 'finished' WHERE id = ?", [now, cyc.id], () => {
          broadcastState();
          res.json({ ok: true });
        });
      } else {
        broadcastState();
        res.json({ ok: true });
      }
    });
  });
});

// Discharge digestor
app.post("/api/digestor/discharge", (req, res) => {
  const { digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;
  if (!digestor_id) return res.status(400).json({ error: 'digestor_id required' });
  db.run("INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes) VALUES (?,?,?,?,?,?)", [digestor_id, trituration_cycle_id || null, cooking_cycle_id || null, toneladas_discarded || 0, req.user.id, notes || null], function(err) {
    if (err) { console.error('Err discharge:', err); return res.status(500).json({ error: err.message }); }
    db.run("UPDATE digestors SET status = ? WHERE id = ?", ['idle', digestor_id], () => {
      broadcastState();
      res.json({ discharge_id: this.lastID });
    });
  });
});

// Cycles APIs for histórico and details
app.get("/api/cycles/all", (req, res) => {
  const sql = `
    SELECT cy.id, cy.started_at, cy.ended_at, cy.status,
           d.nome AS digestor_name
    FROM cycles cy
    LEFT JOIN digestors d ON cy.digestor_id = d.id
    ORDER BY cy.id DESC
    LIMIT 200
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get("/api/cycles/:id", (req, res) => {
  const id = req.params.id;
  const sql = `
    SELECT 
      cy.*,
      d.nome AS digestor_name,
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

/* -------------------------
   PDF REPORT ROUTE
   Generates PDF via utils/pdf_ciclos and returns a URL to /public/reports
-------------------------*/
app.get("/reports/cycle/:id", async (req, res) => {
  const id = req.params.id;

  // fetch cycle + linked data
  const sql = `
    SELECT cy.*, d.nome as digestor_name,
           tc.start_tritura_at, tc.end_tritura_at, tc.toneladas_trituradas,
           cc.start_cook_at, cc.end_cook_at,
           dd.toneladas_discarded, dd.notes,
           u.nome as operator_name
    FROM cycles cy
    LEFT JOIN digestors d ON cy.digestor_id = d.id
    LEFT JOIN trituration_cycles tc ON cy.trituration_id = tc.id
    LEFT JOIN cooking_cycles cc ON cy.cooking_id = cc.id
    LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
    LEFT JOIN users u ON cy.operator_id = u.id
    WHERE cy.id = ?
  `;

  db.get(sql, [id], async (err, ciclo) => {
    if (err) { console.error("Err get cycle for pdf:", err); return res.status(500).send("Erro DB"); }
    if (!ciclo) return res.status(404).send("Ciclo não encontrado");

    if (!gerarPDFCicloPremium) {
      return res.status(500).send("PDF util não disponível. Coloque utils/pdf_ciclos.js no projeto.");
    }

    const fileName = `ciclo_${id}_${Date.now()}.pdf`;
    const filePath = path.join(REPORTS_DIR, fileName);

    try {
      // normalize data object for generator
      const dados = {
        id: ciclo.id,
        digestor: { id: ciclo.digestor_id, nome: ciclo.digestor_name, capacidade_tn: ciclo.capacidade_tn || '' },
        tritura: { id: ciclo.trituration_id || '', toneladas_solicitadas: ciclo.toneladas_solicitadas || '', toneladas_trituradas: ciclo.toneladas_trituradas || '', start: ciclo.start_tritura_at || '', end: ciclo.end_tritura_at || '' },
        cook: { id: ciclo.cooking_id || '', start: ciclo.start_cook_at || '', end: ciclo.end_cook_at || '' },
        discharge: { toneladas_discarded: ciclo.toneladas_discarded || '', notes: ciclo.notes || '' },
        operador: { nome: ciclo.operator_name || (req.user && req.user.nome) || 'Operador' },
        criado_em: new Date().toISOString(),
        started_at: ciclo.started_at || '',
        ended_at: ciclo.ended_at || ''
      };

      // if the util returns a promise for path, call it
      const result = await gerarPDFCicloPremium(dados, filePath);
      // gerarPDFCicloPremium should resolve to output path or write filePath
      // respond with public URL
      res.json({ url: `/reports/${fileName}` });
    } catch (e) {
      console.error("Erro gerando PDF:", e);
      res.status(500).send("Erro ao gerar PDF");
    }
  });
});

/* -------------------------
   Socket.IO realtime
-------------------------*/
io.on("connection", (socket) => {
  console.log("🔌 Socket conectado:", socket.id);
  // send initial state
  broadcastState();

  socket.on("ping", () => socket.emit("pong"));
});

/* -------------------------
   Error handler & start
-------------------------*/
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).send("Internal Server Error");
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log("🚀 Server rodando na porta", PORT);
});
