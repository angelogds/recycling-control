const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

const DB = "database.sqlite";

if (!fs.existsSync(DB)) {
    console.log("❌ Banco não encontrado!");
    process.exit(1);
}

const db = new sqlite3.Database(DB);

console.log("🔧 Iniciando SEED de Processo...");

db.serialize(() => {
    
    /* -----------------------------
        DIGESTORES
    ----------------------------- */
    db.run("DELETE FROM digestors");
    db.run(`
        INSERT INTO digestors (id, nome, capacidade_tn, status)
        VALUES 
            (1, 'Digestor 1', 20, 'idle'),
            (2, 'Digestor 2', 20, 'idle'),
            (3, 'Digestor 3', 25, 'idle'),
            (4, 'Digestor 4', 25, 'idle')
    `);

    /* -----------------------------
        TOVAS
    ----------------------------- */
    db.run("DELETE FROM tovas");
    db.run(`
        INSERT INTO tovas (id, nome, capacidade_tn, current_tn)
        VALUES
            (1, 'Tova A', 15, 8),
            (2, 'Tova B', 20, 15),
            (3, 'Tova C', 18, 12)
    `);

    /* -----------------------------
        EQUIPAMENTOS
    ----------------------------- */
    db.run("DELETE FROM equipamentos");
    db.run(`
        INSERT INTO equipamentos (nome, codigo, setor, categoria)
        VALUES
            ('Esteira 01', 'EST-01', 'Linha Verde', 'Transporte'),
            ('Triturador Primário', 'TRI-P', 'Moagem', 'Trituradores'),
            ('Triturador Secundário', 'TRI-S', 'Moagem', 'Trituradores'),
            ('Caldeira Térmica 01', 'CALD-01', 'Cozimento', 'Caldeiras'),
            ('Balança Rodoviária', 'BAL-R1', 'Portaria', 'Medição')
    `);

    /* -----------------------------
        CICLO DE EXEMPLO
    ----------------------------- */
    db.run("DELETE FROM cycles");
    db.run("DELETE FROM trituration_cycles");
    db.run("DELETE FROM cooking_cycles");
    db.run("DELETE FROM digestor_discharges");

    db.run(`
        INSERT INTO trituration_cycles (id, digestor_id, toneladas_solicitadas, start_tritura_at, end_tritura_at, toneladas_trituradas, status)
        VALUES (1, 1, 12, datetime('now','-3 hours'), datetime('now','-2 hours'), 12, 'finished')
    `);

    db.run(`
        INSERT INTO cooking_cycles (id, digestor_id, start_cook_at, end_cook_at, status)
        VALUES (1, 1, datetime('now','-2 hours'), datetime('now','-1 hour'), 'finished')
    `);

    db.run(`
        INSERT INTO cycles (id, digestor_id, trituration_id, cooking_id, started_at, ended_at, status)
        VALUES (1, 1, 1, 1, datetime('now','-3 hours'), datetime('now','-1 hour'), 'finished')
    `);

    db.run(`
        INSERT INTO digestor_discharges (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, notes)
        VALUES (1, 1, 1, 11.8, 'Descarga normal')
    `);

    console.log("✔ SEED COMPLETO!");
});

db.close();
