// ============================================================
// server.js — Versão FINAL, 100% funcional e compatível
// Painel do Operador Premium + Portaria + Tovas + Histórico
// RailWay-ready / SQLite / PDF opcional / Socket.IO
// ============================================================

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

// ------------------------------------------------------------
// Paths
// ------------------------------------------------------------
const ROOT = __dirname;
const DEFAULT_DB_PATH = "/app/data/database.sqlite";
const DB_FILE = process.env.DB_FILE || DEFAULT_DB_PATH;
const SQL_INIT_FILE = path.join(ROOT, "init_db.sql");

const PUBLIC_DIR = path.join(ROOT, "public");
const VIEWS_DIR = path.join(ROOT, "views");
const REPORTS_DIR = path.join(PUBLIC_DIR, "reports");

// Folders
if (!fs.existsSync(path.dirname(DB_FILE)))
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

if (!fs.existsSync(PUBLIC_DIR))
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });

if (!fs.existsSync(REPORTS_DIR))
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ------------------------------------------------------------
// Init DB if missing
// ------------------------------------------------------------
if (!fs.existsSync(DB_FILE) && fs.existsSync(SQL_INIT_FILE)) {
    console.log("📌 DB não encontrado. Criando via init_db.sql…");
    const sql = fs.readFileSync(SQL_INIT_FILE, "utf8");

    const tmp = new sqlite3.Database(DB_FILE);
    tmp.exec(sql, err => {
        if (err) console.error("Erro init_db.sql:", err);
        else console.log("✔ DB criado com sucesso!");
        tmp.close();
    });
}

// ------------------------------------------------------------
// Express
// ------------------------------------------------------------
app.set("views", VIEWS_DIR);
app.set("view engine", "ejs");
app.use(express.static(PUBLIC_DIR));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Mock user (trocar depois)
app.use((req, res, next) => {
    req.user = { id: 1, nome: "Operador A", role: "operador" };
    next();
});

// ------------------------------------------------------------
// DB
// ------------------------------------------------------------
const db = new sqlite3.Database(DB_FILE, err => {
    if (err) console.error("Erro SQLite:", err);
    else console.log("🔌 SQLite conectado:", DB_FILE);
});

// Try to load PDF util
let gerarPDFCicloUtil = null;
try {
    gerarPDFCicloUtil = require(path.join(ROOT, "utils", "pdf_ciclos"));
} catch (e) {
    console.log("⚠ PDF util ausente (opcional):", e.message);
}

