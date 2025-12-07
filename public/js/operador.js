// ===============================================================
// operador.js — Painel Premium com cronômetros + status realtime
// ===============================================================

const socket = io();

// Guardar timers por digestor
const timers = {};

// Util para formatar tempo
function formatTime(ms) {
    if (!ms || ms < 0) return "00:00:00";
    let sec = Math.floor(ms / 1000);
    const h = String(Math.floor(sec / 3600)).padStart(2, "0");
    sec %= 3600;
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
}

// Atualiza o cronômetro na tela
function startTimer(digestorId, startTime, targetEl) {
    clearInterval(timers[digestorId]);
    timers[digestorId] = setInterval(() => {
        const now = Date.now();
        const elapsed = now - new Date(startTime).getTime();
        targetEl.textContent = formatTime(elapsed);
    }, 1000);
}

// ---------------------------------------------------------------
// Atualização em tempo real via socket
// ---------------------------------------------------------------
socket.on("digestors:update", digestores => {
    digestores.forEach(dg => {
        const card = document.querySelector(`#digestor-${dg.id}`);
        if (!card) return;

        // Status
        const statusEl = card.querySelector(".dg-status");

        if (dg.current_cooking?.status === "started") {
            statusEl.textContent = "Cozinhando";
            statusEl.className = "dg-status status-cozinhando";
        }
        else if (dg.current_tritura?.status === "started") {
            statusEl.textContent = "Em Trituração";
            statusEl.className = "dg-status status-operando";
        }
        else if (dg.current_cycle?.status === "in_progress") {
            statusEl.textContent = "Aguardando descarregar";
            statusEl.className = "dg-status status-descarregar";
        }
        else {
            statusEl.textContent = "Parado";
            statusEl.className = "dg-status status-parado";
        }

        // Cronômetros
        const tritTimer = card.querySelector(".timer-tritura");
        const cookTimer = card.querySelector(".timer-cook");

        // Trituração
        if (dg.current_tritura && dg.current_tritura.start_tritura_at && !dg.current_tritura.end_tritura_at) {
            startTimer(dg.id + "-trit", dg.current_tritura.start_tritura_at, tritTimer);
        } else {
            clearInterval(timers[dg.id + "-trit"]);
            tritTimer.textContent = dg.current_tritura?.end_tritura_at
                ? "Finalizada"
                : "--:--:--";
        }

        // Cozimento
        if (dg.current_cooking && dg.current_cooking.start_cook_at && !dg.current_cooking.end_cook_at) {
            startTimer(dg.id + "-cook", dg.current_cooking.start_cook_at, cookTimer);
        } else {
            clearInterval(timers[dg.id + "-cook"]);
            cookTimer.textContent = dg.current_cooking?.end_cook_at
                ? "Finalizado"
                : "--:--:--";
        }

        updateButtons(dg, card);
    });
});

// ---------------------------------------------------------------
// Controle de botões (ativo / opaco)
// ---------------------------------------------------------------
function updateButtons(dg, card) {
    const btnStart = card.querySelector(".btn-start");
    const btnFinishTrit = card.querySelector(".btn-finish-trit");
    const btnFinishCook = card.querySelector(".btn-finish-cook");
    const btnDischarge = card.querySelector(".btn-discharge");

    // Reset
    [btnStart, btnFinishTrit, btnFinishCook, btnDischarge].forEach(b => {
        b.classList.remove("active");
        b.classList.remove("disabled");
    });

    // Lógica
    if (!dg.current_tritura) {
        // trituração não começou → só START ativo
        btnStart.classList.add("active");
        btnFinishTrit.classList.add("disabled");
        btnFinishCook.classList.add("disabled");
        btnDischarge.classList.add("disabled");
    }
    else if (dg.current_tritura && !dg.current_tritura.end_tritura_at) {
        // trituração começou → finalizar trituração
        btnFinishTrit.classList.add("active");
        btnStart.classList.add("disabled");
        btnFinishCook.classList.add("disabled");
        btnDischarge.classList.add("disabled");
    }
    else if (dg.current_cooking && !dg.current_cooking.end_cook_at) {
        // cozimento ativo → finalizar cozimento
        btnFinishCook.classList.add("active");
        btnStart.classList.add("disabled");
        btnFinishTrit.classList.add("disabled");
        btnDischarge.classList.add("disabled");
    }
    else if (dg.current_cycle && dg.current_cycle.status === "in_progress") {
        // aguardando descarregar
        btnDischarge.classList.add("active");
        btnStart.classList.add("disabled");
        btnFinishTrit.classList.add("disabled");
        btnFinishCook.classList.add("disabled");
    }
    else {
        // ciclo finalizado → tudo desativado e o próximo ciclo começa limpo
        btnStart.classList.add("active");
    }
}

// ---------------------------------------------------------------
// Seleção de matéria-prima (osso / barrigada)
// ---------------------------------------------------------------
document.addEventListener("click", e => {
    if (!e.target.classList.contains("mat-btn")) return;
    const parent = e.target.closest(".materia-select");
    parent.querySelectorAll(".mat-btn").forEach(b => b.classList.remove("selected"));
    e.target.classList.add("selected");
});

// ---------------------------------------------------------------
// AÇÕES DO OPERADOR
// ---------------------------------------------------------------

// START Trituração
document.addEventListener("click", async e => {
    if (!e.target.classList.contains("btn-start")) return;

    const card = e.target.closest(".digestor-card");
    const id = card.dataset.id;

    // MP selecionada
    const mp = card.querySelector(".mat-btn.selected")?.dataset.mat || null;
    if (!mp) return alert("Selecione a matéria-prima: Osso ou Barrigada.");

    const tova = card.querySelector(".select-tova")?.value || 1;
    const ton = card.querySelector(".input-ton")?.value || 1;

    const resp = await fetch("/api/trituracao/start", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            digestor_id: id,
            from_tova_id: tova,
            toneladas_solicitadas: ton,
            materia_prima: mp
        })
    });

    const data = await resp.json();
    if (data.error) return alert(data.error);
});

// Finish Trituração
document.addEventListener("click", async e => {
    if (!e.target.classList.contains("btn-finish-trit")) return;

    const card = e.target.closest(".digestor-card");
    const id = card.dataset.id;
    const tritId = card.dataset.tritId;
    const tonReal = prompt("Toneladas trituradas:");

    const resp = await fetch("/api/trituracao/finish", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            trituration_id: tritId,
            toneladas_trituradas: tonReal
        })
    });

    const data = await resp.json();
    if (data.error) return alert(data.error);
});

// Finish Cozimento
document.addEventListener("click", async e => {
    if (!e.target.classList.contains("btn-finish-cook")) return;

    const card = e.target.closest(".digestor-card");
    const cookId = card.dataset.cookId;

    const resp = await fetch("/api/cooking/finish", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ cooking_id: cookId })
    });

    const data = await resp.json();
    if (data.error) return alert(data.error);
});

// Descarregar
document.addEventListener("click", async e => {
    if (!e.target.classList.contains("btn-discharge")) return;

    const card = e.target.closest(".digestor-card");
    const id = card.dataset.id;
    const cookId = card.dataset.cookId;

    const ton = prompt("Toneladas descarregadas:");
    const obs = prompt("Observações (opcional):");

    const resp = await fetch("/api/digestor/discharge", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            digestor_id: id,
            cooking_cycle_id: cookId,
            toneladas_discarded: ton,
            notes: obs
        })
    });

    const data = await resp.json();
    if (data.error) return alert(data.error);
});
