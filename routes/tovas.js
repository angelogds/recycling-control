const express = require("express");

module.exports = (db, broadcastState) => {
    const router = express.Router();

    /* ======================================================
       1) DASHBOARD DAS TOVAS
    ====================================================== */
    router.get("/", (req, res) => {
        const sql = `
            SELECT id, nome, capacidade_tn, current_tn
            FROM tovas
            ORDER BY id
        `;
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error("Erro ao carregar tovas:", err);
                return res.status(500).send("Erro ao carregar tovas.");
            }
            res.render("tovas_dashboard", {
                usuario: req.user,
                title: "Tovas",
                tovas: rows || []
            });
        });
    });

    /* ======================================================
       2) FORMULÁRIO DE EDIÇÃO
    ====================================================== */
    router.get("/:id/editar", (req, res) => {
        const id = req.params.id;

        db.get("SELECT * FROM tovas WHERE id = ?", [id], (err, row) => {
            if (err) {
                console.error("Erro ao buscar tova:", err);
                return res.status(500).send("Erro ao buscar tova.");
            }
            if (!row) return res.status(404).send("Tova não encontrada.");

            res.render("tovas_editar", {
                usuario: req.user,
                title: "Editar Tova",
                tova: row
            });
        });
    });

    /* ======================================================
       3) SALVAR ALTERAÇÃO DE TOVA
    ====================================================== */
    router.post("/:id/update", (req, res) => {
        const id = req.params.id;
        const { nome, capacidade_tn, current_tn } = req.body;

        if (!nome || !capacidade_tn) {
            return res.status(400).send("Nome e capacidade são obrigatórios.");
        }

        const sql = `
            UPDATE tovas 
            SET nome = ?, capacidade_tn = ?, current_tn = ?
            WHERE id = ?
        `;

        db.run(sql, [
            nome.trim(),
            parseFloat(capacidade_tn),
            parseFloat(current_tn || 0),
            id
        ], function (err) {
            if (err) {
                console.error("Erro ao atualizar tova:", err);
                return res.status(500).send("Erro ao atualizar tova.");
            }

            broadcastState();
            res.redirect("/tovas");
        });
    });

    /* ======================================================
       4) API JSON — todas as tovas (para realtime)
    ====================================================== */
    router.get("/api/list", (req, res) => {
        db.all("SELECT * FROM tovas ORDER BY id", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    return router;
};
