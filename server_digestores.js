// server.js — SERVER PREMIUM (compatível com views green/white)
// Requisitos: npm i express ejs sqlite3 socket.io pdfkit body-parser

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

// Ensure public/reports exists
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

// Database connection
if (!fs.existsSync(DB_FILE)) {
  console.warn('Warning: database.sqlite not found at', DB_FILE, '\nRun `npm run init-db` before starting or create the DB.');
}
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error('SQLite open error:', err);
  else console.log('Connected to SQLite DB:', DB_FILE);
});

// Mock auth middleware (replace with real auth later)
app.use((req, res, next) => {
  // default user for dev
  req.user = { id: 2, nome: 'Operador A', role: 'operador' };
  next();
});

/* -------------------------
   Helper: broadcastState()
   - envia digestores, tovas, entradas para todos os sockets
------------------------- */
function broadcastState() {
  // Digestores + ciclos ativos
  db.all('SELECT id, nome, capacidade_tn, status, last_cycle_id FROM digestors ORDER BY id', [], (err, digestores) => {
    if (err) {
      console.error('DB error (digestors):', err);
    } else {
      const promises = digestores.map(d => new Promise(resolve => {
        db.get(`SELECT * FROM trituration_cycles WHERE digestor_id = ? AND status IN ('created','started') ORDER BY id DESC LIMIT 1`, [d.id], (e1, trit) => {
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

  // Tovas
  db.all('SELECT id, nome, capacidade_tn, current_tn FROM tovas ORDER BY id', [], (err2, tovas) => {
    if (err2) console.error('DB error (tovas):', err2);
    else io.emit('tovas:update', tovas);
  });

  // Entradas pendentes
  db.all(`SELECT id, truck_plate, toneladas_declared, arrival_at, status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50`, [], (err3, rows) => {
    if (err3) console.error('DB error (entries):', err3);
    else io.emit('entries:update', rows);
  });
}

/* -------------------------
   ROUTES - VIEWS
------------------------- */

// root -> redirect to painel operador
app.get('/', (req, res) => res.redirect('/operador/painel'));

// Operador
app.get('/operador/painel', (req, res) => {
  try {
    res.render('operador_painel', { usuario: req.user });
  } catch (err) {
    console.error('Render error /operador/painel:', err);
    res.status(500).send('Erro interno ao renderizar painel do operador.');
  }
});

// Portaria
app.get('/portaria', (req, res) => res.render('portaria_painel', { usuario: req.user }));
app.get('/portaria/chegada', (req, res) => res.render('portaria_chegada_form', { usuario: req.user }));

app.post('/portaria/chegada', (req, res) => {
  const { placa, toneladas } = req.body;
  if (!placa || !toneladas) {
    return res.status(400).send('Placa e toneladas são obrigatórios.');
  }
  db.run(`INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id) VALUES (?, ?, ?)`, [placa, toneladas, req.user.id], function(err) {
    if (err) {
      console.error('DB insert entry err:', err);
      return res.status(500).send('Erro ao registrar chegada.');
    }
    broadcastState();
    res.redirect('/portaria');
  });
});

// Tovas
app.get('/tovas', (req, res) => res.render('tovas_dashboard', { usuario: req.user }));
app.get('/tovas/:id/editar', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM tovas WHERE id = ?', [id], (err, row) => {
    if (err) { console.error(err); return res.status(500).send('Erro DB'); }
    if (!row) return res.status(404).send('Tova não encontrada');
    res.render('tovas_editar', { usuario: req.user, tova: row });
  });
});
app.post('/tovas/:id/update', (req, res) => {
  const id = req.params.id;
  const { nome, capacidade_tn } = req.body;
  db.run('UPDATE tovas SET nome = ?, capacidade_tn = ? WHERE id = ?', [nome, capacidade_tn, id], function(err) {
    if (err) { console.error(err); return res.status(500).send('Erro ao atualizar tova'); }
    broadcastState();
    res.redirect('/tovas');
  });
});

/* -------------------------
   APIs (JSON) - usadas pelos frontends
------------------------- */

// Digestores + ciclos ativos
app.get('/api/digestors', (req, res) => {
  db.all('SELECT id, nome, capacidade_tn, status, last_cycle_id FROM digestors ORDER BY id', [], async (err, digestores) => {
    if (err) return res.status(500).json({ error: err.message });
    const result = [];
    for (const d of digestores) {
      const trit = await new Promise(resolve => db.get('SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN (\'created\',\'started\') ORDER BY id DESC LIMIT 1', [d.id], (_,r)=>resolve(r||null)));
      const cook = await new Promise(resolve => db.get('SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN (\'created\',\'started\') ORDER BY id DESC LIMIT 1', [d.id], (_,r)=>resolve(r||null)));
      const cycle = await new Promise(resolve => db.get('SELECT * FROM cycles WHERE digestor_id=? AND status=\'in_progress\' ORDER BY id DESC LIMIT 1', [d.id], (_,r)=>resolve(r||null)));
      result.push({ ...d, current_tritura: trit, current_cooking: cook, current_cycle: cycle });
    }
    res.json(result);
  });
});

// Tovas
app.get('/api/tovas', (req, res) => {
  db.all('SELECT id, nome, capacidade_tn, current_tn FROM tovas ORDER BY id', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Entradas pendentes
app.get('/api/entries/pending', (req, res) => {
  db.all(`SELECT id, truck_plate, toneladas_declared, arrival_at, status FROM entries WHERE status != 'reception_finished' ORDER BY arrival_at DESC LIMIT 50`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Start trituração (iniciar carregamento)
app.post('/api/trituracao/start', (req, res) => {
  const { digestor_id, from_tova_id, toneladas_solicitadas } = req.body;
  if (!digestor_id || !from_tova_id || !toneladas_solicitadas) return res.status(400).json({ error: 'Dados incompletos' });

  const now = new Date().toISOString();
  db.run(`INSERT INTO trituration_cycles (digestor_id, from_tova_id, toneladas_solicitadas, start_tritura_at, status, operator_id) VALUES (?,?,?,?, 'started', ?)`, [digestor_id, from_tova_id, toneladas_solicitadas, now, req.user.id], function(err) {
    if (err) { console.error('Err start trit:', err); return res.status(500).json({ error: err.message }); }
    // triggers handle tova decrement and creation of cycles if present in DB triggers
    broadcastState();
    res.json({ trituration_id: this.lastID });
  });
});

// Finish trituração
app.post('/api/trituracao/finish', (req, res) => {
  const { trituration_id, toneladas_trituradas } = req.body;
  if (!trituration_id || toneladas_trituradas === undefined) return res.status(400).json({ error: 'Dados incompletos' });
  const now = new Date().toISOString();
  db.run('UPDATE trituration_cycles SET end_tritura_at = ?, toneladas_trituradas = ?, status = \'finished\' WHERE id = ?', [now, toneladas_trituradas, trituration_id], function(err) {
    if (err) { console.error('Err finish trit:', err); return res.status(500).json({ error: err.message }); }
    broadcastState();
    res.json({ ok: true });
  });
});

// Finish cooking
app.post('/api/cooking/finish', (req, res) => {
  const { cooking_id } = req.body;
  if (!cooking_id) return res.status(400).json({ error: 'cooking_id required' });
  const now = new Date().toISOString();
  db.run('UPDATE cooking_cycles SET end_cook_at = ?, status = \'finished\' WHERE id = ?', [now, cooking_id], function(err) {
    if (err) { console.error('Err finish cook:', err); return res.status(500).json({ error: err.message }); }
    broadcastState();
    res.json({ ok: true });
  });
});

// Discharge digestor (descarregamento)
app.post('/api/digestor/discharge', (req, res) => {
  const { digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;
  if (!digestor_id) return res.status(400).json({ error: 'digestor_id required' });
  db.run('INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes) VALUES (?,?,?,?,?,?)',
    [digestor_id, trituration_cycle_id || null, cooking_cycle_id || null, toneladas_discarded || 0, req.user.id, notes || null],
    function(err) {
      if (err) { console.error('Err discharge:', err); return res.status(500).json({ error: err.message }); }
      // mark digestor idle (optional via trigger or manual update)
      db.run('UPDATE digestors SET status = ? WHERE id = ?', ['idle', digestor_id], () => {
        broadcastState();
        res.json({ discharge_id: this.lastID });
      });
    });
});

// Last cycle (helper)
app.get('/api/cycles/last', (req, res) => {
  db.get('SELECT id, started_at, ended_at FROM cycles ORDER BY id DESC LIMIT 1', [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || {});
  });
});

/* -------------------------
   PDF REPORT
------------------------- */

app.get('/reports/cycle/:id', (req, res) => {
  const cycleId = req.params.id;
  const sql = `
    SELECT cy.*, d.nome as digestor_name,
           tc.start_tritura_at, tc.end_tritura_at, tc.toneladas_trituradas,
           cc.start_cook_at, cc.end_cook_at
    FROM cycles cy
    LEFT JOIN digestors d ON cy.digestor_id = d.id
    LEFT JOIN trituration_cycles tc ON cy.trituration_id = tc.id
    LEFT JOIN cooking_cycles cc ON cy.cooking_id = cc.id
    WHERE cy.id = ?
  `;
  db.get(sql, [cycleId], (err, row) => {
    if (err) { console.error('Err get cycle for pdf:', err); return res.status(500).send('Erro DB'); }
    if (!row) return res.status(404).send('Ciclo não encontrado');

    const filename = `cycle_${cycleId}_${Date.now()}.pdf`;
    const filepath = path.join(REPORTS_DIR, filename);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // Header
    doc.fontSize(18).text('Relatório de Ciclo - Fábrica de Reciclagem', { align: 'center' }).moveDown();
    doc.fontSize(12).text(`Ciclo ID: ${row.id}`);
    doc.text(`Digestor: ${row.digestor_name || '—'}`);
    doc.text(`Início do ciclo: ${row.started_at || '—'}`);
    doc.text(`Fim do ciclo: ${row.ended_at || '—'}`).moveDown();

    doc.fontSize(14).text('Trituração');
    doc.fontSize(12).text(`Início: ${row.start_tritura_at || '—'}`);
    doc.text(`Fim: ${row.end_tritura_at || '—'}`);
    doc.text(`Toneladas trituradas: ${row.toneladas_trituradas || '—'}`).moveDown();

    doc.fontSize(14).text('Cozimento');
    doc.fontSize(12).text(`Início: ${row.start_cook_at || '—'}`);
    doc.text(`Fim: ${row.end_cook_at || '—'}`).moveDown();

    doc.end();

    stream.on('finish', () => {
      res.json({ url: `/reports/${filename}` });
    });
    stream.on('error', (e) => {
      console.error('PDF stream err:', e);
      res.status(500).send('Erro gerar PDF');
    });
  });
});

/* -------------------------
   Socket.IO connection
------------------------- */
io.on('connection', socket => {
  console.log('Socket connected:', socket.id);
  // send initial state
  broadcastState();

  socket.on('ping', () => socket.emit('pong'));
});

/* -------------------------
   Error handler
------------------------- */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

/* -------------------------
   Start server
------------------------- */
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log('🚀 Server rodando na porta', PORT);
});
