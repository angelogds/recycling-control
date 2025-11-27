// init_db.js
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_FILE = path.join(__dirname, 'database.sqlite');
const SQL_FILE = path.join(__dirname, 'init_db.sql');

if (fs.existsSync(DB_FILE)) {
  console.log('🗑 Removendo banco antigo (database.sqlite)...');
  fs.unlinkSync(DB_FILE);
}

const sql = fs.readFileSync(SQL_FILE, 'utf8');

const db = new sqlite3.Database(DB_FILE);
db.exec(sql, (err) => {
  if (err) {
    console.error('Erro ao criar DB:', err);
    process.exit(1);
  } else {
    console.log('✅ Banco criado com sucesso!');
    console.log('📌 Arquivo:', DB_FILE);
    db.close();
  }
});
