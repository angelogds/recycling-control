// server_digestores.js — SERVER PREMIUM ATUALIZADO
// Requisitos: express, ejs, sqlite3, socket.io, pdfkit, body-parser

const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const { Server } = require("socket.io");
const PDFDocument = require("pdfkit");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Paths
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, "database.sqlite");
const PUBLIC_DIR = path.join(ROOT, "public");
const VIEWS_DIR = path.join(ROOT, "views");
const REPORTS_DIR = path.join(PUBLIC_DIR, "reports");

// Ensure reports dir exists
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  console.log("📂 Pasta reports criada:", REPORTS_DIR);
}

// Express + EJS
app.set("views", VIEWS_DIR);
app.set("view engine", "ejs");
app.use(express.static(PUBLIC_DIR));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database connection
if (!fs.existsSync(DB_FILE)) {
  console.warn("⚠ Banco inexistente! Execute: npm run init-db");
}
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error("SQLite error:", err);
  else {
    console.log("🔌 Conectado ao banco:", DB_FILE);
  }
});

// Mock Auth (dev) — substitua por auth real depois
app.use((req, res, next) => {
  req.user = { id: 1, nome: "Operador A", role: "operador" };
  next();
});

/* ============================================
   broadcastState() — envia estado via socket.io
   ============================================ */
function broadcastState() {
  // Digestores + ciclos ativos
  db.all("SELECT * FROM digestors ORDER BY id", [], (err, digestores) => {
    if (err) {
      console.error("DB error (digestors):", err);
      return;
    }
    if (!digestores) digestores = [];

    const promises = digestores.map(
      (d) =>
        new Promise((resolve) => {
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
                        current_cycle: cyc || null,
                      });
                    }
                  );
                }
              );
            }
          );
        })
    );

    Promise.all(promises)
      .then((result) => io.emit("digestors:update", result))
      .catch((e) => console.error("broadcast digestors promise error:", e));
  });

  // Tovas
  db.all("SELECT * FROM tovas ORDER BY id", [], (_, tovas) => {
    io.emit("tovas:update", tovas || []);
  });

  // Entradas pendentes
  db.all(
    "SELECT id, truck_plate, toneladas_declared, arrival_at, status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50",
    [],
    (_, rows) => {
      io.emit("entries:update", rows || []);
    }
  );
}

/* ============================================
   ROUTES - VIEWS
   ============================================ */

// root
app.get("/", (req, res) => res.redirect("/operador/painel"));

// Operador painel
app.get("/operador/painel", (req, res) => {
  try {
    // render — a view do painel usa sockets para carregar digestors dinamicamente
    res.render("operador_painel", { usuario: req.user });
  } catch (e) {
    console.error("Render error /operador/painel:", e);
    res.status(500).send("Erro interno ao renderizar painel do operador.");
  }
});

// Portaria
app.get("/portaria", (req, res) => res.render("portaria_painel", { usuario: req.user }));
app.get("/portaria/chegada", (req, res) => res.render("portaria_chegada_form", { usuario: req.user }));

app.post("/portaria/chegada", (req, res) => {
  const { placa, toneladas } = req.body;
  if (!placa || !toneladas) return res.status(400).send("Placa e toneladas são obrigatórios.");

  db.run(
    "INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id) VALUES (?, ?, ?)",
    [placa, toneladas, req.user.id],
    function (err) {
      if (err) {
        console.error("DB insert entry err:", err);
        return res.status(500).send("Erro ao registrar chegada.");
      }
      broadcastState();
      res.redirect("/portaria");
    }
  );
});

/* ============================================
   CORREÇÃO: ROTA PARA equipamentos_baixar
   - Garante que a view receba a variável `equipamentos`
   ============================================ */
app.get("/equipamentos/baixar", (req, res) => {
  db.all("SELECT * FROM equipamentos ORDER BY id DESC", [], (err, equipamentos) => {
    if (err) {
      console.error("Erro ao buscar equipamentos:", err);
      return res.status(500).send("Erro ao carregar equipamentos.");
    }
    // garante que equipamentos nunca seja undefined (proteção extra)
    res.render("equipamentos_baixar", { equipamentos: equipamentos || [] });
  });
});

/* ============================================
   APIs JSON
   ============================================ */

// /api/digestors
app.get("/api/digestors", (req, res) => {
  db.all("SELECT * FROM digestors ORDER BY id", [], async (err, digestores) => {
    if (err) return res.status(500).json({ error: err.message });
    digestores = digestores || [];
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
      result.push({ ...d, current_tritura: trit, current_cooking: cook, current_cycle: cycle });
    }
    res.json(result);
  });
});

