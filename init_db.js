const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbFile = path.join(__dirname, 'database.sqlite');
const sqlFile = path.join(__dirname, 'init_db.sql');

if (!fs.existsSync(sqlFile)) {
  console.error('init_db.sql não encontrado.');
  process.exit(1);
}

const sql = fs.readFileSync(sqlFile, 'utf8');

if (fs.existsSync(dbFile)) {
  console.log('database.sqlite já existe. Removendo (se quiser manter, faça backup e comente esta linha).');
  // se preferir, comente a próxima linha
  // fs.unlinkSync(dbFile);
}

const db = new sqlite3.Database(dbFile);

db.exec(sql, (err) => {
  if (err) {
    console.error('Erro ao executar SQL:', err);
    process.exit(1);
  }
  console.log('Banco inicializado com sucesso em', dbFile);
  db.close();
});
