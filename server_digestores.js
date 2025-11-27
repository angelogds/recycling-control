// server.js — SERVER PREMIUM COMPLETO
// Requisitos: express, ejs, sqlite3, socket.io, pdfkit, body-parser

const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');
const PDFDocument = require('pdfkit');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Paths
const ROOT = path.join(__dirname);
const DB_FILE = path.join(ROOT, 'database.sqlite');
const PUBLIC_DIR = path.join(ROOT, 'public');
const VIEWS_DIR = path.join(ROOT, 'views');
const REPORTS_DIR = path.join(PUBLIC_DIR, 'reports');

// Criar pasta public/reports se não existir
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  console.log('Created reports directory:', REPORTS_DIR);
}

// Express + EJS
app.set('views', VIEWS_DIR);
app.set('view engine', 'ejs');
app.use(express.static(PUBLIC_DIR));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database
if (!fs.existsSync(DB_FILE)) {
  console.warn("⚠ database.sqlite NÃO ENCONTRADO! Execute: npm run init-db");
}
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error("SQLite Error:", err);
  else console.log("Connected to SQLite DB:", DB_FILE);
});

// Mock Auth
app.use((req, res, next) => {
  req.user = { id: 1, nome: "Operador A", role: "operador" };
  next();
});

/* ================================================================
   BROADCAST GERAL (Digestores, Tovas, Entradas)
================================================================ */
function broadcastState() {

  // Digestores + ciclos ativos
  db.all("SELECT * FROM digestors ORDER BY id", [], (err, digestores) => {
    if (!digestores) return;

    const promises = digestores.map(d =>
      new Promise(resolve => {
        db.get(
          "SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1",
          [d.id],
          (_, trit) => {
            db.get(
              "SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1",
              [d.id],
              (_, cook) => {
                db.get(
                  "SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1",
                  [d.id],
                  (_, cyc) => {
                    resolve({
                      ...d,
                      current_tritura: trit || null,
                      current_cooking: cook || null,
                      current_cycle: cyc || null
                    });
                  }
                );
              }
            );
          }
        );
      })
    );

    Promise.all(promises).then(result => io.emit("digestors:update", result));
  });

  // Tovas
  db.all("SELECT * FROM tovas ORDER BY id", [], (err, rows) => {
    if (!err) io.emit("tovas:update", rows);
  });

  // Entradas
  db.all(
    "SELECT * FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50",
    [],
    (err, rows) => {
      if (!err) io.emit("entries:update", rows);
    }
  );
}

/* ================================================================
   VIEWS
================================================================ */

// ROOT
app.get("/", (req, res) => res.redirect("/operador/painel"));

/* 🔥 ROTA CORRIGIDA — AGORA MOSTRA OS DIGESTORES */
app.get("/operador/painel", (req, res) => {
  db.all("SELECT * FROM digestors ORDER BY id", [], (err, digestores) => {
    if (err) return res.status(500).send("Erro ao carregar digestores.");

    db.all("SELECT * FROM tovas ORDER BY id", [], (err2, tovas) => {
      if (err2) return res.status(500).send("Erro ao carregar tovas.");

      res.render("operador_painel", {
        usuario: req.user,
        digestores,
        tovas
      });
    });
  });
});

// Portaria
app.get("/portaria", (req, res) =>
  res.render("portaria_painel", { usuario: req.user })
);

app.get("/portaria/chegada", (req, res) =>
  res.render("portaria_chegada_form", { usuario: req.user })
);

app.post("/portaria/chegada", (req, res) => {
  const { placa, toneladas } = req.body;
  if (!placa || !toneladas)
    return res.status(400).send("Placa e toneladas são obrigatórios.");

  db.run(
    "INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id) VALUES (?, ?, ?)",
    [placa, toneladas, req.user.id],
    function (err) {
      if (err) return res.status(500).send("Erro ao registrar chegada.");
      broadcastState();
      res.redirect("/portaria");
    }
  );
});

/* ================================================================
   APIs JSON
================================================================ */

app.get("/api/digestors", (req, res) => {
  db.all("SELECT * FROM digestors ORDER BY id", [], async (err, digestores) => {
    if (err) return res.status(500).json({ error: err.message });

    const result = [];
    for (const d of digestores) {
      const trit = await new Promise((resolve) =>
        db.get(
          "SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1",
          [d.id],
          (_, r) => resolve(r || null)
        )
      );

      const cook = await new Promise((resolve) =>
        db.get(
          "SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1",
          [d.id],
          (_, r) => resolve(r || null)
        )
      );

      const cycle = await new Promise((resolve) =>
        db.get(
          "SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1",
          [d.id],
          (_, r) => resolve(r || null)
        )
      );

      result.push({
        ...d,
        current_tritura: trit,
        current_cooking: cook,
        current_cycle: cycle
      });
    }

    res.json(result);
  });
});

/* Trituração */
app.post("/api/trituracao/start", (req, res) => {
  const { digestor_id, from_tova_id, toneladas_solicitadas } = req.body;
  const now = new Date().toISOString();

  db.run(
    "INSERT INTO trituration_cycles (digestor_id, from_tova_id, toneladas_solicitadas, start_tritura_at, status, operator_id) VALUES (?,?,?,?, 'started', ?)",
    [
      digestor_id,
      from_tova_id,
      toneladas_solicitadas,
      now,
      req.user.id
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      broadcastState();
      res.json({ trituration_id: this.lastID });
    }
  );
});

/* Finalizar trituração */
app.post("/api/trituracao/finish", (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  const now = new Date().toISOString();

  db.run(
    "UPDATE trituration_cycles SET end_tritura_at=?, toneladas_trituradas=?, status='finished' WHERE id=?",
    [now, toneladas_trituradas, trituration_id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      broadcastState();
      res.json({ ok: true });
    }
  );
});

/* Finalizar cozimento */
app.post("/api/cooking/finish", (req, res) => {
  const { cooking_id } = req.body;
  const now = new Date().toISOString();

  db.run(
    "UPDATE cooking_cycles SET end_cook_at=?, status='finished' WHERE id=?",
    [now, cooking_id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      broadcastState();
      res.json({ ok: true });
    }
  );
});

/* Descarregar digestor */
app.post("/api/digestor/discharge", (req, res) => {
  const {
    digestor_id,
    trituration_cycle_id,
    cooking_cycle_id,
    toneladas_discarded,
    notes
  } = req.body;

  db.run(
    "INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes) VALUES (?,?,?,?,?,?)",
    [
      digestor_id,
      trituration_cycle_id,
      cooking_cycle_id,
      toneladas_discarded || 0,
      req.user.id,
      notes || null
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      db.run(
        "UPDATE digestors SET status='idle' WHERE id=?",
        [digestor_id],
        () => {
          broadcastState();
          res.json({ discharge_id: this.lastID });
        }
      );
    }
  );
});

/* ================================================================
   SOCKET.IO
================================================================ */
io.on("connection", (socket) => {
  console.log("Socket conectado:", socket.id);
  broadcastState();
});

/* ================================================================
   SERVER START
================================================================ */
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log("🚀 Server rodando na porta", PORT);
});
