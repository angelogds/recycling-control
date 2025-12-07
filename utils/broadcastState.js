const sqlite3 = require("sqlite3").verbose();

/**
 * broadcastState(db, io)
 * Envia o estado atualizado para todos os sockets conectados
 */
module.exports = function broadcastState(db, io) {

    // -------- DIGESTORES --------
    db.all(
        "SELECT * FROM digestors ORDER BY id",
        [],
        (err, digestores) => {
            if (err || !digestores) {
                io.emit("digestors:update", []);
                return;
            }

            const tasks = digestores.map(d =>
                new Promise(resolve => {
                    db.get(
                        "SELECT * FROM trituration_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1",
                        [d.id],
                        (_, trit) => {

                            db.get(
                                "SELECT * FROM cooking_cycles WHERE digestor_id=? AND status IN ('created','started') ORDER BY id DESC LIMIT 1",
                                [d.id],
                                (_, cook) => {

                                    db.get(
                                        "SELECT * FROM cycles WHERE digestor_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1",
                                        [d.id],
                                        (_, cycle) => {

                                            resolve({
                                                ...d,
                                                current_tritura: trit || null,
                                                current_cook: cook || null,
                                                current_cycle: cycle || null
                                            });
                                        }
                                    );
                                }
                            );
                        }
                    );
                })
            );

            Promise.all(tasks).then(list => {
                io.emit("digestors:update", list);
            });
        }
    );

    // -------- TOVAS --------
    db.all(
        "SELECT * FROM tovas ORDER BY id",
        [],
        (_, rows) => {
            io.emit("tovas:update", rows || []);
        }
    );

    // -------- ENTRADAS PENDENTES --------
    db.all(
        `SELECT id, truck_plate, toneladas_declared, arrival_at, status
         FROM entries 
         WHERE status != 'reception_finished'
         ORDER BY arrival_at DESC 
         LIMIT 50`,
        [],
        (_, rows) => {
            io.emit("entries:update", rows || []);
        }
    );
};
