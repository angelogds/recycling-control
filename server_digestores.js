/* ===========================================================
   SISTEMA COMPLETO – CONTROLE DE PROCESSO DE RECICLAGEM
   COM: OPERADOR ✔ PORTARIA ✔ TOVAS ✔ DIGESTORES ✔ PDF ✔ SOCKET.IO ✔
   =========================================================== */
const expressLayouts = require('express-ejs-layouts');
app.use(expressLayouts);
app.set("layout", "layouts/base"); 

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");
const PDFDocument = require("pdfkit");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Caminhos importantes
const dbFile = path.join(__dirname, "database.sqlite");
const publicDir = path.join(__dirname, "public");
const viewsDir = path.join(__dirname, "views");
const reportsDir = path.join(publicDir, "reports");

// Garantir pasta de relatórios
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

// Configurações Express
app.use(express.static(publicDir));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// EJS
app.set("view engine", "ejs");
app.set("views", viewsDir);

// Banco
const db = new sqlite3.Database(dbFile);

// Mock usuário (depois trocamos)
app.use((req, res, next) => {
    req.user = { id: 2, nome: "Operador A", role: "operador" };
    next();
});

/* ===========================================================
   🔥 FUNÇÃO CENTRAL: EMITE ESTADOS VIA SOCKET.IO PARA O PAINEL
   =========================================================== */
function broadcastState() {
    // DIGESTORES
    db.all(`SELECT * FROM digestors ORDER BY id`, [], async (err, digestores) => {
        if (err) return;

        const resultado = [];
        for (const d of digestores) {
            const tritura = await new Promise(resolve =>
                db.get(
                    `SELECT * FROM trituration_cycles WHERE digestor_id = ? AND status IN ('created','started') ORDER BY id DESC LIMIT 1`,
                    [d.id],
                    (e, row) => resolve(row || null)
                )
            );

            const cook = await new Promise(resolve =>
                db.get(
                    `SELECT * FROM cooking_cycles WHERE digestor_id = ? AND status IN ('created','started') ORDER BY id DESC LIMIT 1`,
                    [d.id],
                    (e, row) => resolve(row || null)
                )
            );

            const cycle = await new Promise(resolve =>
                db.get(
                    `SELECT * FROM cycles WHERE digestor_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1`,
                    [d.id],
                    (e, row) => resolve(row || null)
                )
            );

            resultado.push({
                ...d,
                current_tritura: tritura,
                current_cooking: cook,
                current_cycle: cycle,
            });
        }

        io.emit("digestors:update", resultado);
    });

    // TOVAS
    db.all(`SELECT * FROM tovas ORDER BY id`, [], (err, rows) => {
        if (!err) io.emit("tovas:update", rows);
    });

    // ENTRADAS DE CAMINHÃO
    db.all(
        `SELECT id,truck_plate,toneladas_declared,arrival_at,status FROM entries WHERE status!='reception_finished' ORDER BY id DESC LIMIT 50`,
        [],
        (err, rows) => {
            if (!err) io.emit("entries:update", rows);
        }
    );
}

/* ===========================================================
   🌐 ROTAS - INTERFACE (VIEWS)
   =========================================================== */

// Rota inicial → manda para painel operador
app.get("/", (req, res) => res.redirect("/operador/painel"));

/* ---------- Operador ---------- */
app.get("/operador/painel", (req, res) => {
    res.render("operador_painel", { usuario: req.user });
});

/* ---------- Portaria ---------- */
app.get("/portaria", (req, res) => {
    res.render("portaria_painel", { usuario: req.user });
});

app.get("/portaria/chegada", (req, res) => {
    res.render("portaria_chegada_form", { usuario: req.user });
});

app.post("/portaria/chegada", (req, res) => {
    const { placa, toneladas } = req.body;

    db.run(
        `INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id) VALUES (?,?,?)`,
        [placa, toneladas, req.user.id],
        function (err) {
            if (err) return res.send("Erro DB: " + err.message);

            broadcastState();
            res.redirect("/portaria");
        }
    );
});

/* ---------- Tovas ---------- */
app.get("/tovas", (req, res) => {
    res.render("tovas_dashboard", { usuario: req.user });
});

app.get("/tovas/:id/editar", (req, res) => {
    db.get(`SELECT * FROM tovas WHERE id=?`, [req.params.id], (err, row) => {
        if (err || !row) return res.send("Tova não encontrada");

        res.render("tovas_editar", { usuario: req.user, tova: row });
    });
});

app.post("/tovas/:id/update", (req, res) => {
    const { nome, capacidade_tn } = req.body;

    db.run(
        `UPDATE tovas SET nome=?, capacidade_tn=? WHERE id=?`,
        [nome, capacidade_tn, req.params.id],
        (err) => {
            if (err) return res.send("Erro: " + err.message);

            broadcastState();
            res.redirect("/tovas");
        }
    );
});

/* ===========================================================
   🔥 APIs - USADAS PELO PAINEL E SOCKET.IO
   =========================================================== */

