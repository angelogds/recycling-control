const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const DB_FILE = "database.sqlite";
const SQL_FILE = "init_db.sql";

console.log("🔄 Iniciando criação do banco...");

if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);

const db = new sqlite3.Database(DB_FILE);

const sql = fs.readFileSync(SQL_FILE, "utf8");

db.exec(sql, (err) => {
  if (err) {
    console.error("❌ Erro ao criar banco:", err);
  } else {
    console.log("✅ Banco criado com sucesso!");
    console.log("📌 Arquivo:", DB_FILE);
  }
  db.close();
});
