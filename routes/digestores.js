const express = require("express");

module.exports = (db, broadcastState) => {
    const router = express.Router();

    /* ======================================================
       1) LISTAR DIGESTORES PARA API REALTIME
    ====================================================== */
    router.get("/api/list", (req, res) => {
        db.all(
            "SELECT id, nome, capacidade_tn, status FROM digestors ORDER BY id",
            [],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(rows || []);
            }
        );
    });

    /* ======================================================
       2) TRITURAÇÃO — INICIAR
    ====================================================== */
    router.post("/trituracao/start", (req, res) => {
        const { digestor_id, from_tova_id, toneladas_solicitadas, materia_prima } = req.body;

        if (!digestor_id || !from_tova_id || !toneladas_solicitadas) {
            return res.status(400).json({ error: "Dados incompletos" });
        }

        const now = new Date().toISOString();

        // 1) criar ciclo de trituração
        db.run(
            `INSERT INTO trituration_cycles 
             (digestor_id, from_tova_id, toneladas_solicitadas, start_tritura_at, status, operator_id)
             VALUES (?,?,?,?, 'started', ?)`,
            [digestor_id, from_tova_id, toneladas_solicitadas, now, req.user.id],
            function (err) {
                if (err) {
                    console.error("Erro ao iniciar trituração:", err);
                    return res.status(500).json({ error: err.message });
                }

                const tritId = this.lastID;

                // 2) criar ciclo principal
                db.run(
                    `INSERT INTO cycles
                     (digestor_id, trituration_id, materia_prima, started_at, status)
                     VALUES (?, ?, ?, ?, 'in_progress')`,
                    [digestor_id, tritId, materia_prima || null, now],
                    function (err2) {
                        if (err2) console.error("Erro criando cycle:", err2);

                        broadcastState();
                        res.json({
                            ok: true,
                            trituration_id: tritId,
                            cycle_id: this?.lastID
                        });
                    }
                );
            }
        );
    });

    /* ======================================================
       3) TRITURAÇÃO — FINALIZAR
    ====================================================== */
    router.post("/trituracao/finish", (req, res) => {
        const { trituration_id, toneladas_trituradas } = req.body;

        if (!trituration_id) {
            return res.status(400).json({ error: "trituration_id é obrigatório" });
        }

        const now = new Date().toISOString();

        db.run(
            `UPDATE trituration_cycles 
             SET end_tritura_at = ?, toneladas_trituradas = ?, status = 'finished'
             WHERE id = ?`,
            [now, toneladas_trituradas || 0, trituration_id],
            function (err) {
                if (err) {
                    console.error("Erro ao finalizar trituração:", err);
                    return res.status(500).json({ error: err.message });
                }

                broadcastState();
                res.json({ ok: true });
            }
        );
    });

    /* ======================================================
       4) COZIMENTO — INICIAR
    ====================================================== */
    router.post("/cozimento/start", (req, res) => {
        const { digestor_id, trituration_id } = req.body;

        if (!digestor_id || !trituration_id) {
            return res.status(400).json({ error: "Dados incompletos" });
        }

        const now = new Date().toISOString();

        db.run(
            `INSERT INTO cooking_cycles 
             (digestor_id, trituration_id, start_cook_at, status, operator_id)
             VALUES (?, ?, ?, 'started', ?)`,
            [digestor_id, trituration_id, now, req.user.id],
            function (err) {
                if (err) {
                    console.error("Erro ao iniciar cozimento:", err);
                    return res.status(500).json({ error: err.message });
                }

                const cookId = this.lastID;

                // vincula cooking ao ciclo
                db.run(
                    `UPDATE cycles 
                     SET cooking_id = ? 
                     WHERE trituration_id = ? AND status='in_progress'`,
                    [cookId, trituration_id],
                    () => {
                        broadcastState();
                        res.json({ ok: true, cooking_id: cookId });
                    }
                );
            }
        );
    });

    /* ======================================================
       5) COZIMENTO — FINALIZAR
    ====================================================== */
    router.post("/cozimento/finish", (req, res) => {
        const { cooking_id } = req.body;

        if (!cooking_id) return res.status(400).json({ error: "cooking_id obrigatório" });

        const now = new Date().toISOString();

        db.run(
            `UPDATE cooking_cycles 
             SET end_cook_at = ?, status = 'finished'
             WHERE id = ?`,
            [now, cooking_id],
            function (err) {
                if (err) {
                    console.error("Erro ao finalizar cozimento:", err);
                    return res.status(500).json({ error: err.message });
                }

                // Fechar ciclo principal
                db.get(
                    `SELECT * FROM cycles 
                     WHERE cooking_id = ? 
                        OR trituration_id = (SELECT trituration_id FROM cooking_cycles WHERE id = ?)`,
                    [cooking_id, cooking_id],
                    (err2, cyc) => {
                        if (cyc) {
                            db.run(
                                `UPDATE cycles SET ended_at = ?, status = 'finished' WHERE id = ?`,
                                [now, cyc.id],
                                () => {
                                    broadcastState();
                                    res.json({ ok: true });
                                }
                            );
                        } else {
                            broadcastState();
                            res.json({ ok: true });
                        }
                    }
                );
            }
        );
    });

    /* ======================================================
       6) DESCARREGAR DIGESTOR
    ====================================================== */
    router.post("/discharge", (req, res) => {
        const {
            digestor_id,
            trituration_cycle_id,
            cooking_cycle_id,
            toneladas_discarded,
            notes
        } = req.body;

        if (!digestor_id) {
            return res.status(400).json({ error: "digestor_id é obrigatório" });
        }

        db.run(
            `INSERT INTO digestor_discharges 
             (digestor_id, trituration_cycle_id, cooking_cycle_id, toneladas_discarded, operator_id, notes)
             VALUES (?,?,?,?,?,?)`,
            [
                digestor_id,
                trituration_cycle_id || null,
                cooking_cycle_id || null,
                toneladas_discarded || 0,
                req.user.id,
                notes || null
            ],
            function (err) {
                if (err) {
                    console.error("Erro ao descarregar digestor:", err);
                    return res.status(500).json({ error: err.message });
                }

                // digestor volta ao estado IDLE
                db.run(
                    "UPDATE digestors SET status='idle' WHERE id=?",
                    [digestor_id],
                    () => {
                        broadcastState();
                        res.json({ ok: true, discharge_id: this.lastID });
                    }
                );
            }
        );
    });

    return router;
};
