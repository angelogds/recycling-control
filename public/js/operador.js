// public/js/operador.js
// Painel do operador: renderização dinâmica + integração APIs/socket

const initialData = window.__OPERADOR_DATA__ || {};
let digestoresState = Array.isArray(initialData.digestores) ? initialData.digestores : [];
let tovasState = [];
let entriesState = Array.isArray(initialData.entries) ? initialData.entries : [];

const digestorGrid = document.getElementById("digestorGrid");
const vehiclesGrid = document.getElementById("vehiclesGrid");
const vehiclesMeta = document.getElementById("vehiclesMeta");
const dischargeModal = document.getElementById("dischargeModal");
const disDigIdInput = document.getElementById("dis_dig_id");
const disTonInput = document.getElementById("dis_ton");
const disNotesInput = document.getElementById("dis_notes");
const disSaveBtn = document.getElementById("dis_save");
const disCancelBtn = document.getElementById("dis_cancel");

const COOKING_ALERT_MINUTES = { warning: 60, danger: 120, critical: 180 };

function tovaOptions(selected = "") {
  const base = ['<option value="">Selecionar Tova</option>'];
  tovasState.forEach((t) => {
    const label = `${t.nome} — ${Number(t.current_tn || 0)} / ${Number(t.capacidade_tn || 0)} tn`;
    base.push(`<option value="${t.id}" ${String(selected) === String(t.id) ? "selected" : ""}>${label}</option>`);
  });
  return base.join("");
}

