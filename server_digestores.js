// server_digestores.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const dbFile = path.join(__dirname, 'database.sqlite');
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(path.join(publicDir, 'reports'))) fs.mkdirSync(path.join(publicDir, 'reports'), { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(publicDir));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const db = new sqlite3.Database(dbFile);

// MOCK auth middleware (substituir por sua autenticação)
app.use((req, res, next) => {
  req.user = { id: 2, nome: 'Operador A', role: 'operador' };
  next();
});

/* ---------- Helper: emitir estados atualizados ---------- */
function broadcastState() {
  db.all(`SELECT id,nome,capacidade_tn,status,last_cycle_id FROM digestors ORDER BY id`, [], (err, digestores) => {
    if (!err) {
      const promises = digestores.map(d => new Promise(resolve => {
        db.get(`SELECT * FROM trituration_cycles WHERE digestor_id = ? AND status IN ('created','started') ORDER BY id DESC LIMIT 1`, [d.id], (e, trit) => {
          db.get(`SELECT * FROM cooking_cycles WHERE digestor_id = ? AND status IN ('created','started') ORDER BY id DESC LIMIT 1`, [d.id], (e2, cook) => {
            db.get(`SELECT * FROM cycles WHERE digestor_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1`, [d.id], (e3, cyc) => {
              resolve({ ...d, current_tritura: trit || null, current_cooking: cook || null, current_cycle: cyc || null });
            });
          });
        });
      }));
      Promise.all(promises).then(result => io.emit('digestors:update', result));
    }
  });

  db.all(`SELECT id,nome,capacidade_tn,current_tn FROM tovas ORDER BY id`, [], (err2, tovas) => {
    if (!err2) io.emit('tovas:update', tovas);
  });

  db.all(`SELECT id,truck_plate,toneladas_declared,arrival_at,status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 20`, [], (err3, entries) => {
    if (!err3) io.emit('entries:update', entries);
  });
}

/* ---------- Render painel operador / dashboard ---------- */
app.get('/operador/painel', (req, res) => {
  res.render('operador_painel', { usuario: req.user });
});

/* ---------- APIs ---------- */
app.get('/api/digestors', (req, res) => {
  const sql = `SELECT id, nome, capacidade_tn, status, last_cycle_id, created_at FROM digestors ORDER BY id`;
  db.all(sql, [], async (err, digestores) => {
    if (err) return res.status(500).json({ error: err.message });
    const result = [];
    for (const dig of digestores) {
      const trit = await new Promise(resolve => db.get(`SELECT * FROM trituration_cycles WHERE digestor_id = ? AND status IN ('created','started') ORDER BY id DESC LIMIT 1`, [dig.id], (e,row)=>resolve(row||null)));
      const cook = await Promise.resolve(new Promise(resolve => db.get(`SELECT * FROM cooking_cycles WHERE digestor_id = ? AND status IN ('created','started') ORDER BY id DESC LIMIT 1`, [dig.id], (e,row)=>resolve(row||null))));
      const cycle = await new Promise(resolve => db.get(`SELECT * FROM cycles WHERE digestor_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1`, [dig.id], (e,row)=>resolve(row||null)));
      result.push({ ...dig, current_tritura: trit, current_cooking: cook, current_cycle: cycle });
    }
    res.json(result);
  });
});

app.get('/api/tovas', (req, res) => {
  db.all(`SELECT id, nome, capacidade_tn, current_tn FROM tovas ORDER BY id`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/entries/pending', (req,res) => {
  db.all(`SELECT id,truck_plate,toneladas_declared,arrival_at,status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/trituracao/start', (req, res) => {
  const { digestor_id, from_tova_id, toneladas_solicitadas, reception_load_id } = req.body;
  if (!digestor_id || !from_tova_id || !toneladas_solicitadas) {
    return res.status(400).json({ error: 'digestor_id, from_tova_id e toneladas_solicitadas são obrigatórios' });
  }
  const startTime = new Date().toISOString();
  const insertSql = `INSERT INTO trituration_cycles(reception_load_id, from_tova_id, digestor_id, toneladas_solicitadas, start_tritura_at, status, operator_id, created_at) VALUES (?,?,?,?,?, 'started', ?, datetime('now'))`;
  db.run(insertSql, [reception_load_id || null, from_tova_id, digestor_id, toneladas_solicitadas, startTime, req.user.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    broadcastState();
    res.json({ trituration_id: this.lastID });
  });
});

app.post('/api/trituracao/finish', (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  if (!trituration_id || toneladas_trituradas === undefined) {
    return res.status(400).json({ error: 'trituration_id e toneladas_trituradas são obrigatórios' });
  }
  const endTime = new Date().toISOString();
  const sql = `UPDATE trituration_cycles SET end_tritura_at = ?, toneladas_trituradas = ?, status = 'finished' WHERE id = ?`;
  db.run(sql, [endTime, toneladas_trituradas, trituration_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    broadcastState();
    res.json({ updated: this.changes });
  });
});

app.post('/api/cooking/finish', (req, res) => {
  const { cooking_id } = req.body;
  if (!cooking_id) return res.status(400).json({ error: 'cooking_id obrigatório' });
  const endTime = new Date().toISOString();
  const sql = `UPDATE cooking_cycles SET end_cook_at = ?, status = 'finished' WHERE id = ?`;
  db.run(sql, [endTime, cooking_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    broadcastState();
    res.json({ updated: this.changes });
  });
});

app.post('/api/digestor/discharge', (req, res) => {
  const { digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;
  if (!digestor_id) return res.status(400).json({ error: 'digestor_id obrigatório' });
  const sql = `INSERT INTO digestor_discharges(digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes, discharged_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`;
  db.run(sql, [digestor_id, trituration_cycle_id || null, cooking_cycle_id || null, toneladas_discarded || 0, req.user.id, notes || null], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    broadcastState();
    res.json({ discharge_id: this.lastID });
  });
});

app.get('/api/cycles/last', (req,res) => {
  db.get(`SELECT id, started_at, ended_at FROM cycles ORDER BY id DESC LIMIT 1`, [], (err,row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || {});
  });
});

app.get('/reports/cycle/:cycleId', (req, res) => {
  const cycleId = req.params.cycleId;
  const sql = `
    SELECT cy.*, e.truck_plate, r.toneladas as toneladas_reception,
           tc.toneladas_trituradas, tc.start_tritura_at, tc.end_tritura_at,
           cc.start_cook_at, cc.end_cook_at, d.nome as digestor_name,
           u.nome as operador_name
    FROM cycles cy
    LEFT JOIN entries e ON cy.entry_id = e.id
    LEFT JOIN reception_loads r ON cy.reception_load_id = r.id
    LEFT JOIN trituration_cycles tc ON cy.trituration_id = tc.id
    LEFT JOIN cooking_cycles cc ON cy.cooking_id = cc.id
    LEFT JOIN digestors d ON cy.digestor_id = d.id
    LEFT JOIN users u ON tc.operator_id = u.id
    WHERE cy.id = ?
  `;
  db.get(sql, [cycleId], (err, row) => {
    if (err) return res.status(500).send('Erro DB: ' + err.message);
    if (!row) return res.status(404).send('Ciclo não encontrado');

    const filename = `cycle_${cycleId}_${Date.now()}.pdf`;
    const filepath = path.join(publicDir, 'reports', filename);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    const logoPath = path.join(publicDir, 'img', 'logo_menu_256.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 40, 30, { width: 80 });
    }
    doc.fontSize(18).text('Relatório de Ciclo - Fábrica de Reciclagem', 140, 40);
    doc.moveDown();

    doc.fontSize(12).text(`Ciclo ID: ${row.id}`);
    doc.text(`Digestor: ${row.digestor_name || '—'}`);
    doc.text(`Início do Ciclo: ${row.started_at || '—'}`);
    doc.text(`Fim do Ciclo: ${row.ended_at || '—'}`);
    doc.moveDown();

    doc.fontSize(14).text('Detalhes da Recepção / Material', { underline: true });
    doc.fontSize(12).text(`Caminhão (placa): ${row.truck_plate || '—'}`);
    doc.text(`Toneladas na recepção: ${row.toneladas_reception || '—'}`);
    doc.moveDown();

    doc.fontSize(14).text('Trituração', { underline: true });
    doc.fontSize(12).text(`Início: ${row.start_tritura_at || '—'}`);
    doc.text(`Fim: ${row.end_tritura_at || '—'}`);
    doc.text(`Toneladas Trituradas: ${row.toneladas_trituradas || '—'}`);
    doc.moveDown();

    doc.fontSize(14).text('Cozimento', { underline: true });
    doc.fontSize(12).text(`Início: ${row.start_cook_at || '—'}`);
    doc.text(`Fim: ${row.end_cook_at || '—'}`);
    doc.moveDown();

    doc.fontSize(12).text(`Operador: ${row.operador_name || '—'}`);
    doc.moveDown(1.5);

    doc.fontSize(10).text('Assinatura do Operador: _____________________________', { continued: false });
    doc.moveDown(2);

    doc.fontSize(9).fillColor('gray').text('Gerado por sistema — Controle de Matéria-Prima', { align: 'center' });

    doc.end();

    stream.on('finish', () => {
      const publicUrl = `/reports/${filename}`;
      res.json({ url: publicUrl });
    });
  });
});

io.on('connection', (socket) => {
  console.log('Socket conectado', socket.id);
  broadcastState();
  socket.on('ping', () => socket.emit('pong'));
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Server digestores rodando na porta ${PORT}`);
});
