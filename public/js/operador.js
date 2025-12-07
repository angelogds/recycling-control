// ============================================
// operador.js - Painel Premium do Operador
// ============================================

let digestoresState = {};
let timers = {};

const socket = io();

// -------------------------------
// Recebe atualizações do servidor
// -------------------------------
socket.on("digestors:update", (digestores) => {
    digestoresState = digestores;
    renderDigestores();
});

// -------------------------------
// Renderiza digestores dinamicamente
// -------------------------------
function renderDigestores() {
    const grid = document.getElementById("digestorGrid");
    grid.innerHTML = "";

    digestoresState.forEach(d => {
        const card = document.createElement("div");
        card.className = "digestor-box";

        card.innerHTML = `
            <div class="digestor-name">${d.nome}</div>
            <div>Status: <span class="status-${d.status}">${d.status}</span></div>

            <!-- Botões -->
            <div style="margin-top: 12px;">
                <button class="btn btn-blue btn-full" onclick="startTritura(${d.id})" ${d.status !== "idle" ? "disabled" : ""}>INICIAR TRITURAÇÃO</button>
                <button class="btn btn-green btn-full" onclick="finishTritura(${d.current_tritura?.id})" ${d.status !== "operating" ? "disabled" : ""}>FINALIZAR TRITURAÇÃO</button>
                <button class="btn btn-blue btn-full" onclick="finishCooking(${d.current_cooking?.id})" ${d.status !== "cooking" ? "disabled" : ""}>FINALIZAR COZIMENTO</button>
                <button class="btn btn-red btn-full" onclick="openDischarge(${d.id})" ${d.status !== "waiting_discharge" ? "disabled" : ""}>DESCARGA</button>
            </div>

            <div id="timer-${d.id}" class="digestor-timer"></div>
        `;

        grid.appendChild(card);

        startTimer(d);
    });
}

// -------------------------------
// Cronômetro inteligente
// -------------------------------
function startTimer(d) {
    const timerDiv = document.getElementById(`timer-${d.id}`);

    if (!timerDiv) return;

    let startTime = null;

    if (d.current_tritura && d.current_tritura.start_tritura_at) {
        startTime = new Date(d.current_tritura.start_tritura_at);
    }
    if (d.current_cooking && d.current_cooking.start_cook_at) {
        startTime = new Date(d.current_cooking.start_cook_at);
    }

    if (!startTime) {
        timerDiv.innerHTML = "";
        return;
    }

    clearInterval(timers[d.id]);

    timers[d.id] = setInterval(() => {
        const now = new Date();
        const diff = now - startTime;

        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);

        timerDiv.innerHTML = `<b>Tempo:</b> ${h}h ${m}m ${s}s`;
    }, 1000);
}

// -------------------------------
// API Calls
// -------------------------------
function startTritura(digestor_id) {
    const from_tova_id = prompt("ID da Tova origem?");
    if (!from_tova_id) return alert("Tova inválida.");

    fetch("/api/trituracao/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digestor_id, from_tova_id })
    });
}

function finishTritura(id) {
    fetch("/api/trituracao/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trituration_id: id })
    });
}

function finishCooking(id) {
    fetch("/api/cooking/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cooking_id: id })
    });
}

function openDischarge(digestor_id) {
    const toneladas = prompt("Toneladas descarregadas:");
    fetch("/api/digestor/discharge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digestor_id, toneladas_discarded: toneladas })
    });
}
