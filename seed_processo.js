const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const DB = process.env.DB_FILE || path.join(__dirname, "database.sqlite");

if (!fs.existsSync(DB)) {
  console.log(`❌ Banco não encontrado em: ${DB}`);
  process.exit(1);
}

const db = new sqlite3.Database(DB);

function tableExists(tableName) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      [tableName],
      (err, row) => {
        if (err) return reject(err);
        resolve(Boolean(row));
      }
    );
  });
}

function run(sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function all(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function getTableColumns(tableName) {
  const rows = await all(`PRAGMA table_info(${tableName})`);
  return new Set(rows.map((r) => r.name));
}

async function runSeed() {
  console.log(`🔧 Iniciando SEED de Processo em ${DB}...`);

  await run("DELETE FROM digestors");
  await run(`
    INSERT INTO digestors (id, nome, capacidade_tn, status)
    VALUES
      (1, 'Digestor 1', 20, 'idle'),
      (2, 'Digestor 2', 20, 'idle'),
      (3, 'Digestor 3', 25, 'idle'),
      (4, 'Digestor 4', 25, 'idle')
  `);

  await run("DELETE FROM tovas");
  await run(`
    INSERT INTO tovas (id, nome, capacidade_tn, current_tn)
    VALUES
      (1, 'Tova A', 15, 8),
      (2, 'Tova B', 20, 15),
      (3, 'Tova C', 18, 12)
  `);

  const hasEquipamentos = await tableExists("equipamentos");
  if (hasEquipamentos) {
    await run("DELETE FROM equipamentos");
    await run(`
      INSERT INTO equipamentos (nome, codigo, setor, categoria)
      VALUES
        ('Esteira 01', 'EST-01', 'Linha Verde', 'Transporte'),
        ('Triturador Primário', 'TRI-P', 'Moagem', 'Trituradores'),
        ('Triturador Secundário', 'TRI-S', 'Moagem', 'Trituradores'),
        ('Caldeira Térmica 01', 'CALD-01', 'Cozimento', 'Caldeiras'),
        ('Balança Rodoviária', 'BAL-R1', 'Portaria', 'Medição')
    `);
    console.log("ℹ️ Seed de equipamentos executado.");
  } else {
    console.log("ℹ️ Tabela 'equipamentos' não existe. Bloco de seed ignorado.");
  }

  await run("DELETE FROM cycles");
  await run("DELETE FROM trituration_cycles");
  await run("DELETE FROM cooking_cycles");
  await run("DELETE FROM digestor_discharges");

  const triturationColumns = await getTableColumns("trituration_cycles");
  const triturationIdColumn = triturationColumns.has("id") ? "id" : null;
  const triturationDigestorColumn = triturationColumns.has("digestor_id") ? "digestor_id" : null;
  const triturationRequestedColumn = triturationColumns.has("toneladas_solicitadas") ? "toneladas_solicitadas" : null;
  const triturationStartColumn = triturationColumns.has("start_tritura_at") ? "start_tritura_at" : null;
  const triturationEndColumn = triturationColumns.has("end_tritura_at") ? "end_tritura_at" : null;
  const triturationDoneColumn = triturationColumns.has("toneladas_trituradas") ? "toneladas_trituradas" : null;
  const triturationStatusColumn = triturationColumns.has("status") ? "status" : null;

  await run(`
    INSERT INTO trituration_cycles (${[
      triturationIdColumn,
      triturationDigestorColumn,
      triturationRequestedColumn,
      triturationStartColumn,
      triturationEndColumn,
      triturationDoneColumn,
      triturationStatusColumn
    ].filter(Boolean).join(", ")})
    VALUES (1, 1, 12, datetime('now','-3 hours'), datetime('now','-2 hours'), 12, 'finished')
  `);

  const cookingColumns = await getTableColumns("cooking_cycles");
  const cookingTriturationFk = cookingColumns.has("trituration_id")
    ? "trituration_id"
    : (cookingColumns.has("trituration_cycle_id") ? "trituration_cycle_id" : null);
  if (!cookingTriturationFk) {
    throw new Error("Tabela cooking_cycles sem coluna de relacionamento de trituração suportada.");
  }

  await run(`
    INSERT INTO cooking_cycles (id, digestor_id, ${cookingTriturationFk}, start_cook_at, end_cook_at, status)
    VALUES (1, 1, 1, datetime('now','-2 hours'), datetime('now','-1 hour'), 'finished')
  `);

  const cyclesColumns = await getTableColumns("cycles");
  const cyclesTriturationFk = cyclesColumns.has("trituration_id")
    ? "trituration_id"
    : (cyclesColumns.has("trituration_cycle_id") ? "trituration_cycle_id" : null);
  const cyclesCookingFk = cyclesColumns.has("cooking_id")
    ? "cooking_id"
    : (cyclesColumns.has("cooking_cycle_id") ? "cooking_cycle_id" : null);
  if (!cyclesTriturationFk || !cyclesCookingFk) {
    throw new Error("Tabela cycles sem colunas de relacionamento suportadas.");
  }

  await run(`
    INSERT INTO cycles (id, digestor_id, ${cyclesTriturationFk}, ${cyclesCookingFk}, started_at, ended_at, status)
    VALUES (1, 1, 1, 1, datetime('now','-3 hours'), datetime('now','-1 hour'), 'finished')
  `);

  await run(`
    INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, notes)
    VALUES (1, 1, 1, 11.8, 'Descarga normal')
  `);

  console.log("✅ SEED COMPLETO!");
}

runSeed()
  .catch((err) => {
    console.error("❌ Erro no seed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
