const express = require("express");
const router = express.Router();

/**
 * ROTAS PREMIUM DOS DIGESTORES
 * - iniciar trituração
 * - finalizar trituração
 * - iniciar cozimento
 * - finalizar cozimento
 * - descarregar digestor
 *
 * Todas emitindo broadcastState() ao final.
 */
module.exports = (db, broadcastState) => {

    /* =============================================
       1) INICIAR TRITURAÇÃO
    ==============================================*/
    router.post("/trituracao/start", (req, res) => {
        const { digestor_id, toneladas_solicitadas, materia_prima } = req.body;

        if (!digestor_id || !toneladas_solicitadas)
            return res.status(400).json({ error: "Campos incompletos" });

        const now = new Date().toISOString();

        // 1. cria trituração
        db.run(
            `INSERT INTO trituration_cycles 
            (digestor_id, toneladas_solicitadas, materia_prima, start_tritura_at, status, operator_id)
            VALUES (?, ?, ?, ?, 'started', ?)`,
            [digestor_id, toneladas_solicitadas, materia_prima || null, now, req.user.id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });

                const tritID = this.lastID;

                // 2. cria ciclo principal
                db.run(
                    `INSERT INTO cycles (digestor_id, trituration_id, materia_prima, started_at, status)
                     VALUES (?, ?, ?, ?, 'in_progress')`,
                    [digestor_id, tritID, materia_prima || null, now],
                    () => {
                        broadcastState();
                        res.json({ trituration_id: tritID });
                    }
                );
            }
        );
    });

    /* =============================================
       2) FINALIZAR TRITURAÇÃO
    ==============================================*/
    router.post("/trituracao/finish", (req, res) => {
        const { trituration_id, toneladas_trituradas } = req.body;

        if (!trituration_id)
            return res.status(400).json({ error: "ID da trituração ausente" });

        const now = new Date().toISOString();

        db.run(
            `UPDATE trituration_cycles
             SET end_tritura_at=?, toneladas_trituradas=?, status='finished'
             WHERE id=?`,
            [now, toneladas_trituradas || 0, trituration_id],
            err => {
                if (err) return res.status(500).json({ error: err.message });

                broadcastState();
                res.json({ ok: true });
            }
        );
    });

    /* =============================================
       3) INICIAR COZIMENTO
    ==============================================*/
    router.post("/cooking/start", (req, res) => {
        const { digestor_id, trituration_id } = req.body;

        if (!digestor_id || !trituration_id)
            return res.status(400).json({ error: "Dados incompletos" });

        const now = new Date().toISOString();

        db.run(
            `INSERT INTO cooking_cycles (digestor_id, trituration_id, start_cook_at, status, operator_id)
             VALUES (?, ?, ?, 'started', ?)`,
            [digestor_id, trituration_id, now, req.user.id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });

                const cookingID = this.lastID;

                // vincula ao ciclo ativo
                db.run(
                    "UPDATE cycles SET cooking_id=? WHERE trituration_id=? AND status='in_progress'",
                    [cookingID, trituration_id],
                    () => {
                        broadcastState();
                        res.json({ cooking_id: cookingID });
                    }
                );
            }
        );
    });

    /* =============================================
       4) FINALIZAR COZIMENTO
    ==============================================*/
    router.post("/cooking/finish", (req, res) => {
        const { cooking_id } = req.body;

        if (!cooking_id)
            return res.status(400).json({ error: "cooking_id ausente" });

        const now = new Date().toISOString();

        db.run(
            `UPDATE cooking_cycles
             SET end_cook_at=?, status='finished'
             WHERE id=?`,
            [now, cooking_id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });

                // encerra ciclo
                db.get(
                    `SELECT * FROM cycles 
                     WHERE cooking_id=? OR trituration_id=(SELECT trituration_id FROM cooking_cycles WHERE id=?)`,
                    [cooking_id, cooking_id],
                    (err2, cyc) => {
                        if (!cyc) {
                            broadcastState();
                            return res.json({ ok: true });
                        }

                        db.run(
                            `UPDATE cycles SET ended_at=?, status='finished' WHERE id=?`,
                            [now, cyc.id],
                            () => {
                                broadcastState();
                                res.json({ ok: true });
                            }
                        );
                    }
                );
            }
        );
    });

    /* =============================================
       5) DESCARREGAR DIGESTOR
    ==============================================*/
    router.post("/digestor/discharge", (req, res) => {
        const { digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, notes } = req.body;

        if (!digestor_id)
            return res.status(400).json({ error: "digestor_id obrigatório" });

        db.run(
            `INSERT INTO digestor_discharges 
            (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                digestor_id,
                trituration_cycle_id || null,
                cooking_cycle_id || null,
                toneladas_discarded || 0,
                req.user.id,
                notes || null
            ],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });

                // retorna digestor ao IDLE
                db.run(
                    "UPDATE digestors SET status='idle' WHERE id=?",
                    [digestor_id],
                    () => {
                        broadcastState();
                        res.json({ discharge_id: this.lastID });
                    }
                );
            }
        );
    });

    return router;
};