// Trituração start
app.post("/api/trituracao/start", (req, res) => {
  const { digestor_id, from_tova_id, toneladas_solicitadas } = req.body;
  if (!digestor_id || !from_tova_id || !toneladas_solicitadas) return res.status(400).json({ error: "Dados incompletos" });
  const now = new Date().toISOString();

  db.run(
    "INSERT INTO trituration_cycles (digestor_id, from_tova_id, toneladas_solicitadas, start_tritura_at, status, operator_id) VALUES (?,?,?,?, 'started', ?)",
    [digestor_id, from_tova_id, toneladas_solicitadas, now, req.user.id],
    function (err) {
      if (err) {
        console.error("Err start trit:", err);
        return res.status(500).json({ error: err.message });
      }
      broadcastState();
      res.json({ trituration_id: this.lastID });
    }
  );
});

// Trituração finish
app.post("/api/trituracao/finish", (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  if (!trituration_id || toneladas_trituradas === undefined) return res.status(400).json({ error: "Dados incompletos" });
  const now = new Date().toISOString();

  db.run(
    "UPDATE trituration_cycles SET end_tritura_at = ?, toneladas_trituradas = ?, status = 'finished' WHERE id = ?",
    [now, toneladas_trituradas, trituration_id],
    function (err) {
      if (err) {
        console.error("Err finish trit:", err);
        return res.status(500).json({ error: err.message });
      }
      broadcastState();
      res.json({ ok: true });
    }
  );
});

// Cooking start
app.post("/api/cooking/start", (req, res) => {
  const { cooking_id } = req.body;
  if (!cooking_id) return res.status(400).json({ error: "cooking_id required" });
  const now = new Date().toISOString();
  db.run("UPDATE cooking_cycles SET start_cook_at = ?, status = 'started' WHERE id = ?", [now, cooking_id], function (err) {
    if (err) { console.error("Err start cook:", err); return res.status(500).json({ error: err.message }); }
    broadcastState();
    res.json({ ok: true });
  });
});

// Cooking finish
app.post("/api/cooking/finish", (req, res) => {
  const { cooking_id } = req.body;
  if (!cooking_id) return res.status(400).json({ error: "cooking_id required" });
  const now = new Date().toISOString();
  db.run("UPDATE cooking_cycles SET end_cook_at = ?, status = 'finished' WHERE id = ?", [now, cooking_id], function (err) {
    if (err) { console.error("Err finish cook:", err); return res.status(500).json({ error: err.message }); }
    broadcastState();
    res.json({ ok: true });
  });
});

// Discharge
app.post("/api/digestor/discharge", (req, res) => {
  const { digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;
  if (!digestor_id) return res.status(400).json({ error: "digestor_id required" });

  db.run(
    "INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes) VALUES (?,?,?,?,?,?)",
    [digestor_id, trituration_cycle_id || null, cooking_cycle_id || null, toneladas_discarded || 0, req.user.id, notes || null],
    function (err) {
      if (err) { console.error("Err discharge:", err); return res.status(500).json({ error: err.message }); }
      db.run("UPDATE digestors SET status = ? WHERE id = ?", ["idle", digestor_id], () => {
        broadcastState();
        res.json({ discharge_id: this.lastID });
      });
    }
  );
});
/* ================================================================
   API — Histórico de ciclos completos (Painel do Operador / Histórico)
================================================================ */

app.get("/api/cycles", (req, res) => {
    const { digestor_id, limit } = req.query;

    let sql = `
        SELECT 
            cy.id,
            cy.digestor_id,
            d.nome AS digestor_nome,
            cy.started_at,
            cy.ended_at,
            cy.status,

            tc.start_tritura_at,
            tc.end_tritura_at,
            tc.toneladas_trituradas,

            cc.start_cook_at,
            cc.end_cook_at,

            dc.toneladas_discarded,
            dc.notes
        FROM cycles cy
        LEFT JOIN digestors d ON d.id = cy.digestor_id
        LEFT JOIN trituration_cycles tc ON tc.id = cy.trituration_id
        LEFT JOIN cooking_cycles cc ON cc.id = cy.cooking_id
        LEFT JOIN digestor_discharges dc ON dc.cycle_id = cy.id
    `;

    const params = [];

    if (digestor_id) {
        sql += " WHERE cy.digestor_id = ? ";
        params.push(digestor_id);
    }

    sql += " ORDER BY cy.id DESC ";

    if (limit) {
        sql += " LIMIT ? ";
        params.push(Number(limit));
    }

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error("Erro ao buscar ciclos:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows || []);
    });
});

/* ============================================
   Socket.IO
   ============================================ */
io.on("connection", (socket) => {
  console.log("🔌 Cliente conectado:", socket.id);
  broadcastState();
});

/* ============================================
   Error handler (global) — log detalhado
   ============================================ */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err && err.stack ? err.stack : err);
  // Mostra mensagem simples ao navegador, mas loga stack no console
  res.status(500).send("Internal Server Error");
});

/* ============================================
   Start server
   ============================================ */
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log("🚀 Server rodando na porta", PORT);
});
