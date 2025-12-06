// public/js/operador.js
const socket = io();

// Atualiza digestores em tempo real
socket.on("digestors:update", (lista) => {
    atualizarTabela(lista);
});

// Atualiza log
function addLog(msg) {
    const log = document.getElementById("logText");
    log.innerText = msg;
}

// Atualiza tabela visualmente
function atualizarTabela(lista) {
    lista.forEach(d => {
        const bar = document.getElementById(`bar-${d.id}`);
        if (!bar) return;

        let pct = 0;
        let barClass = "idle";

        if (d.current_tritura) { pct = 40; barClass = "triturando"; }
        if (d.current_cooking) { pct = 75; barClass = "cozinhando"; }
        if (d.current_cycle) { pct = 100; barClass = "idle"; }

        bar.style.width = pct + "%";
        bar.className = "progress-bar " + barClass;
        bar.innerText = pct + "%";

        // altera pill status
        const cell = document.querySelector(`#row-${d.id} .status-pill`);
        if (cell) {
            if (barClass === "idle") cell.style.background = "#1e6d36";
            if (barClass === "triturando") cell.style.background = "#f39c12";
            if (barClass === "cozinhando") cell.style.background = "#d32f2f";
        }
    });
}

/* ------------------------------
   Abertura dos Modais
------------------------------ */

function openStartModal(digestor_id) {
    document.getElementById("start_digestor_id").value = digestor_id;
    new bootstrap.Modal(document.getElementById("modalIniciarTrituracao")).show();
}

function openFinishTrituracao(digestor_id) {
    document.getElementById("finish_digestor_id").value = digestor_id;
    new bootstrap.Modal(document.getElementById("modalFinalizarTrituracao")).show();
}

function openFinishCozimento(digestor_id) {
    document.getElementById("finish_cook_digestor_id").value = digestor_id;
    new bootstrap.Modal(document.getElementById("modalFinalizarCozimento")).show();
}

function openDischarge(digestor_id) {
    document.getElementById("discharge_digestor_id").value = digestor_id;
    new bootstrap.Modal(document.getElementById("modalDischargeDigestor")).show();
}

/* ------------------------------
   Ações via API
------------------------------ */

async function iniciarTrituracao() {
    const digestor_id = document.getElementById("start_digestor_id").value;
    const from_tova_id = document.getElementById("start_tova").value;
    const toneladas = document.getElementById("start_ton").value;

    const res = await fetch("/api/trituracao/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digestor_id, from_tova_id, toneladas_solicitadas: toneladas })
    });

    addLog("Trituração iniciada no digestor " + digestor_id);
    location.reload();
}

async function finalizarTrituracao() {
    const trituration_id = document.getElementById("finish_trit_id").value;
    const toneladas = document.getElementById("finish_ton").value;

    const res = await fetch("/api/trituracao/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trituration_id, toneladas_trituradas: toneladas })
    });

    addLog("Trituração finalizada.");
    location.reload();
}

async function finalizarCozimento() {
    const cooking_id = document.getElementById("finish_cook_id").value;

    const res = await fetch("/api/cooking/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cooking_id })
    });

    addLog("Cozimento finalizado.");
    location.reload();
}

async function descarregarDigestor() {
    const digestor_id = document.getElementById("discharge_digestor_id").value;
    const toneladas = document.getElementById("discharge_ton").value;
    const notes = document.getElementById("discharge_notes").value;

    const res = await fetch("/api/digestor/discharge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digestor_id, toneladas_discarded: toneladas, notes })
    });

    addLog("Digestor descarregado.");
    location.reload();
}
