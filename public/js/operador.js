cat > public/js/operador.js << 'EOF'
/* conteúdo completo já fornecido na Parte 3 - cole aqui */
const socket = io();
let modalStart = null, modalFinishTritObj = null, modalFinishCookObj = null, modalDischargeObj = null;

document.addEventListener("DOMContentLoaded", () => {
    modalStart = new bootstrap.Modal(document.getElementById("modalStartCarga"));
    modalFinishTritObj = new bootstrap.Modal(document.getElementById("modalFinishTrit"));
    modalFinishCookObj = new bootstrap.Modal(document.getElementById("modalFinishCook"));
    modalDischargeObj = new bootstrap.Modal(document.getElementById("modalDischarge"));
    loadInitial();
});

socket.on("digestors:update", (data) => renderDigestors(data));

// LOG
function addLog(msg) {
    const el = document.getElementById("logContent");
    el.innerHTML = `<div>${new Date().toLocaleString()} → ${msg}</div>` + el.innerHTML;
}

// INITIAL
async function loadInitial() {
    const d = await fetch('/api/digestors').then(r => r.json());
    renderDigestors(d);
}

// RENDER
function renderDigestors(list) {
    const grid = document.getElementById("digestorGrid");
    grid.innerHTML = "";
    list.forEach(d => {
        const col = document.createElement("div");
        col.className = "col-md-6";
        const tritId = d.current_tritura ? d.current_tritura.id : null;
        const cookId = d.current_cooking ? d.current_cooking.id : null;
        col.innerHTML = `
        <div class="card card-premium p-3">
            <h3 class="title-premium">${d.nome}</h3>
            <p class="text-muted">Capacidade: ${d.capacidade_tn} tn</p>
            <div class="progress-premium mb-2"><div class="progress-premium-inner"></div></div>
            <div class="small mb-2">
                <strong>Trituração:</strong> ${tritId ? "#" + tritId : "Nenhuma"}<br>
                <strong>Cozimento:</strong> ${cookId ? "#" + cookId : "Nenhuma"}<br>
                <strong>Ciclo:</strong> ${d.current_cycle ? "#" + d.current_cycle.id : "Nenhum"}
            </div>
            <div class="mt-3 d-flex flex-wrap gap-2">
                <button class="btn btn-premium btn-sm" onclick="openStartCarga(${d.id})">Iniciar Carregamento</button>
                <button class="btn btn-outline-premium btn-sm" onclick="openFinishTrit(${tritId})" ${tritId? '':'disabled'}>Finalizar Trituração</button>
                <button class="btn btn-outline-premium btn-sm" onclick="openStartCook(${cookId})" ${cookId? '':'disabled'}>Iniciar Cozimento</button>
                <button class="btn btn-outline-premium btn-sm" onclick="openFinishCook(${cookId})" ${cookId? '':'disabled'}>Finalizar Cozimento</button>
                <button class="btn btn-warning btn-sm" onclick="openDischarge(${d.id}, ${tritId||'null'}, ${cookId||'null'})">Descarregar</button>
            </div>
        </div>`;
        grid.appendChild(col);
    });
}

/* ===== Iniciar carga (já) ===== */
async function openStartCarga(digestorId) {
    document.getElementById("start_digestor_id").value = digestorId;
    const tovas = await fetch('/api/tovas').then(r => r.json());
    const select = document.getElementById("select_tova");
    select.innerHTML = "";
    tovas.forEach(t => {
        select.innerHTML += `<option value="${t.id}">${t.nome} — ${t.current_tn}/${t.capacidade_tn} tn</option>`;
    });
    document.getElementById("ton_solicitadas").value = "";
    modalStart.show();
}
async function confirmStartCarga() {
    const digestor_id = document.getElementById("start_digestor_id").value;
    const tova_id = document.getElementById("select_tova").value;
    const toneladas = parseFloat(document.getElementById("ton_solicitadas").value);
    if (!toneladas || toneladas <= 0) { alert("Informe uma tonelagem válida"); return; }
    const resp = await fetch('/api/trituracao/start', {
        method: "POST",
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ digestor_id, from_tova_id: tova_id, toneladas_solicitadas: toneladas })
    }).then(r => r.json());
    if (resp.error) { alert(resp.error); return; }
    addLog(`Carregamento iniciado no digestor ${digestor_id} (trit ${resp.trituration_id})`);
    modalStart.hide();
}

/* ===== Finalizar trituração ===== */
function openFinishTrit(tritId) {
    if(!tritId){ alert("Nenhuma trituração ativa."); return; }
    document.getElementById("finish_trit_id").value = tritId;
    document.getElementById("ton_trituradas").value = "";
    modalFinishTritObj.show();
}
async function confirmFinishTrit() {
    const tritId = document.getElementById("finish_trit_id").value;
    const ton = parseFloat(document.getElementById("ton_trituradas").value);
    if (!ton || ton <= 0) { alert("Informe toneladas trituradas"); return; }
    const res = await fetch('/api/trituracao/finish', {
        method: "POST",
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ trituration_id: tritId, toneladas_trituradas: ton })
    }).then(r => r.json());
    if (res.error) { alert(res.error); return; }
    addLog(`Trituração #${tritId} finalizada. Cooking #${res.cooking_id}`);
    modalFinishTritObj.hide();
}

/* ===== Iniciar cozimento manual (opcional) ===== */
function openStartCook(cookId) {
    if(!cookId) { alert("Nenhum cozimento aguardando"); return; }
    fetch('/api/cooking/start', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ cooking_id: cookId })
    }).then(()=> {
        addLog(`Cozimento #${cookId} iniciado`);
    });
}

/* ===== Finalizar cozimento ===== */
function openFinishCook(cookId) {
    if(!cookId) { alert("Nenhum cozimento ativo"); return; }
    document.getElementById("finish_cook_id").value = cookId;
    document.getElementById("cook_notes").value = "";
    modalFinishCookObj.show();
}
async function confirmFinishCook() {
    const cookId = document.getElementById("finish_cook_id").value;
    const notes = document.getElementById("cook_notes").value || null;
    const res = await fetch('/api/cooking/finish', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ cooking_id: cookId })
    }).then(r => r.json());
    if (res.error) { alert(res.error); return; }
    addLog(`Cozimento #${cookId} finalizado`);
    modalFinishCookObj.hide();
}

/* ===== Descarregar digestor ===== */
function openDischarge(digestorId, tritId, cookId) {
    document.getElementById("discharge_digestor_id").value = digestorId;
    document.getElementById("discharge_trit_id").value = tritId || "";
    document.getElementById("discharge_cook_id").value = cookId || "";
    document.getElementById("ton_descarregadas").value = "";
    document.getElementById("discharge_notes").value = "";
    modalDischargeObj.show();
}
async function confirmDischarge() {
    const digestor_id = document.getElementById("discharge_digestor_id").value;
    const trit = document.getElementById("discharge_trit_id").value || null;
    const cook = document.getElementById("discharge_cook_id").value || null;
    const toneladas = parseFloat(document.getElementById("ton_descarregadas").value) || 0;
    const notes = document.getElementById("discharge_notes").value || null;
    const res = await fetch('/api/digestor/discharge', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
            digestor_id, trituration_cycle_id: trit || null, cooking_cycle_id: cook || null,
            toneladas_discarded: toneladas, notes
        })
    }).then(r => r.json());
    if (res.error) { alert(res.error); return; }
    addLog(`Digestor ${digestor_id} descarregado (discharge ${res.discharge_id || '-'})`);
    modalDischargeObj.hide();
}
EOF
