/* ============================================================
   operador.js — Lógica Premium do Painel do Operador
   Sincronizado com operador_painel.ejs + server.js atualizado
   ============================================================ */

const socket = io();
const digestoresState = {};
const tickers = {};

/* -----------------------------
   LOG VISUAL
------------------------------ */
function log(msg) {
    const el = document.getElementById("logContent");
    el.innerHTML = `<div>${new Date().toLocaleString()} → ${msg}</div>` + el.innerHTML;
}

/* -----------------------------
   HELPERS DE TEMPO
------------------------------ */
function msToTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;

    if (h > 0) return `${h}h ${m}m ${ss}s`;
    if (m > 0) return `${m}m ${ss}s`;
    return `${ss}s`;
}

function diffHuman(start, end) {
    try {
        return msToTime(new Date(end) - new Date(start));
    } catch {
        return "—";
    }
}

/* -----------------------------
   TICKERS PARA OS TIMERS
------------------------------ */
function startTicker(id, tipo, startISO) {
    const key = `${id}-${tipo}`;
    if (tickers[key]) return;

    function tick() {
        const span = document.getElementById(`timer-${tipo}-${id}`);
        if (!span) return;
        const ms = Date.now() - new Date(startISO).getTime();
        span.textContent = msToTime(ms);
    }

    tick();
    tickers[key] = setInterval(tick, 1000);
}

function stopTicker(id, tipo) {
    const key = `${id}-${tipo}`;
    if (tickers[key]) {
        clearInterval(tickers[key]);
        delete tickers[key];
    }
}

/* -----------------------------
   RENDERIZAÇÃO DOS DIGESTORES
------------------------------ */
function renderDigestors(list) {
    list.forEach(d => {
        digestoresState[d.id] = d;

        const pill = document.getElementById(`pill-${d.id}`);
        const progress = document.getElementById(`progress-${d.id}`);

        const ativo = d.current_tritura || d.current_cooking || d.current_cycle;

        /* ---------- Status visual ---------- */
        if (pill) {
            pill.textContent = ativo ? "OPERANDO" : "PARADO";
            pill.style.background = ativo ? "#1e6d36" : "#c53030";
        }

        /* ---------- Barra de progresso ---------- */
        if (progress) {
            if (d.current_tritura && !d.current_tritura.end_tritura_at) {
                progress.style.width = "35%";
                progress.style.background = "#f39c12";
                progress.textContent = "Trituração";
            } else if (d.current_cooking && !d.current_cooking.end_cook_at) {
                progress.style.width = "70%";
                progress.style.background = "#d32f2f";
                progress.textContent = "Cozimento";
            } else {
                progress.style.width = "0%";
                progress.textContent = "Parado";
            }
        }

        /* ---------- Timers ---------- */
        const t = d.current_tritura;
        const c = d.current_cooking;

        if (t && t.start_tritura_at && !t.end_tritura_at) {
            startTicker(d.id, "trit", t.start_tritura_at);
        } else if (t && t.end_tritura_at) {
            stopTicker(d.id, "trit");
            document.getElementById(`timer-trit-${d.id}`).textContent =
                diffHuman(t.start_tritura_at, t.end_tritura_at);
        }

        if (c && c.start_cook_at && !c.end_cook_at) {
            startTicker(d.id, "cook", c.start_cook_at);
        } else if (c && c.end_cook_at) {
            stopTicker(d.id, "cook");
            document.getElementById(`timer-cook-${d.id}`).textContent =
                diffHuman(c.start_cook_at, c.end_cook_at);
        }

        /* ---------- Controle dos botões ---------- */
        updateButtons(d.id, d);
    });
}

function updateButtons(id, d) {
    const btnStart = document.getElementById(`btn-start-${id}`);
    const btnFT = document.getElementById(`btn-finish-trit-${id}`);
    const btnFC = document.getElementById(`btn-finish-cook-${id}`);
    const btnDis = document.getElementById(`btn-discharge-${id}`);

    btnStart.classList.add("disabled");
    btnFT.classList.add("disabled");
    btnFC.classList.add("disabled");
    btnDis.classList.add("disabled");

    if (!d.current_tritura && !d.current_cooking && !d.current_cycle) {
        btnStart.classList.remove("disabled");
    }

    if (d.current_tritura && !d.current_tritura.end_tritura_at) {
        btnFT.classList.remove("disabled");
    }

    if (d.current_cooking && !d.current_cooking.end_cook_at) {
        btnFC.classList.remove("disabled");
    }

    if (d.current_cycle && d.current_cycle.status === "in_progress" &&
        d.current_cooking && d.current_cooking.end_cook_at) {
        btnDis.classList.remove("disabled");
    }
}

