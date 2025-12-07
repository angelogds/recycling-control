const express = require("express");

module.exports = (db, broadcastState) => {
    const router = express.Router();

    /* ======================================================
       1) RENDERIZA O PAINEL DA PORTARIA
    ====================================================== */
    router.get("/", (req, res) => {
        res.render("portaria_painel", {
            usuario: req.user,
            title: "Controle de Portaria"
        });
    });

    /* ======================================================
       2) FORMULÁRIO PARA REGISTRAR CHEGADA
    ====================================================== */
    router.get("/chegada", (req, res) => {
        res.render("portaria_chegada_form", {
            usuario: req.user,
            title: "Registrar Chegada"
        });
    });

    /* ======================================================
       3) SALVA CHEGADA DE CAMINHÃO
    ====================================================== */
    router.post("/chegada", (req, res) => {
        const { placa, toneladas } = req.body;

        if (!placa || !toneladas) {
            return res.status(400).send("Placa e toneladas são obrigatórios.");
        }

        const sql = `
            INSERT INTO entries (truck_plate, toneladas_declared, portaria_user_id)
            VALUES (?, ?, ?)
        `;

        db.run(sql, [placa.trim().toUpperCase(), toneladas, req.user.id], function (err) {
            if (err) {
                console.error("Erro ao registrar chegada:", err);
                return res.status(500).send("Erro ao salvar chegada.");
            }

            broadcastState();
            res.redirect("/portaria");
        });
    });

    /* ======================================================
       4) LISTA TODAS AS ENTRADAS PENDENTES (JSON)
    ====================================================== */
    router.get("/api/pendentes", (req, res) => {
        const sql = `
            SELECT id, truck_plate, toneladas_declared, status, arrival_at
            FROM entries
            WHERE status != 'reception_finished'
            ORDER BY arrival_at DESC
        `;

        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error("Erro ao buscar entradas:", err);
                return res.json([]);
            }
            res.json(rows || []);
        });
    });

    /* ======================================================
       5) FINALIZA RECEPÇÃO NA PORTARIA
    ====================================================== */
    router.post("/finalizar", (req, res) => {
        const { entrada_id } = req.body;

        if (!entrada_id) 
            return res.status(400).json({ error: "entrada_id requerido" });

        const sql = `
            UPDATE entries 
            SET status = 'reception_finished'
            WHERE id = ?
        `;

        db.run(sql, [entrada_id], function (err) {
            if (err) {
                console.error("Erro ao finalizar recepção:", err);
                return res.status(500).json({ error: "DB error" });
            }

            broadcastState();
            res.json({ ok: true });
        });
    });

    return router;
};