function elapsedMinutesFrom(isoDate) {
  if (!isoDate) return 0;
  const start = new Date(isoDate);
  if (Number.isNaN(start.getTime())) return 0;
  const diffMs = Date.now() - start.getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

function elapsedFrom(isoDate) {
  if (!isoDate) return "--";
  const totalMin = elapsedMinutesFrom(isoDate);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function digestorAlertClass(d) {
  const status = String(d.status || "idle").toLowerCase();
  if (status !== "cooking") return "digestor-state-ok";
  const mins = elapsedMinutesFrom(d.current_cooking?.start_cook_at);
  if (mins >= COOKING_ALERT_MINUTES.danger) return "digestor-state-danger";
  if (mins >= COOKING_ALERT_MINUTES.warning) return "digestor-state-warning";
  return "digestor-state-ok";
}

function digestorViewModel(d) {
  const status = String(d.status || "idle").toLowerCase();

  if (status === "operating") {
    return {
      waitingLabel: "TRITURANDO",
      time: elapsedFrom(d.current_tritura?.start_tritura_at),
      actionClass: "btn-finish-trit",
      actionText: "Finalizar Trituração",
      actionData: `data-trit-id="${d.current_tritura?.id || ""}"`
    };
  }

  if (status === "cooking") {
    return {
      waitingLabel: "COZIMENTO",
      time: elapsedFrom(d.current_cooking?.start_cook_at),
      actionClass: "btn-finish-cook",
      actionText: "Finalizar Cozimento",
      actionData: `data-cook-id="${d.current_cooking?.id || ""}"`
    };
  }

  if (status === "waiting_discharge") {
    return {
      waitingLabel: "AGUARDANDO DESCARGA",
      time: elapsedFrom(d.current_cooking?.end_cook_at || d.current_cooking?.start_cook_at),
      actionClass: "btn-open-discharge",
      actionText: "Descarregar Digestor",
      actionData: `data-digestor-id="${d.id}"`
    };
  }

  return {
    waitingLabel: "PRONTO PARA TRITURAÇÃO",
    time: "--",
    actionClass: "btn-start-trit",
    actionText: "Iniciar Trituração",
    actionData: `data-digestor-id="${d.id}"`
  };
}

function renderControls(d) {
  if (String(d.status || "idle").toLowerCase() !== "idle") return "";

  return `
    <div class="digestor-controls">
      <select class="select-tova" data-digestor="${d.id}">${tovaOptions()}</select>
      <input class="input-ton" data-digestor="${d.id}" placeholder="Toneladas solicitadas" type="number" step="0.1">
      <input class="input-mp" data-digestor="${d.id}" placeholder="Matéria-prima (ex: osso)">
    </div>
  `;
}

function renderAlertCards(d) {
  if (String(d.status || "").toLowerCase() !== "cooking") return "";
  const mins = elapsedMinutesFrom(d.current_cooking?.start_cook_at);
  if (mins < COOKING_ALERT_MINUTES.warning) return "";

  const blocks = [
    `<div class="digestor-alert-card">Digestor ${d.nome}: verificar empurradores, válvulas e vapor.</div>`
  ];

  if (mins >= COOKING_ALERT_MINUTES.critical) {
    blocks.push(`
      <div class="digestor-alert-card danger">
        <p>Tempo crítico (&gt;= 3h). Informe o motivo da parada:</p>
        <textarea class="input-alert-note" data-cook-id="${d.current_cooking?.id || ""}" rows="2" placeholder="Ex: quebra da percoladora"></textarea>
        <button class="digestor-action btn-save-alert" data-cook-id="${d.current_cooking?.id || ""}">Salvar observação</button>
      </div>
    `);
  }

  return blocks.join("");
}

function renderDigestores() {
  if (!digestorGrid) return;

  if (!digestoresState.length) {
    digestorGrid.innerHTML = '<div class="alert">Nenhum digestor cadastrado.</div>';
    return;
  }

  digestorGrid.innerHTML = digestoresState.map((d) => {
    const vm = digestorViewModel(d);
    const ciclos = Number(d.current_cycle?.id || 0);
    const triturado = Number(d.current_tritura?.toneladas_trituradas || d.current_tritura?.toneladas_solicitadas || 0).toFixed(1);
    const processado = Number(d.current_cycle?.toneladas_processadas || 0).toFixed(1);

    return `
      <article class="digestor-card ${digestorAlertClass(d)}" data-id="${d.id}">
        <div class="digestor-top">
          <h3 class="digestor-title">${d.nome}</h3>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
            <path d="M12 2 4 6.5v11L12 22l8-4.5v-11L12 2Zm0 0v10m0-10 8 4.5M12 12 4 6.5" stroke="#63A2FF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>

        <div class="digestor-status-box">
          <span>${vm.waitingLabel}</span>
          <p class="digestor-time">${vm.time}</p>
        </div>

        <div class="digestor-metrics">
          <div class="digestor-metric"><span>Ciclos</span><strong>${ciclos}</strong></div>
          <div class="digestor-metric"><span>Trit. (tn)</span><strong>${triturado}</strong></div>
          <div class="digestor-metric"><span>Proc. (tn)</span><strong>${processado}</strong></div>
        </div>

        ${renderControls(d)}
        ${renderAlertCards(d)}

        <button class="digestor-action ${vm.actionClass}" ${vm.actionData}>${vm.actionText}</button>
      </article>
    `;
  }).join("");
}

function renderVehicles() {
  if (!vehiclesGrid || !vehiclesMeta) return;
  const patio = entriesState.filter((e) => ["arrived", "yard", "unloading"].includes(String(e.status || "").toLowerCase()));
  const totalTon = patio.reduce((sum, e) => sum + Number(e.toneladas_declared || 0), 0);
  vehiclesMeta.innerHTML = `<strong>${patio.length} veículo(s)</strong> • ${totalTon.toFixed(1)} toneladas`;

  if (!patio.length) {
    vehiclesGrid.innerHTML = '<div class="alert">Nenhum caminhão no pátio.</div>';
    return;
  }

  vehiclesGrid.innerHTML = patio.map((entry, idx) => {
    const isUnloading = String(entry.status || "").toLowerCase() === "unloading";
    const queueTime = elapsedFrom(entry.arrival_at || entry.yard_at);
    const unloadTime = elapsedFrom(entry.start_unload_at);

    return `
      <article class="vehicle-card glass-surface" data-entry-id="${entry.id}">
        <span class="vehicle-number">${idx + 1}</span>
        <h3>${entry.truck_plate}</h3>
        <p class="vehicle-weight">⚖ ${Number(entry.toneladas_declared || 0).toFixed(1)} tn</p>
        <p class="vehicle-time">Pátio: ${queueTime}</p>
        ${isUnloading ? `<p class="vehicle-time">Descarga: ${unloadTime}</p>` : ""}
        <button class="vehicle-action ${isUnloading ? "btn-finish-unload" : "btn-start-unload"}" type="button" data-entry-id="${entry.id}">
          ${isUnloading ? "Finalizar Descarga" : "Iniciar Descarga"}
        </button>
      </article>
    `;
  }).join("");
}

document.addEventListener("click", async (ev) => {
  if (ev.target.matches(".btn-start-trit")) {
    const did = Number(ev.target.dataset.digestorId);
    const tovaSelect = document.querySelector(`.select-tova[data-digestor="${did}"]`);
    const tonInput = document.querySelector(`.input-ton[data-digestor="${did}"]`);
    const mpInput = document.querySelector(`.input-mp[data-digestor="${did}"]`);

    const payload = {
      digestor_id: did,
      from_tova_id: Number(tovaSelect?.value || 0),
      toneladas_solicitadas: Number(tonInput?.value || 0),
      materia_prima: (mpInput?.value || "").trim() || null
    };

    if (!payload.from_tova_id) return alert("Selecione a tova de origem.");

    const res = await fetch("/api/trituracao/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const j = await res.json();
    if (!res.ok) alert(`Erro: ${j.error || "Falha ao iniciar trituração"}`);
  }

  if (ev.target.matches(".btn-finish-trit")) {
    const tritId = Number(ev.target.dataset.tritId);
    if (!tritId) return alert("Nenhuma trituração ativa para este digestor.");

    const toneladas = prompt("Informe toneladas trituradas:", "0") || "0";
    const res = await fetch("/api/trituracao/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trituration_id: tritId, toneladas_trituradas: Number(toneladas || 0) })
    });

    const j = await res.json();
    if (!res.ok) alert(`Erro: ${j.error || "Falha ao finalizar trituração"}`);
  }

  if (ev.target.matches(".btn-finish-cook")) {
    const cookId = Number(ev.target.dataset.cookId);
    if (!cookId) return alert("Nenhum cozimento ativo para este digestor.");

    const res = await fetch("/api/cooking/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cooking_id: cookId })
    });

    const j = await res.json();
    if (!res.ok) alert(`Erro: ${j.error || "Falha ao finalizar cozimento"}`);
  }

  if (ev.target.matches(".btn-open-discharge")) {
    disDigIdInput.value = ev.target.dataset.digestorId;
    disTonInput.value = "";
    disNotesInput.value = "";
    dischargeModal.style.display = "flex";
  }

  if (ev.target.matches(".btn-start-unload")) {
    const entryId = Number(ev.target.dataset.entryId);
    const res = await fetch(`/api/entries/${entryId}/start-unload`, { method: "POST" });
    const j = await res.json();
    if (!res.ok) alert(j.error || "Falha ao iniciar descarga do caminhão");
  }

  if (ev.target.matches(".btn-finish-unload")) {
    const entryId = Number(ev.target.dataset.entryId);
    const res = await fetch(`/api/entries/${entryId}/finish-unload`, { method: "POST" });
    const j = await res.json();
    if (!res.ok) alert(j.error || "Falha ao finalizar descarga do caminhão");
  }

  if (ev.target.matches(".btn-save-alert")) {
    const cookId = Number(ev.target.dataset.cookId);
    const txt = document.querySelector(`.input-alert-note[data-cook-id="${cookId}"]`);
    const note = (txt?.value || "").trim();
    if (!note) return alert("Descreva o motivo da parada.");

    const res = await fetch(`/api/cooking/${cookId}/alert-note`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note })
    });
    const j = await res.json();
    if (!res.ok) alert(j.error || "Falha ao salvar observação");
  }
});