/* -----------------------------
   MODAIS
------------------------------ */
function openStartCarga(id) {
    document.getElementById("mc_digestor_id").value = id;

    const mat = document.querySelector(`input[name="materia-${id}"]:checked`);
    document.getElementById("mc_materia").innerText = mat ? mat.value : "—";

    new bootstrap.Modal("#modalStartCarga").show();
}

function openFinishTrit(id) {
    const d = digestoresState[id];
    if (!d || !d.current_tritura) return alert("Nenhuma trituração em andamento.");

    document.getElementById("mf_trit_id").value = d.current_tritura.id;
    new bootstrap.Modal("#modalFinishTrit").show();
}

function openFinishCook(id) {
    const d = digestoresState[id];
    if (!d || !d.current_cooking) return alert("Nenhum cozimento em andamento.");

    document.getElementById("mc_cooking_id").value = d.current_cooking.id;
    new bootstrap.Modal("#modalFinishCook").show();
}

function openDischarge(id) {
    document.getElementById("md_digestor_id").value = id;
    new bootstrap.Modal("#modalDischarge").show();
}

/* -----------------------------
   FORMULÁRIOS → API
------------------------------ */
document.getElementById("formStartCarga").addEventListener("submit", async ev => {
    ev.preventDefault();

    const body = {
        digestor_id: mc_digestor_id.value,
        from_tova_id: mc_from_tova.value,
        toneladas_solicitadas: mc_ton.value
    };

    const r = await fetch("/api/trituracao/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    const j = await r.json();

    if (r.ok) {
        log("Trituração iniciada no digestor " + body.digestor_id);
        bootstrap.Modal.getInstance(modalStartCarga).hide();
    } else alert(j.error || "Erro");
});

document.getElementById("formFinishTrit").addEventListener("submit", async ev => {
    ev.preventDefault();

    const body = {
        trituration_id: mf_trit_id.value,
        toneladas_trituradas: mf_ton.value
    };

    const r = await fetch("/api/trituracao/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    const j = await r.json();

    if (r.ok) {
        log("Trituração finalizada.");
        bootstrap.Modal.getInstance(modalFinishTrit).hide();
    } else alert(j.error);
});

document.getElementById("formFinishCook").addEventListener("submit", async ev => {
    ev.preventDefault();

    const body = { cooking_id: mc_cooking_id.value };

    const r = await fetch("/api/cooking/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    const j = await r.json();

    if (r.ok) {
        log("Cozimento finalizado.");
        bootstrap.Modal.getInstance(modalFinishCook).hide();
    } else alert(j.error);
});

document.getElementById("formDischarge").addEventListener("submit", async ev => {
    ev.preventDefault();

    const body = {
        digestor_id: md_digestor_id.value,
        toneladas_discarded: md_ton.value,
        notes: md_notes.value
    };

    const r = await fetch("/api/digestor/discharge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    const j = await r.json();

    if (r.ok) {
        log("Descarregamento concluído no digestor " + body.digestor_id);
        bootstrap.Modal.getInstance(modalDischarge).hide();
    } else alert(j.error);
});

/* -----------------------------
   SOCKET.IO
------------------------------ */
socket.on("digestors:update", renderDigestors);

socket.on("tovas:update", tovas => {
    const sel = document.getElementById("mc_from_tova");
    sel.innerHTML = "";
    tovas.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = `${t.nome} — ${t.current_tn} / ${t.capacidade_tn}`;
        sel.appendChild(opt);
    });
});

/* -----------------------------
   FALLBACK (15s)
------------------------------ */
setInterval(async () => {
    try {
        const d = await fetch("/api/digestors").then(r => r.json());
        renderDigestors(d);
    } catch {}
}, 15000);

