const socket = io();
let modalStart = null;

document.addEventListener("DOMContentLoaded", () => {
    modalStart = new bootstrap.Modal(document.getElementById("modalStartCarga"));
    loadInitial();
});

socket.on("digestors:update", (data) => renderDigestors(data));

// ===============================
// LOG
// ===============================
function addLog(msg) {
    const el = document.getElementById("logContent");
    el.innerHTML = `<div>${new Date().toLocaleString()} → ${msg}</div>` + el.innerHTML;
}

// ===============================
// INICIALIZA
// ===============================
async function loadInitial() {
    const d = await fetch('/api/digestors').then(r => r.json());
    renderDigestors(d);
}

// ===============================
// RENDERIZA OS DIGESTORES
// ===============================
function renderDigestors(list) {
    const grid = document.getElementById("digestorGrid");
    grid.innerHTML = "";

    list.forEach(d => {
        const col = document.createElement("div");
        col.className = "col-md-6";

        col.innerHTML = `
        <div class="card card-premium p-3">
            <h3 class="title-premium">${d.nome}</h3>
            <p class="text-muted">Capacidade: ${d.capacidade_tn} tn</p>

            <div class="progress-premium mb-2">
                <div class="progress-premium-inner"></div>
            </div>

            <div class="small">
                <strong>Trituração:</strong> ${d.current_tritura ? "#" + d.current_tritura.id : "Nenhuma"}<br>
                <strong>Cozimento:</strong> ${d.current_cooking ? "#" + d.current_cooking.id : "Nenhuma"}<br>
                <strong>Ciclo:</strong> ${d.current_cycle ? "#" + d.current_cycle.id : "Nenhum"}
            </div>

            <div class="mt-3 d-flex flex-wrap gap-2">
                <button class="btn btn-premium btn-sm" onclick="openStartCarga(${d.id})">Iniciar Carregamento</button>
                <button class="btn btn-outline-premium btn-sm">Finalizar Trituração</button>
                <button class="btn btn-outline-premium btn-sm">Finalizar Cozimento</button>
                <button class="btn btn-warning btn-sm">Descarregar</button>
            </div>
        </div>`;

        grid.appendChild(col);
    });
}

// ===============================
// MODAL – INICIAR CARGA
// ===============================
async function openStartCarga(id) {
    document.getElementById("start_digestor_id").value = id;

    const tovas = await fetch('/api/tovas').then(r => r.json());
    const select = document.getElementById("select_tova");

    select.innerHTML = "";
    tovas.forEach(t => {
        select.innerHTML += `<option value="${t.id}">${t.nome} — ${t.current_tn}/${t.capacidade_tn} tn</option>`;
    });

    modalStart.show();
}

async function confirmStartCarga() {
    const digestor_id = document.getElementById("start_digestor_id").value;
    const tova_id = document.getElementById("select_tova").value;
    const ton = document.getElementById("ton_solicitadas").value;

    if (!ton || ton <= 0) return alert("Informe a tonelagem!");

    const res = await fetch("/api/trituracao/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            digestor_id,
            from_tova_id: tova_id,
            toneladas_solicitadas: ton
        })
    }).then(r => r.json());

    if (res.error) return alert(res.error);

    addLog(`Trituração iniciada no Digestor ${digestor_id}.`);

    modalStart.hide();
}
