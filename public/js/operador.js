// public/js/operador.js
// Painel do operador: renderização dinâmica + integração APIs/socket

const initialData = window.__OPERADOR_DATA__ || {};
let digestoresState = Array.isArray(initialData.digestores) ? initialData.digestores : [];
let tovasState = [];

const digestorGrid = document.getElementById("digestorGrid");
const dischargeModal = document.getElementById("dischargeModal");
const disDigIdInput = document.getElementById("dis_dig_id");
const disTonInput = document.getElementById("dis_ton");
const disNotesInput = document.getElementById("dis_notes");
const disSaveBtn = document.getElementById("dis_save");
const disCancelBtn = document.getElementById("dis_cancel");

function tovaOptions(selected = "") {
  const base = ['<option value="">Selecionar Tova</option>'];
  tovasState.forEach((t) => {
    const label = `${t.nome} — ${Number(t.current_tn || 0)} / ${Number(t.capacidade_tn || 0)} tn`;
    base.push(`<option value="${t.id}" ${String(selected) === String(t.id) ? "selected" : ""}>${label}</option>`);
  });
  return base.join("");
}

function elapsedFrom(isoDate) {
  if (!isoDate) return "--";
  const start = new Date(isoDate);
  if (Number.isNaN(start.getTime())) return "--";

  const diffMs = Date.now() - start.getTime();
  const totalMin = Math.max(0, Math.floor(diffMs / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function digestorViewModel(d, index) {
  const status = String(d.status || "idle").toLowerCase();

  if (status === "operating") {
    return {
      ready: "PRONTO",
      waitingLabel: "TRITURANDO",
      time: elapsedFrom(d.current_tritura?.start_tritura_at),
      actionClass: "btn-finish-trit",
      actionText: "Encerrar Trituração",
      actionData: `data-trit-id="${d.current_tritura?.id || ""}"`
    };
  }

  if (status === "cooking") {
    return {
      ready: "PRONTO",
      waitingLabel: "COZIMENTO",
      time: elapsedFrom(d.current_cooking?.start_cook_at),
      actionClass: "btn-finish-cook",
      actionText: "Encerrar Cozimento",
      actionData: `data-cook-id="${d.current_cooking?.id || ""}"`
    };
  }

  if (status === "waiting_discharge") {
    return {
      ready: "PRONTO",
      waitingLabel: "AGUARDANDO",
      time: elapsedFrom(d.current_cooking?.end_cook_at || d.current_cooking?.start_cook_at),
      actionClass: "btn-open-discharge",
      actionText: "Descarregar",
      actionData: `data-digestor-id="${d.id}"`
    };
  }

  return {
    ready: "PRONTO",
    waitingLabel: "AGUARDANDO",
    time: `${56 + index}m`,
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

function renderDigestores() {
  if (!digestorGrid) return;

  if (!digestoresState.length) {
    digestorGrid.innerHTML = '<div class="alert">Nenhum digestor cadastrado.</div>';
    return;
  }

  digestorGrid.innerHTML = digestoresState.map((d, index) => {
    const vm = digestorViewModel(d, index);
    const ciclos = Number(d.current_cycle?.id || index + 1);
    const triturado = d.current_tritura?.toneladas_trituradas || d.current_tritura?.toneladas_solicitadas || `${5 + index}m`;
    const processado = d.current_cycle?.toneladas_processadas || `${Math.round((Number(d.capacidade_tn || 8) * 2185))}m`;

    return `
      <article class="digestor-card" data-id="${d.id}">
        <div class="digestor-top">
          <h3 class="digestor-title">${d.nome}</h3>
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
            <path d="M12 2 4 6.5v11L12 22l8-4.5v-11L12 2Zm0 0v10m0-10 8 4.5M12 12 4 6.5" stroke="#63A2FF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>

        <p class="digestor-ready">${vm.ready}</p>

        <div class="digestor-status-box">
          <span>${vm.waitingLabel}</span>
          <p class="digestor-time">${vm.time}</p>
        </div>

        <div class="digestor-metrics">
          <div class="digestor-metric"><span>Ciclos</span><strong>${ciclos}</strong></div>
          <div class="digestor-metric"><span>Trit.</span><strong>${triturado}</strong></div>
          <div class="digestor-metric"><span>Primo.</span><strong>${processado}</strong></div>
        </div>

        ${renderControls(d)}

        <button class="digestor-action ${vm.actionClass}" ${vm.actionData}>${vm.actionText}</button>
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
}

(async function loadInitialState() {
  renderDigestores();
  setupSocket();

  try {
    const digestoresRes = await fetch("/api/digestors");
    if (digestoresRes.ok) {
      digestoresState = await digestoresRes.json();
      renderDigestores();
    }
  } catch (e) {
    console.error("Erro ao carregar digestores:", e);
  }
})();
