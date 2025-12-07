// ==========================================================
// operador.js — versão PRO com:
// • Cronômetros RT
// • Botões opacos / ativos
// • Matéria-prima (osso/barrigada)
// • Integração total com server_digestores.js
// ==========================================================

const socket = io();
let digestores = [];

// ===============================
// Util — formatar tempo
// ===============================
function formatDuration(ms) {
    if (!ms || ms < 0) return "00:00:00";
    const total = Math.floor(ms / 1000);
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
}

function now() { return new Date().getTime(); }

// ===============================
// Render principal
// ===============================
socket.on("digestors:update", data => {
    digestores = data;
    renderPainel();
});

// ===============================
// Render painel de digestores
// ===============================
function renderPainel() {
    const grid = document.getElementById("digestorGrid");
    if (!grid) return;

    grid.innerHTML = "";

    digestores.forEach(d => {
        const card = document.createElement("div");
        card.className = "digestor-card";

        // status PT-BR + cor
        let statusTxt = "Parado";
        let statusColor = "red";

        if (d.status === "operating") {
            statusTxt = "Em Trituração";
            statusColor = "green";
        } else if (d.status === "cooking") {
            statusTxt = "Em Cozimento";
            statusColor = "green";
        } else if (d.status === "waiting_discharge") {
            statusTxt = "Aguardando Descarregar";
            statusColor = "orange";
        }

        // cronômetros
        const trit = d.current_tritura;
        const cook = d.current_cooking;
        const cyc = d.current_cycle;

        let tempoTrit = "00:00:00";
        let tempoCook = "00:00:00";

        const nowMs = now();

        // TRITURAÇÃO — se está rolando
        if (trit) {
            const start = trit.start_tritura_at ? new Date(trit.start_tritura_at).getTime() : null;
            const end = trit.end_tritura_at ? new Date(trit.end_tritura_at).getTime() : null;

            if (start && !end) tempoTrit = formatDuration(nowMs - start);
            if (start && end) tempoTrit = formatDuration(end - start);
        }

        // COZIMENTO — se está rolando
        if (cook) {
            const start = cook.start_cook_at ? new Date(cook.start_cook_at).getTime() : null;
            const end = cook.end_cook_at ? new Date(cook.end_cook_at).getTime() : null;

            if (start && !end) tempoCook = formatDuration(nowMs - start);
            if (start && end) tempoCook = formatDuration(end - start);
        }

        // BOTÕES — fluxo
        const canStartTrit = !trit && statusTxt === "Parado";
        const canFinishTrit = trit && trit.status === "started" && !trit.end_tritura_at;

        const canFinishCook = cook && cook.status === "started" && !cook.end_cook_at;

        const canDischarge = d.status === "waiting_discharge";

        // CARD HTML
        card.innerHTML = `
            <div class="dg-header">
                <h3>${d.nome}</h3>
                <span class="dg-status" style="color:${statusColor}">${statusTxt}</span>
            </div>

            <div class="dg-row">
                <strong>Trituração:</strong> 
                <span>${tempoTrit}</span>
            </div>

            <div class="dg-row">
                <strong>Cozimento:</strong> 
                <span>${tempoCook}</span>
            </div>

            <div class="dg-row materia-select">
                <label>Matéria-prima:</label>
                <button class="mat-btn" data-mp="osso">🦴 Osso</button>
                <button class="mat-btn" data-mp="barrigada">🐖 Barrigada</button>
            </div>

            <div class="dg-actions">
                <button class="btn-start ${canStartTrit ? "active" : "disabled"}" data-id="${d.id}">
                    Iniciar Trituração
                </button>

                <button class="btn-finish-trit ${canFinishTrit ? "active" : "disabled"}" data-trit-id="${trit?.id || ""}">
                    Finalizar Trituração
                </button>

                <button class="btn-finish-cook ${canFinishCook ? "active" : "disabled"}" data-cook-id="${cook?.id || ""}">
                    Finalizar Cozimento
                </button>

                <button class="btn-discharge ${canDischarge ? "active" : "disabled"}" data-id="${d.id}" data-cook-id="${cook?.id || ""}">
                    Descarregar
                </button>
            </div>
        `;

        grid.appendChild(card);
    });

    attachEvents();
}

// ===============================
// Trata clique dos botões
// ===============================
function attachEvents() {
    // seleção de matéria-prima
    document.querySelectorAll(".mat-btn").forEach(btn => {
        btn.onclick = () => {
            const parent = btn.closest(".materia-select");
            parent.dataset.selected = btn.dataset.mp;
            parent.querySelectorAll(".mat-btn").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
        };
    });

    // iniciar trituração
    document.querySelectorAll(".btn-start.active").forEach(btn => {
        btn.onclick = async () => {
            const digestor_id = btn.dataset.id;
            const mp = btn.closest(".digestor-card").querySelector(".materia-select").dataset.selected;

            if (!mp) return alert("Selecione a matéria-prima (osso/barrigada).");

            await fetch("/api/trituracao/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    digestor_id,
                    from_tova_id: 1,     // fixo por enquanto — me diga se quer escolher
                    toneladas_solicitadas: 0,
                    materia_prima: mp
                })
            });

            btn.classList.remove("active");
        };
    });

    // finalizar trituração
    document.querySelectorAll(".btn-finish-trit.active").forEach(btn => {
        btn.onclick = async () => {
            const trit_id = btn.dataset.tritId;

            await fetch("/api/trituracao/finish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    trituration_id: trit_id,
                    toneladas_trituradas: 0
                })
            });
        };
    });

    // finalizar cozimento
    document.querySelectorAll(".btn-finish-cook.active").forEach(btn => {
        btn.onclick = async () => {
            const cook_id = btn.dataset.cookId;

            await fetch("/api/cooking/finish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cooking_id: cook_id })
            });
        };
    });

    // descarregar
    document.querySelectorAll(".btn-discharge.active").forEach(btn => {
        btn.onclick = async () => {
            const digestor_id = btn.dataset.id;
            const cook_id = btn.dataset.cookId;

            await fetch("/api/digestor/discharge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    digestor_id,
                    cooking_cycle_id: cook_id,
                    toneladas_discarded: 0,
                    notes: ""
                })
            });
        };
    });
}

// ===============================
// Timer looping a cada 1 segundo
// ===============================
setInterval(() => renderPainel(), 1000);
