/* ===================================================================
   OPERADOR PAINEL - JavaScript Premium
=================================================================== */

const socket = io();

/* ===================================================================
   Atualiza os digestores em tempo real
=================================================================== */
socket.on("digestors:update", (list) => renderDigestors(list));
socket.on("tovas:update", (list) => fillTovaSelect(list));

function addLog(msg) {
    const el = document.getElementById("logContent");
    const time = new Date().toLocaleString();
    el.innerHTML = `<div>${time} → ${msg}</div>` + el.innerHTML;
}

/* ===================================================================
   Renderizar Digestores
=================================================================== */
function renderDigestors(list) {
    const grid = document.getElementById("digestorGrid");
    grid.innerHTML = "";

    list.forEach(d => {
        const col = document.createElement("div");
        col.className = "col-md-6";

        col.innerHTML = `
            <div class="card card-premium p-3">
                <h4 class="title-premium">${d.nome}</h4>
                <p class="text-muted mb-1">Capacidade: ${d.capacidade_tn} tn</p>

                <div class="status-bar mb-2">
                    <div class="status-fill ${d.status.toLowerCase()}">${d.status.toUpperCase()}</div>
                </div>

                <div class="small mb-2">
                    <strong>Trituração:</strong> ${d.current_tritura ? "#" + d.current_tritura.id : "Nenhuma"}<br>
                    <strong>Cozimento:</strong> ${d.current_cooking ? "#" + d.current_cooking.id : "Nenhuma"}<br>
                    <strong>Ciclo:</strong> ${d.current_cycle ? "#" + d.current_cycle.id : "Nenhum"}
                </div>

                <div class="mt-3 d-flex flex-wrap gap-2">
                    <button class="btn btn-premium btn-sm" onclick="openStartCarga(${d.id})">Iniciar Carregamento</button>
                    <button class="btn btn-outline-premium btn-sm" onclick="openFinishTrit(${d.id}, ${d.current_tritura ? d.current_tritura.id : 'null'})">Finalizar Trituração</button>
                    <button class="btn btn-outline-premium btn-sm" onclick="openFinishCook(${d.id}, ${d.current_cooking ? d.current_cooking.id : 'null'})">Finalizar Cozimento</button>
                    <button class="btn btn-warning btn-sm" onclick="openDischarge(${d.id}, ${d.current_tritura ? d.current_tritura.id : 'null'}, ${d.current_cooking ? d.current_cooking.id : 'null'})">Descarregar</button>
                </div>
            </div>
        `;

        grid.appendChild(col);
    });
}

/* ===================================================================
   Funções para abrir os modais
=================================================================== */
function openStartCarga(digestorId) {
    document.getElementById("start_digestor_id").value = digestorId;
    const modal = new bootstrap.Modal(document.getElementById("modalStartCarga"));
    modal.show();
}

function openFinishTrit(digestorId, tritId) {
    if (!tritId) return alert("Nenhuma trituração ativa!");

    document.getElementById("finish_trit_id").value = tritId;
    const modal = new bootstrap.Modal(document.getElementById("modalFinishTrit"));
    modal.show();
}

function openFinishCook(digestorId, cookId) {
    if (!cookId) return alert("Nenhum cozimento ativo!");

    document.getElementById("finish_cook_id").value = cookId;
    const modal = new bootstrap.Modal(document.getElementById("modalFinishCook"));
    modal.show();
}

function openDischarge(digestorId, tritId, cookId) {
    document.getElementById("disc_digestor_id").value = digestorId;
    document.getElementById("disc_trit_id").value = tritId;
    document.getElementById("disc_cook_id").value = cookId;

    const modal = new bootstrap.Modal(document.getElementById("modalDischarge"));
    modal.show();
}

/* ===================================================================
   Enviar ações para API
=================================================================== */
async function confirmStartCarga() {
    const digestor_id = document.getElementById("start_digestor_id").value;
    const from_tova_id = document.getElementById("start_from_tova").value;
    const toneladas_solicitadas = document.getElementById("start_toneladas").value;

    const res = await fetch("/api/trituracao/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.st
