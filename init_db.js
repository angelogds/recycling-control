const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbFile = path.join(__dirname, "database.sqlite");
const sqlFile = path.join(__dirname, "init_db.sql");

console.log("🔄 Iniciando criação do banco...");

if (!fs.existsSync(sqlFile)) {
  console.error("❌ Arquivo init_db.sql não encontrado!");
  process.exit(1);
}

const sql = fs.readFileSync(sqlFile, "utf-8");

// Remove DB antigo (OPCIONAL)
if (fs.existsSync(dbFile)) {
  console.log("🗑 Removendo banco antigo (database.sqlite)...");
  fs.unlinkSync(dbFile);
}

const db = new sqlite3.Database(dbFile);

db.exec(sql, (err) => {
  if (err) {
    console.error("❌ Erro ao executar SQL:", err);
    process.exit(1);
  }

  console.log("✅ Banco criado com sucesso!");
  console.log("📌 Arquivo:", dbFile);
  db.close();
});