// ------------------------------------------------------------
// Broadcast (Socket.IO)
// ------------------------------------------------------------
function broadcastState() {
    // Digestores + ciclos ativos
    db.all("SELECT * FROM digestors ORDER BY id", [], (err, dgs) => {
        if (err) return io.emit("digestors:update", []);

        const tasks = dgs.map(d =>
            new Promise(resolve => {
                db.get(
                    "SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('started','created') ORDER BY id DESC LIMIT 1",
                    [d.id],
                    (e1, trit) => {
                        db.get(
                            "SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('started','created') ORDER BY id DESC LIMIT 1",
                            [d.id],
                            (e2, cook) => {
                                db.get(
                                    "SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1",
                                    [d.id],
                                    (e3, cycle) => {
                                        resolve({
                                            ...d,
                                            current_tritura: trit || null,
                                            current_cooking: cook || null,
                                            current_cycle: cycle || null
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            })
        );

        Promise.all(tasks).then(full => io.emit("digestors:update", full));
    });

    // Tovas
    db.all("SELECT * FROM tovas ORDER BY id", [], (err, rows) => {
        io.emit("tovas:update", rows || []);
    });

    // Entradas
    db.all(
        "SELECT * FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50",
        [],
        (err, rows) => io.emit("entries:update", rows || [])
    );
}

// ------------------------------------------------------------
// Views
// ------------------------------------------------------------
app.get("/", (req, res) => res.redirect("/operador/painel"));

app.get("/operador/painel", (req, res) => {
    db.all("SELECT * FROM digestors ORDER BY id", [], (err, dgs) => {
        if (err) return res.status(500).send("Erro carregando digestores");
        res.render("operador_painel", { usuario: req.user, digestores: dgs });
    });
});

app.get("/operador/historico", (req, res) => {
    res.render("operador_historico", { usuario: req.user });
});

// ------------------------------------------------------------
// Portaria
// ------------------------------------------------------------
app.get("/portaria", (req, res) =>
    res.render("portaria_painel", { usuario: req.user })
);

app.get("/portaria/chegada", (req, res) =>
    res.render("portaria_chegada_form", { usuario: req.user })
);

app.post("/portaria/chegada", (req, res) => {
    const { placa, toneladas } = req.body;
    if (!placa || !toneladas)
        return res.status(400).send("Placa e toneladas obrigatórios");

    db.run(
        "INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id) VALUES (?, ?, ?)",
        [placa, toneladas, req.user.id],
        err => {
            if (err) return res.status(500).send("Erro ao registrar");
            broadcastState();
            res.redirect("/portaria");
        }
    );
});

// ------------------------------------------------------------
// API — Digestors (detalhes)
// ------------------------------------------------------------
app.get("/api/digestors", (req, res) => {
    db.all("SELECT * FROM digestors ORDER BY id", [], async (err, list) => {
        if (err) return res.status(500).json({ error: err.message });

        const out = [];

        for (const d of list) {
            const trit = await new Promise(r =>
                db.get(
                    "SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('started','created') ORDER BY id DESC LIMIT 1",
                    [d.id],
                    (_, row) => r(row || null)
                )
            );

            const cook = await new Promise(r =>
                db.get(
                    "SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('started','created') ORDER BY id DESC LIMIT 1",
                    [d.id],
                    (_, row) => r(row || null)
                )
            );

            const cyc = await new Promise(r =>
                db.get(
                    "SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1",
                    [d.id],
                    (_, row) => r(row || null)
                )
            );

            out.push({
                ...d,
                current_tritura: trit,
                current_cooking: cook,
                current_cycle: cyc
            });
        }

        res.json(out);
    });
});

// ------------------------------------------------------------
// API — Trituração START
// ------------------------------------------------------------
app.post("/api/trituracao/start", (req, res) => {
    const { digestor_id, from_tova_id, toneladas_solicitadas } = req.body;
    if (!digestor_id || !from_tova_id)
        return res.status(400).json({ error: "Dados incompletos" });

    const now = new Date().toISOString();

    db.run(
        `INSERT INTO trituration_cycles 
         (digestor_id, from_tova_id, toneladas_solicitadas, start_tritura_at, operator_id, status)
         VALUES (?, ?, ?, ?, ?, 'started')`,
        [digestor_id, from_tova_id, toneladas_solicitadas, now, req.user.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            const tritId = this.lastID;

            // ciclo principal
            db.run(
                `INSERT INTO cycles (digestor_id, trituration_id, started_at, status)
                 VALUES (?, ?, ?, 'in_progress')`,
                [digestor_id, tritId, now],
                err2 => {
                    if (err2) console.error("Err Create Cycle:", err2);
                    broadcastState();
                    res.json({ trituration_id: tritId });
                }
            );
        }
    );
});

// ------------------------------------------------------------
// API — Trituração FINISH
// ------------------------------------------------------------
app.post("/api/trituracao/finish", (req, res) => {
    const { trituration_id, toneladas_trituradas } = req.body;

    if (!trituration_id)
        return res.status(400).json({ error: "ID inválido" });

    const now = new Date().toISOString();

    db.run(
        `UPDATE trituration_cycles 
         SET end_tritura_at=?, toneladas_trituradas=?, status='finished'
         WHERE id=?`,
        [now, toneladas_trituradas || 0, trituration_id],
        err => {
            if (err) return res.status(500).json({ error: err.message });

            // iniciar COZIMENTO automaticamente
            db.get(
                "SELECT digestor_id FROM trituration_cycles WHERE id=?",
                [trituration_id],
                (e2, row) => {
                    if (!row) return res.json({ ok: true });

                    startCooking(row.digestor_id, trituration_id, res);
                }
            );
        }
    );
});

// ---------------------------------------
// Função auxiliar — iniciar cozimento
// ---------------------------------------
function startCooking(digestor_id, trituration_id, res) {
    const now = new Date().toISOString();

    db.run(
        `INSERT INTO cooking_cycles 
         (digestor_id, trituration_id, start_cook_at, status, operator_id)
         VALUES (?, ?, ?, 'started', ?)`,
        [digestor_id, trituration_id, now, 1],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            const cookingId = this.lastID;

            db.run(
                "UPDATE cycles SET cooking_id=? WHERE trituration_id=? AND status='in_progress'",
                [cookingId, trituration_id],
                err2 => {
                    if (err2) console.error("Err link cook:", err2);

                    broadcastState();
                    res.json({ cooking_id: cookingId });
                }
            );
        }
    );
}

// ------------------------------------------------------------
// API — Cooking FINISH
// ------------------------------------------------------------
app.post("/api/cooking/finish", (req, res) => {
    const { cooking_id } = req.body;

    if (!cooking_id) return res.status(400).json({ error: "ID inválido" });

    const now = new Date().toISOString();

    db.run(
        "UPDATE cooking_cycles SET end_cook_at=?, status='finished' WHERE id=?",
        [now, cooking_id],
        err => {
            if (err) return res.status(500).json({ error: err.message });

            db.get(
                "SELECT id FROM cycles WHERE cooking_id=? AND status='in_progress'",
                [cooking_id],
                (e2, cyc) => {
                    if (!cyc) {
                        broadcastState();
                        return res.json({ ok: true });
                    }

                    db.run(
                        "UPDATE cycles SET ended_at=?, status='finished' WHERE id=?",
                        [now, cyc.id],
                        err3 => {
                            if (err3) console.error("Err close cycle:", err3);

                            broadcastState();
                            res.json({ ok: true });
                        }
                    );
                }
            );
        }
    );
});

// ------------------------------------------------------------
// API — Discharge
// ------------------------------------------------------------
app.post("/api/digestor/discharge", (req, res) => {
    const { digestor_id, cooking_cycle_id, toneladas_discarded, notes } =
        req.body;

    if (!digestor_id)
        return res.status(400).json({ error: "Digestor inválido" });

    db.run(
        `INSERT INTO digestor_discharges
         (digestor_id, cooking_cycle_id, toneladas_discarded, notes, operator_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
            digestor_id,
            cooking_cycle_id || null,
            toneladas_discarded || 0,
            notes || null,
            req.user.id
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

// ------------------------------------------------------------
// Histórico — listagem
// ------------------------------------------------------------
app.get("/api/cycles/all", (req, res) => {
    db.all(
        `SELECT cy.*, d.nome AS digestor_name
         FROM cycles cy
         LEFT JOIN digestors d ON d.id = cy.digestor_id
         ORDER BY cy.id DESC LIMIT 200`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// Detalhes
app.get("/api/cycles/:id", (req, res) => {
    const { id } = req.params;

    const sql = `
        SELECT cy.*, d.nome AS digestor_name,
               tc.start_tritura_at, tc.end_tritura_at, tc.toneladas_trituradas,
               cc.start_cook_at, cc.end_cook_at,
               dd.toneladas_discarded, dd.notes
        FROM cycles cy
        LEFT JOIN digestors d ON d.id = cy.digestor_id
        LEFT JOIN trituration_cycles tc ON tc.id = cy.trituration_id
        LEFT JOIN cooking_cycles cc ON cc.id = cy.cooking_id
        LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
        WHERE cy.id = ?
    `;

    db.get(sql, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Ciclo não encontrado" });
        res.json(row);
    });
});

// ------------------------------------------------------------
// PDF
// ------------------------------------------------------------
app.get("/reports/cycle/:id", (req, res) => {
    if (!gerarPDFCicloUtil)
        return res.status(500).send("PDF não disponível no servidor.");

    const { id } = req.params;

    db.get(
        `SELECT cy.*, d.nome AS digestor_name,
                tc.*, cc.*, dd.*
         FROM cycles cy
         LEFT JOIN digestors d ON d.id = cy.digestor_id
         LEFT JOIN trituration_cycles tc ON tc.id = cy.trituration_id
         LEFT JOIN cooking_cycles cc ON cc.id = cy.cooking_id
         LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
         WHERE cy.id = ?`,
        [id],
        async (err, ciclo) => {
            if (err || !ciclo) return res.status(404).send("Não encontrado");

            const fileName = `ciclo_${id}_${Date.now()}.pdf`;
            const filePath = path.join(REPORTS_DIR, fileName);

            try {
                await gerarPDFCicloUtil(ciclo, filePath);
                res.json({ url: `/reports/${fileName}` });
            } catch (e) {
                res.status(500).send("Erro PDF");
            }
        }
    );
});

// ------------------------------------------------------------
// Socket.IO
// ------------------------------------------------------------
io.on("connection", socket => {
    console.log("🔌 Cliente conectado:", socket.id);
    broadcastState();
});

// ------------------------------------------------------------
// Start server
// ------------------------------------------------------------
const PORT = process.env.PORT || 3002;
server.listen(PORT, () =>
    console.log("🚀 Servidor rodando na porta", PORT)
);