app.get("/api/digestors", (req, res) => {
    const sql = `SELECT * FROM digestors ORDER BY id`;
    db.all(sql, [], async (err, digestores) => {
        if (err) return res.status(500).json({ error: err.message });

        const result = [];
        for (const d of digestores) {
            const tritura = await new Promise(resolve =>
                db.get(`SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1`,
                    [d.id], (_, r) => resolve(r || null))
            );

            const cook = await new Promise(resolve =>
                db.get(`SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1`,
                    [d.id], (_, r) => resolve(r || null))
            );

            const cycle = await new Promise(resolve =>
                db.get(`SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1`,
                    [d.id], (_, r) => resolve(r || null))
            );

            result.push({
                ...d,
                current_tritura: tritura,
                current_cooking: cook,
                current_cycle: cycle,
            });
        }

        res.json(result);
    });
});

app.get("/api/tovas", (req, res) => {
    db.all(`SELECT * FROM tovas ORDER BY id`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get("/api/entries/pending", (req, res) => {
    db.all(
        `SELECT id,truck_plate,toneladas_declared,arrival_at,status FROM entries WHERE status != 'reception_finished' ORDER BY id DESC LIMIT 50`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

/* ===========================================================
   🔥 AÇÕES DO PROCESSO (TRITURAÇÃO, COZIMENTO, DESCARGA)
   =========================================================== */

app.post("/api/trituracao/start", (req, res) => {
    const { digestor_id, from_tova_id, toneladas_solicitadas } = req.body;

    if (!digestor_id || !from_tova_id || !toneladas_solicitadas)
        return res.status(400).json({ error: "Dados incompletos" });

    const agora = new Date().toISOString();

    db.run(
        `INSERT INTO trituration_cycles (digestor_id, from_tova_id, toneladas_solicitadas, start_tritura_at, status, operator_id) 
         VALUES (?,?,?,?, 'started', ?)`,
        [digestor_id, from_tova_id, toneladas_solicitadas, agora, req.user.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            broadcastState();
            res.json({ trituration_id: this.lastID });
        }
    );
});

app.post("/api/trituracao/finish", (req, res) => {
    const { trituration_id, toneladas_trituradas } = req.body;
    const fim = new Date().toISOString();

    db.run(
        `UPDATE trituration_cycles SET end_tritura_at=?, toneladas_trituradas=?, status='finished' WHERE id=?`,
        [fim, toneladas_trituradas, trituration_id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            broadcastState();
            res.json({ ok: true });
        }
    );
});

app.post("/api/cooking/finish", (req, res) => {
    const { cooking_id } = req.body;
    const fim = new Date().toISOString();

    db.run(
        `UPDATE cooking_cycles SET end_cook_at=?, status='finished' WHERE id=?`,
        [fim, cooking_id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            broadcastState();
            res.json({ ok: true });
        }
    );
});

app.post("/api/digestor/discharge", (req, res) => {
    const { digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;

    db.run(
        `INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes) 
         VALUES (?,?,?,?,?,?)`,
        [digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded || 0, req.user.id, notes],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            broadcastState();
            res.json({ discharge_id: this.lastID });
        }
    );
});

/* ===========================================================
   📄 GERAR RELATÓRIO PDF PREMIUM DO CICLO
   =========================================================== */
app.get("/reports/cycle/:id", (req, res) => {
    const id = req.params.id;

    const sql = `
        SELECT cy.*, d.nome AS digestor_name,
               tc.start_tritura_at, tc.end_tritura_at, tc.toneladas_trituradas,
               cc.start_cook_at, cc.end_cook_at,
               r.toneladas AS toneladas_reception
        FROM cycles cy
        LEFT JOIN digestors d ON cy.digestor_id = d.id
        LEFT JOIN trituration_cycles tc ON cy.trituration_id = tc.id
        LEFT JOIN cooking_cycles cc ON cy.cooking_id = cc.id
        LEFT JOIN reception_loads r ON cy.reception_load_id = r.id
        WHERE cy.id = ?
    `;

    db.get(sql, [id], (err, row) => {
        if (err || !row) return res.send("Ciclo não encontrado");

        const filename = `ciclo_${id}_${Date.now()}.pdf`;
        const filepath = path.join(reportsDir, filename);

        const doc = new PDFDocument({ margin: 40 });
        doc.pipe(fs.createWriteStream(filepath));

        doc.fontSize(20).text("RELATÓRIO DE CICLO - RECICLAGEM", { align: "center" });
        doc.moveDown();

        doc.fontSize(14).text(`Ciclo #${id}`);
        doc.text(`Digestor: ${row.digestor_name}`);
        doc.text(`Início: ${row.started_at}`);
        doc.text(`Fim: ${row.ended_at}`);
        doc.moveDown();

        doc.fontSize(14).text("Trituração:");
        doc.fontSize(12).text(`Início: ${row.start_tritura_at}`);
        doc.text(`Fim: ${row.end_tritura_at}`);
        doc.text(`Toneladas: ${row.toneladas_trituradas}`);
        doc.moveDown();

        doc.fontSize(14).text("Cozimento:");
        doc.fontSize(12).text(`Início: ${row.start_cook_at}`);
        doc.text(`Fim: ${row.end_cook_at}`);
        doc.moveDown();

        doc.end();

        res.json({ url: `/reports/${filename}` });
    });
});

/* ===========================================================
   SOCKET.IO
   =========================================================== */
io.on("connection", (socket) => {
    console.log("📡 Cliente conectado:", socket.id);
    broadcastState();
});

/* ===========================================================
   INICIAR SERVIDOR
   =========================================================== */
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
    console.log("🚀 Server rodando na porta", PORT);
});