if (disCancelBtn) {
  disCancelBtn.addEventListener("click", () => {
    dischargeModal.style.display = "none";
  });
}

if (disSaveBtn) {
  disSaveBtn.addEventListener("click", async () => {
    const payload = {
      digestor_id: Number(disDigIdInput.value),
      toneladas_discarded: Number(disTonInput.value || 0),
      notes: (disNotesInput.value || "").trim() || null
    };

    const res = await fetch("/api/digestor/discharge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const j = await res.json();
    if (res.ok) {
      dischargeModal.style.display = "none";
    } else {
      alert(`Erro: ${j.error || "Falha ao registrar descarga"}`);
    }
  });
}

function setupSocket() {
  if (typeof io !== "function") {
    console.warn("socket.io indisponível no front-end.");
    return;
  }

  const socket = io();

  socket.on("digestors:update", (digestores) => {
    digestoresState = Array.isArray(digestores) ? digestores : [];
    renderDigestores();
  });

  socket.on("tovas:update", (tovas) => {
    tovasState = Array.isArray(tovas) ? tovas : [];
    renderDigestores();
  });

  socket.on("entries:update", (entries) => {
    entriesState = Array.isArray(entries) ? entries : [];
    renderVehicles();
  });

  socket.on("entries:finished:update", () => {
    renderVehicles();
  });
}

(async function loadInitialState() {
  renderDigestores();
  renderVehicles();
  setupSocket();

  try {
    const [digestoresRes, entriesRes] = await Promise.all([
      fetch("/api/digestors"),
      fetch("/api/entries/yard")
    ]);

    if (digestoresRes.ok) {
      digestoresState = await digestoresRes.json();
      renderDigestores();
    }

    if (entriesRes.ok) {
      entriesState = await entriesRes.json();
      renderVehicles();
    }
  } catch (e) {
    console.error("Erro ao carregar estado inicial:", e);
  }

  setInterval(() => {
    renderDigestores();
    renderVehicles();
  }, 15000);
})();
