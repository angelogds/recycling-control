const express = require("express");

module.exports = (db) => {
    const router = express.Router();

    /* ======================================================
       1) LISTAR TODOS OS CICLOS PARA O HISTÓRICO
    ====================================================== */
    router.get("/api/all", (req, res) => {
        const sql = `
            SELECT 
                cy.id,
                cy.digestor_id,
                cy.started_at,
                cy.ended_at,
                cy.status,
                d.nome AS digestor_name
            FROM cycles cy
            LEFT JOIN digestors d ON cy.digestor_id = d.id
            ORDER BY cy.id DESC
            LIMIT 200
        `;

        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            return res.json(rows || []);
        });
    });

    /* ======================================================
       2) DETALHES COMPLETOS DE UM CICLO
    ====================================================== */
    router.get("/api/:id", (req, res) => {
        const id = req.params.id;

        const sql = `
            SELECT 
                cy.*,
                d.nome AS digestor_name,

                -- Trituração
                tc.start_tritura_at,
                tc.end_tritura_at,
                tc.toneladas_trituradas,
                tc.toneladas_solicitadas,

                -- Cozimento
                cc.start_cook_at,
                cc.end_cook_at,

                -- Descarregamento
                dd.toneladas_discarded,
                dd.notes,

                -- Operador
                u.nome AS operator_name

            FROM cycles cy
            LEFT JOIN digestors d ON cy.digestor_id = d.id
            LEFT JOIN trituration_cycles tc ON cy.trituration_id = tc.id
            LEFT JOIN cooking_cycles cc ON cy.cooking_id = cc.id
            LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
            LEFT JOIN users u ON cy.operator_id = u.id
            WHERE cy.id = ?
        `;

        db.get(sql, [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: "Ciclo não encontrado" });

            return res.json(row);
        });
    });

    /* ======================================================
       3) EXPORTAR CICLO PARA PDF (UTILIZADO PELO FRONT)
    ====================================================== */
    router.get("/api/pdf/:id", (req, res) => {
        if (!req.gerarPDFCicloUtil) {
            return res.status(500).json({ error: "PDF util não configurado" });
        }

        const id = req.params.id;

        const sql = `
            SELECT 
                cy.*,
                d.nome AS digestor_name,
                tc.start_tritura_at,
                tc.end_tritura_at,
                tc.toneladas_trituradas,
                cc.start_cook_at,
                cc.end_cook_at,
                dd.toneladas_discarded,
                dd.notes,
                u.nome AS operator_name

            FROM cycles cy
            LEFT JOIN digestors d ON cy.digestor_id = d.id
            LEFT JOIN trituration_cycles tc ON cy.trituration_id = tc.id
            LEFT JOIN cooking_cycles cc ON cy.cooking_id = cc.id
            LEFT JOIN digestor_discharges dd ON dd.cooking_cycle_id = cc.id
            LEFT JOIN users u ON cy.operator_id = u.id

            WHERE cy.id = ?
        `;

        db.get(sql, [id], async (err, ciclo) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!ciclo) return res.status(404).json({ error: "Ciclo não encontrado" });

            try {
                const fileName = `ciclo_${id}_${Date.now()}.pdf`;
                const filePath = `/app/public/reports/${fileName}`;

                const dados = {
                    id: ciclo.id,
                    digestor: {
                        id: ciclo.digestor_id,
                        nome: ciclo.digestor_name,
                    },
                    tritura: {
                        start: ciclo.start_tritura_at,
                        end: ciclo.end_tritura_at,
                        toneladas_trituradas: ciclo.toneladas_trituradas
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
                    ended_at: ciclo.ended_at,
                };

                await req.gerarPDFCicloUtil(dados, filePath);

                res.json({ url: `/reports/${fileName}` });
            } catch (e) {
                console.error("Erro PDF:", e);
                res.status(500).json({ error: "Falha ao gerar PDF" });
            }
        });
    });

    return router;
};
