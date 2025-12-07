// -------------------------------------------------------------
//  operador.js – VERSÃO PREMIUM (Etapa A)
//  Usando APENAS MODAIS (sem prompt())
// -------------------------------------------------------------

(() => {
    const socket = io();
    const body = document.getElementById('digestoresTableBody');
    const logContent = document.getElementById('logContent');

    // -------------------------------
    // ESTADOS EM MEMÓRIA LOCAL
    // -------------------------------
    const stateCache = {};
    const timers = {};

    function log(msg) {
        const t = new Date().toLocaleTimeString();
        logContent.innerText = `[${t}] ${msg}\n` + logContent.innerText;
    }

    function formatDuration(ms) {
        if (!ms || ms < 0) return "--:--";
        const s = Math.floor(ms / 1000);
        const mm = Math.floor(s / 60);
        const ss = s % 60;
        return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
    }

    // ---------------------------------------------------------
    // RENDERIZAÇÃO PRINCIPAL
    // ---------------------------------------------------------
    function render(list) {
        body.innerHTML = "";

        list.forEach(d => {
            const materia = stateCache[d.id]?.materia_prima || "";

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${d.nome}</strong></td>

                <td>
                    <button class="btn btn-sm materia-btn ${materia==='osso'?'btn-primary':'btn-outline-secondary'}" data-mat="osso" data-did="${d.id}">Osso</button>
                    <button class="btn btn-sm materia-btn ${materia==='barrigada'?'btn-primary':'btn-outline-secondary'}" data-mat="barrigada" data-did="${d.id}">Barrigada</button>
                </td>

                <td>
                    <span id="status-${d.id}" class="status-pill">
                        ${translateStatus(d)}
                    </span>
                </td>

                <td>
                    Trit.: <span id="trit-time-${d.id}">--:--</span><br>
                    Coz.: <span id="cook-time-${d.id}">--:--</span>
                </td>

                <td>
                    <small>Trit total: <span id="trit-total-${d.id}">—</span></small><br>
                    <small>Coz total: <span id="cook-total-${d.id}">—</span></small>
                </td>

                <td class="text-end">
                    <button class="btn btn-op btn-tritura btn-start" data-id="${d.id}">Iniciar</button>
                    <button class="btn btn-op btn-finish-trit disabled" data-id="${d.id}">Finalizar Tritura</button>
                    <button class="btn btn-op btn-finish-cook disabled" data-id="${d.id}">Finalizar Cozimento</button>
                    <button class="btn btn-op btn-discharge-op disabled" data-id="${d.id}">Descarregar</button>
                </td>
            `;

            body.appendChild(tr);

            applyState(d);
            bindMateriaButtons(d);
            bindActionButtons(d);
        });
    }

    function translateStatus(d) {
        if (d.current_cooking) return "EM COZIMENTO";
        if (d.current_tritura) return "EM TRITURAÇÃO";
        if (d.current_cycle) return "EM OPERAÇÃO";
        return "PARADO";
    }

    // ---------------------------------------------------------
    // INTERFACE → HABILITA/DESABILITA BOTÕES
    // ---------------------------------------------------------
    function applyState(d) {
        const id = d.id;

        const btnStart = document.querySelector(`.btn-start[data-id="${id}"]`);
        const btnFT = document.querySelector(`.btn-finish-trit[data-id="${id}"]`);
        const btnFC = document.querySelector(`.btn-finish-cook[data-id="${id}"]`);
        const btnDis = document.querySelector(`.btn-discharge-op[data-id="${id}"]`);

        [btnStart, btnFT, btnFC, btnDis].forEach(b => b?.classList.add('disabled'));

        if (d.current_tritura && !d.current_cooking) {
            btnFT.classList.remove("disabled");
        } else if (d.current_cooking) {
            btnFC.classList.remove("disabled");
        } else if (!d.current_cycle) {
            btnStart.classList.remove("disabled");
        }
    }

    // ---------------------------------------------------------
    // SELEÇÃO DE MATÉRIA-PRIMA
    // ---------------------------------------------------------
    function bindMateriaButtons(d) {
        const id = d.id;
        document.querySelectorAll(`.materia-btn[data-did="${id}"]`).forEach(btn => {
            btn.onclick = () => {
                const mat = btn.dataset.mat;
                stateCache[id] = stateCache[id] || {};
                stateCache[id].materia_prima = mat;

                document
                    .querySelectorAll(`.materia-btn[data-did="${id}"]`)
                    .forEach(b => {
                        b.classList.remove("btn-primary");
                        b.classList.add("btn-outline-secondary");
                    });

                btn.classList.remove("btn-outline-secondary");
                btn.classList.add("btn-primary");

                log(`Digestor ${id}: Matéria-prima selecionada → ${mat}`);
            };
        });
    }

    // ---------------------------------------------------------
    // AÇÕES → AGORA ABREM MODAIS
    // ---------------------------------------------------------
    function bindActionButtons(d) {
        const id = d.id;

        // -------- INICIAR TRITURAÇÃO (abre modal) -------------
        document.querySelector(`.btn-start[data-id="${id}"]`).onclick = () => {
            if (document.querySelector(`.btn-start[data-id="${id}"]`).classList.contains("disabled"))
                return;

            if (!stateCache[id]?.materia_prima) {
                alert("Selecione a matéria-prima antes de iniciar.");
                return;
            }

            openModalStart(id);
        };

        // -------- FINALIZAR TRITURAÇÃO (abre modal) ------------
        document.querySelector(`.btn-finish-trit[data-id="${id}"]`).onclick = () => {
            if (!stateCache[id]?.last_trit_id) {
                alert("Não foi possível localizar a trituração.");
                return;
            }
            openModalFinishTrit(id);
        };

        // -------- FINALIZAR COZIMENTO (abre modal) -------------
        document.querySelector(`.btn-finish-cook[data-id="${id}"]`).onclick = () => {
            if (!stateCache[id]?.last_cook_id) {
                alert("Cozimento não localizado.");
                return;
            }
            openModalFinishCook(id);
        };

        // -------- DESCARREGAR (abre modal) ---------------------
        document.querySelector(`.btn-discharge-op[data-id="${id}"]`).onclick = () => {
            if (!stateCache[id]?.last_cook_id) {
                alert("Não há cozimento finalizado para descarregar.");
                return;
            }
            openModalDischarge(id);
        };
    }

    // =========================================================
    // ------------------------ MODAIS --------------------------
    // =========================================================

    // ---------------------- MODAL 1: INICIAR ------------------
    function openModalStart(id) {
        const modal = new bootstrap.Modal(document.getElementById("modalIniciarTritura"));
        document.getElementById("modal_iniciar_btn").onclick = () => doStart(id);
        modal.show();
    }

    async function doStart(id) {
        const toneladas = document.getElementById("modal_ton").value || 0;
        const tova = document.getElementById("modal_tova").value;
        const mat = stateCache[id]?.materia_prima;

        if (!mat) {
            alert("Selecione matéria-prima antes.");
            return;
        }

        log(`Iniciando Trituração do digestor ${id}...`);

        const res = await fetch("/api/trituracao/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                digestor_id: id,
                from_tova_id: tova,
                toneladas_solicitadas: toneladas
            })
        });

        const data = await res.json();
        if (!res.ok) return alert("Erro: " + data.error);

        stateCache[id].last_trit_id = data.trituration_id;
        log(`Digestor ${id}: Trituração iniciada (ID ${data.trituration_id})`);

        socket.emit("ping");
        bootstrap.Modal.getInstance(document.getElementById("modalIniciarTritura")).hide();
    }

    // ---------------------- MODAL 2: FINALIZAR TRITURAÇÃO -----
    function openModalFinishTrit(id) {
        const modal = new bootstrap.Modal(document.getElementById("modalFinalizarTritura"));
        document.getElementById("modal_finish_trit_btn").onclick = () => doFinishTrit(id);
        modal.show();
    }

    async function doFinishTrit(id) {
        const tons = document.getElementById("modal_trit_tons").value;
        const tritId = stateCache[id].last_trit_id;

        const res = await fetch("/api/trituracao/finish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                trituration_id: tritId,
                toneladas_trituradas: tons || 0
            })
        });

        if (!res.ok) {
            const data = await res.json();
            return alert("Erro: " + data.error);
        }

        log(`Digestor ${id}: Trituração finalizada. Iniciando cozimento...`);

        // iniciar cozimento automaticamente
        const cookRes = await fetch("/api/cooking/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                digestor_id: id,
                trituration_id: tritId
            })
        });

        const cookJson = await cookRes.json();
        stateCache[id].last_cook_id = cookJson.cooking_id;

        log(`Digestor ${id}: Cozimento iniciado (ID ${cookJson.cooking_id})`);

        socket.emit("ping");
        bootstrap.Modal.getInstance(document.getElementById("modalFinalizarTritura")).hide();
    }

    // ---------------------- MODAL 3: FINALIZAR COZIMENTO ------
    function openModalFinishCook(id) {
        const modal = new bootstrap.Modal(document.getElementById("modalFinalizarCozimento"));
        document.getElementById("modal_finish_cook_btn").onclick = () => doFinishCook(id);
        modal.show();
    }

    async function doFinishCook(id) {
        const cookId = stateCache[id].last_cook_id;

        const res = await fetch("/api/cooking/finish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cooking_id: cookId })
        });

        if (!res.ok) return alert("Erro ao finalizar cozinhar");

        log(`Digestor ${id}: Cozimento finalizado.`);
        socket.emit("ping");

        bootstrap.Modal.getInstance(document.getElementById("modalFinalizarCozimento")).hide();
    }

    // ---------------------- MODAL 4: DESCARREGAR --------------
    function openModalDischarge(id) {
        const modal = new bootstrap.Modal(document.getElementById("modalDischarge"));
        document.getElementById("modal_do_discharge_btn").onclick = () => doDischarge(id);
        modal.show();
    }

    async function doDischarge(id) {
        const tons = document.getElementById("modal_dis_tons").value;
        const notes = document.getElementById("modal_dis_notes").value;
        const tritId = stateCache[id].last_trit_id;
        const cookId = stateCache[id].last_cook_id;

        const res = await fetch("/api/digestor/discharge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
    digestor_id: id,
    from_tova_id: tova,
    toneladas_solicitadas: toneladas,
    materia_prima: mat  // << NEW
})
           
        if (!res.ok) return alert("Erro ao descarregar");

        log(`Digestor ${id}: Descarregado com sucesso.`);
        delete stateCache[id];

        socket.emit("ping");

        bootstrap.Modal.getInstance(document.getElementById("modalDischarge")).hide();
    }

    // =========================================================
    // ------------------- SOCKET REALTIME ---------------------
    // =========================================================
    socket.on("digestors:update", list => {
        render(list);
        startTimers(list);
    });

    socket.on("connect", () => {
        log("Socket conectado");
        socket.emit("ping");
    });

    // =========================================================
    // ---------------------- TIMERS ---------------------------
    // =========================================================
    function startTimers(list) {
        Object.values(timers).forEach(t => clearInterval(t));

        list.forEach(d => {
            const id = d.id;

            timers[id] = setInterval(async () => {
                const res = await fetch("/api/digestors");
                const all = await res.json();
                const dd = all.find(x => x.id === id);
                if (!dd) return;

                // TRITURAÇÃO
                if (dd.current_tritura && !dd.current_tritura.end_tritura_at) {
                    const t0 = new Date(dd.current_tritura.start_tritura_at).getTime();
                    document.getElementById(`trit-time-${id}`).innerText =
                        formatDuration(Date.now() - t0);
                }

                // COZIMENTO
                if (dd.current_cooking && !dd.current_cooking.end_cook_at) {
                    const t0 = new Date(dd.current_cooking.start_cook_at).getTime();
                    document.getElementById(`cook-time-${id}`).innerText =
                        formatDuration(Date.now() - t0);
                }

                applyState(dd);
            }, 1000);
        });
    }

    // Carga inicial
    fetch("/api/digestors")
        .then(r => r.json())
        .then(list => {
            render(list);
            startTimers(list);
        });

})();
