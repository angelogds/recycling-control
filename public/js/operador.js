// public/js/operador.js
// Painel do operador: renderização dinâmica + integração APIs/socket

const initialData = window.__OPERADOR_DATA__ || {};
let digestoresState = Array.isArray(initialData.digestores) ? initialData.digestores : [];
let tovasState = [];

console.log("Digestores:", digestoresState);

const digestorGrid = document.getElementById("digestorGrid");
const dischargeModal = document.getElementById("dischargeModal");
const disDigIdInput = document.getElementById("dis_dig_id");
const disTonInput = document.getElementById("dis_ton");
const disNotesInput = document.getElementById("dis_notes");
const disSaveBtn = document.getElementById("dis_save");
const disCancelBtn = document.getElementById("dis_cancel");

function statusLabel(status) {
  const s = String(status || "idle").toLowerCase();
  if (s === "idle") return { cls: "status-idle", text: "idle" };
  if (s === "operating") return { cls: "status-operating", text: "operating" };
  if (s === "cooking") return { cls: "status-cooking", text: "cooking" };
  if (s === "waiting_discharge") return { cls: "status-waiting", text: "waiting_discharge" };
  return { cls: "status-waiting", text: status || "-" };
}

function tovaOptions(selected = "") {
  const base = ['<option value="">Selecionar Tova</option>'];
  tovasState.forEach((t) => {
    const label = `${t.nome} — ${Number(t.current_tn || 0)} / ${Number(t.capacidade_tn || 0)} tn`;
    base.push(`<option value="${t.id}" ${String(selected) === String(t.id) ? "selected" : ""}>${label}</option>`);
  });
  return base.join("");
}

function renderActions(d) {
  const status = String(d.status || "idle").toLowerCase();

  if (status === "idle") {
    return `
      <hr style="border-color:#ffffff22; margin:8px 0;">
      <select class="select-tova" data-digestor="${d.id}">
        ${tovaOptions()}
      </select>
      <input class="input-ton" data-digestor="${d.id}" placeholder="Toneladas solicitadas" type="number" step="0.1">
      <input class="input-mp" data-digestor="${d.id}" placeholder="Matéria-prima (ex: osso)">
      <button class="btn btn-blue btn-full btn-start-trit" data-digestor-id="${d.id}">Iniciar Trituração</button>
    `;
  }

  if (status === "operating") {
    const trit = d.current_tritura;
    return `
      <hr style="border-color:#ffffff22; margin:8px 0;">
      <p><strong>Trituração ativa</strong></p>
      <p>Início: ${trit?.start_tritura_at || "-"}</p>
      <button class="btn btn-green btn-full btn-finish-trit" data-trit-id="${trit?.id || ""}">Encerrar Trituração</button>
    `;
  }

  if (status === "cooking") {
    const cook = d.current_cooking;
    return `
      <hr style="border-color:#ffffff22; margin:8px 0;">
      <p><strong>Cozimento ativo</strong></p>
      <p>Início: ${cook?.start_cook_at || "-"}</p>
      <button class="btn btn-blue btn-full btn-finish-cook" data-cook-id="${cook?.id || ""}">Encerrar Cozimento</button>
    `;
  }

  if (status === "waiting_discharge") {
    return `
      <hr style="border-color:#ffffff22; margin:8px 0;">
      <button class="btn btn-gray btn-full btn-open-discharge" data-digestor-id="${d.id}">Registrar Descarga</button>
    `;
  }

  return "";
}

function renderDigestores() {
  if (!digestorGrid) return;

  if (!digestoresState.length) {
    digestorGrid.innerHTML = '<div class="col-12"><div class="alert">Nenhum digestor cadastrado.</div></div>';
    return;
  }

  digestorGrid.innerHTML = digestoresState.map((d) => {
    const st = statusLabel(d.status);
    return `
      <div class="col-4">
        <div class="digestor-box" data-id="${d.id}">
          <h2 class="digestor-name">${d.nome}</h2>
          <p>Capacidade: <strong>${Number(d.capacidade_tn || 0)} tn</strong></p>
          <p>Status: <span class="${st.cls}">${st.text}</span></p>
          ${renderActions(d)}
        </div>
      </div>`;
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

  if (ev.target.matches(".btn-start-cook")) {
    const digestorId = Number(ev.target.dataset.digestorId);
    const tritId = Number(ev.target.dataset.tritId);
    const res = await fetch("/api/cooking/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digestor_id: digestorId, trituration_id: tritId })
    });
    const j = await res.json();
    if (!res.ok) alert(`Erro: ${j.error || "Falha ao iniciar cozimento"}`);
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
    console.log("Digestores:", digestoresState);
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
      console.log("Digestores:", digestoresState);
      renderDigestores();
    }
  } catch (e) {
    console.error("Erro ao carregar digestores:", e);
  }
})();
