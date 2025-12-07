const express = require("express");
const path = require("path");
const fs = require("fs");

module.exports = (db, broadcastState, gerarPDFCicloUtil, REPORTS_DIR) => {
    const router = express.Router();

    /* =======================================================
       1) LISTA TODOS OS CICLOS (para o HISTÓRICO PREMIUM)
    ========================================================*/
    router.get("/all", (req, res) => {
        const sql = `
            SELECT cy.id, cy.digestor_id, cy.started_at, cy.ended_at, cy.status,
                   d.nome AS digestor_name
            FROM cycles cy
            LEFT JOIN digestors d ON cy.digestor_id = d.id
            ORDER BY cy.id DESC
            LIMIT 200
        `;

        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    /* =======================================================
       2) DETALHES COMPLETOS DO CICLO
    ========================================================*/
    router.get("/:id", (req, res) => {
        const id = req.params.id;

        const sql = `
            SELECT 
                cy.*,
                d.nome AS digestor_name,

                tc.start_tritura_at, 
                tc.end_tritura_at,
                tc.toneladas_trituradas,
                tc.toneladas_solicitadas,
                tc.materia_prima,

                cc.start_cook_at, 
                cc.end_cook_at,

                dd.toneladas_discarded,
                dd.notes

            FROM cycles cy
            LEFT JOIN digestors d ON cy.digestor_id = d.id
            LEFT JOIN trituration_cycles tc ON cy.trituration_id = tc.id
            LEFT JOIN cooking_cycles cc ON cy.cooking_id = cc.id
            LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
            WHERE cy.id = ?
        `;

        db.get(sql, [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: "Ciclo não encontrado" });
            res.json(row);
        });
    });

    /* =======================================================
       3) GERAR PDF PREMIUM COM CAPA + QR CODE
    ========================================================*/
    router.get("/pdf/view/:id", async (req, res) => {
        const id = req.params.id;

        const sql = `
            SELECT cy.*, d.nome as digestor_name,
                   tc.start_tritura_at, tc.end_tritura_at, tc.toneladas_trituradas, tc.materia_prima,
                   cc.start_cook_at, cc.end_cook_at,
                   dd.toneladas_discarded, dd.notes,
                   u.nome as operator_name
            FROM cycles cy
            LEFT JOIN digestors d ON cy.digestor_id = d.id
            LEFT JOIN trituration_cycles tc ON cy.trituration_id = tc.id
            LEFT JOIN cooking_cycles cc ON cy.cooking_id = cc.id
            LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
            LEFT JOIN users u ON cy.operator_id = u.id
            WHERE cy.id = ?
        `;

        db.get(sql, [id], async (err, ciclo) => {
            if (err) return res.status(500).send("Erro ao buscar dados");
            if (!ciclo) return res.status(404).send("Ciclo não encontrado");

            if (!gerarPDFCicloUtil)
                return res.status(500).send("PDF util não encontrado no servidor.");

            if (!fs.existsSync(REPORTS_DIR)) {
                fs.mkdirSync(REPORTS_DIR, { recursive: true });
            }

            const nomeArquivo = `ciclo_${id}_${Date.now()}.pdf`;
            const caminho = path.join(REPORTS_DIR, nomeArquivo);

            const dados = {
                id: ciclo.id,
                digestor: { 
                    id: ciclo.digestor_id, 
                    nome: ciclo.digestor_name 
                },
                tritura: { 
                    start: ciclo.start_tritura_at,
                    end: ciclo.end_tritura_at,
                    toneladas_trituradas: ciclo.toneladas_trituradas,
                    materia_prima: ciclo.materia_prima
                },
                cook: {
                    start: ciclo.start_cook_at,
                    end: ciclo.end_cook_at
                },
                discharge: {
                    toneladas_discarded: ciclo.toneladas_discarded,
                    notes: ciclo.notes
                },
                operador: { nome: ciclo.operator_name || "Operador" },
                started_at: ciclo.started_at,
                ended_at: ciclo.ended_at
            };

            try {
                await gerarPDFCicloUtil(dados, caminho);
                res.json({ url: `/reports/${nomeArquivo}` });
            } catch (e) {
                console.error(e);
                res.status(500).send("Falha ao gerar PDF");
            }
        });
    });

    /* =======================================================
       4) DOWNLOAD DIRETO DO PDF (alternativo)
    ========================================================*/
    router.get("/pdf/download/:id", async (req, res) => {
        const id = req.params.id;

        if (!gerarPDFCicloUtil)
            return res.status(500).send("PDF util ausente.");

        const arquivo = path.join(REPORTS_DIR, `ciclo_${id}.pdf`);

        if (!fs.existsSync(arquivo))
            return res.status(404).send("PDF não encontrado.");

        return res.download(arquivo);
    });

    return router;
};
