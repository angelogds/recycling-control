// =======================================
// OPERADOR — CONTROLE TOTAL DO DIGESTOR
// =======================================

const socket = io();

socket.on("digestors:update", (digestores) => {
    renderDigestores(digestores);
});

function renderDigestores(digestores) {
    const grid = document.getElementById("digestorGrid");

    grid.innerHTML = digestores.map(d => `
        <div class="digestor-card">
            <h2>${d.nome}</h2>
            <p class="digestor-status">Status: <b>${statusFormat(d.status)}</b></p>

            ${renderTimers(d)}

            <div class="actions">
                ${renderButtons(d)}
            </div>
        </div>
    `).join("");
}

function statusFormat(status) {
    switch (status) {
        case "idle": return "🟢 Livre";
        case "operating": return "🟡 Trituração";
        case "cooking": return "🔴 Cozimento";
        case "waiting_discharge": return "⚫ Aguardando Descarga";
    }
    return status;
}

// ============================
// Cronômetros Automáticos
// ============================

function renderTimers(d) {
    let html = "";

    if (d.current_tritura) {
        html += `<p>⏱ Trituração: <span data-trit="${d.current_tritura.start_tritura_at}"></span></p>`;
    }

    if (d.current_cooking) {
        html += `<p>🔥 Cozimento: <span data-cook="${d.current_cooking.start_cook_at}"></span></p>`;
    }

    return html;
}

setInterval(() => {
    document.querySelectorAll("[data-trit]").forEach(el => {
        el.innerText = formatTimer(el.dataset.trit);
    });
    document.querySelectorAll("[data-cook]").forEach(el => {
        el.innerText = formatTimer(el.dataset.cook);
    });
}, 1000);

function formatTimer(startTime) {
    const diff = Math.floor((Date.now() - new Date(startTime)) / 1000);
    const h = String(Math.floor(diff / 3600)).padStart(2, "0");
    const m = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
    const s = String(diff % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
}

// ============================
// Botões Inteligentes
// ============================

function renderButtons(d) {
    if (d.status === "idle") {
        return `<button class="btn btn-primary" onclick="startTrit(${d.id})">Iniciar Trituração</button>`;
    }

    if (d.status === "operating" && d.current_tritura) {
        return `<button class="btn btn-warning" onclick="finishTrit(${d.current_tritura.id})">Finalizar Trituração</button>`;
    }

    if (d.status === "cooking" && d.current_cooking) {
        return `<button class="btn btn-danger" onclick="finishCook(${d.current_cooking.id})">Finalizar Cozimento</button>`;
    }

    if (d.status === "waiting_discharge") {
        return `<button class="btn btn-success" onclick="finishDischarge(${d.id}, ${d.current_cooking.id})">Registrar Descarga</button>`;
    }

    return `<p class="text-muted">Aguardando...</p>`;
}

// ============================
// Chamadas API
// ============================

function startTrit(id) {
    const body = {
        digestor_id: id,
        from_tova_id: 1,
        toneladas_solicitadas: 8
    };

    fetch("/api/trituracao/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

function finishTrit(id) {
    fetch("/api/trituracao/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trituration_id: id })
    });
}

function finishCook(id) {
    fetch("/api/cooking/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cooking_id: id })
    });
}

function finishDischarge(digestor_id, cooking_cycle_id) {
    fetch("/api/digestor/discharge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digestor_id, cooking_cycle_id })
    });
}
