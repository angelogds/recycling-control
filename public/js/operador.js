const socket = io();

/* -------------------------
   Renderiza digestores no painel
------------------------- */
socket.on("digestors:update", (list) => renderDigestors(list));

async function loadInitial() {
    const list = await fetch('/api/digestors').then(r => r.json());
    renderDigestors(list);
}
loadInitial();

/* -------------------------
   Renderização
------------------------- */
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

                <span class="badge badge-status mb-2">${d.status.toUpperCase()}</span>

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

/* -------------------------
   Log
------------------------- */
function addLog(msg) {
    const el = document.getElementById("logContent");
    el.innerHTML = `<div>${new Date().toLocaleString()} → ${msg}</div>` + el.innerHTML;
}
