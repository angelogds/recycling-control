// public/js/dashboard.js
// Dashboard de produtividade em tempo real (meta diária, throughput por digestor e ranking por turno)

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Erro ao buscar " + url);
  return r.json();
}

let prodChart, timeChart, digestorChart;

function currentDateISO() {
  return new Date().toISOString().slice(0, 10);
}

function fillSummaryCards(data) {
  document.getElementById("metaDiaria").textContent = `${data.meta_diaria_tn.toFixed(1)} tn`;
  document.getElementById("throughputHoje").textContent = `${data.resumo.toneladas_hoje.toFixed(1)} tn`;
  document.getElementById("ciclosAtivos").textContent = data.resumo.ciclos_ativos;
  document.getElementById("ciclosFinalizados").textContent = data.resumo.ciclos_finalizados_hoje;
  document.getElementById("entradasHoje").textContent = data.resumo.entradas_hoje;

  const progress = Math.max(0, Math.min(100, data.progresso_meta_percentual));
  document.getElementById("metaBar").style.width = `${progress}%`;
  document.getElementById("metaPercentual").textContent = `${progress.toFixed(1)}% da meta diária`;
}

function buildDigestorThroughputChart(throughputDigestor) {
  const labels = throughputDigestor.map((item) => item.digestor_nome);
  const tons = throughputDigestor.map((item) => item.toneladas_hoje);

  const ctx = document.getElementById("chartThroughputDigestor").getContext("2d");
  if (digestorChart) digestorChart.destroy();
  digestorChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Toneladas hoje",
        data: tons,
        backgroundColor: ["#11c15d", "#2c8cff", "#f0b429", "#ff6b6b"]
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}

function buildShiftRankingTable(rankingTurno) {
  const tbody = document.getElementById("rankingBody");
  if (!rankingTurno.length) {
    tbody.innerHTML = '<tr><td colspan="4">Nenhum ciclo registrado neste turno.</td></tr>';
    return;
  }

  tbody.innerHTML = rankingTurno.map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${item.operador}</td>
      <td>${item.ciclos}</td>
      <td>${Number(item.toneladas).toFixed(1)} tn</td>
    </tr>
  `).join("");
}

// Produção diária (soma de toneladas por dia)
function buildProductionLine(cycles) {
  const map = {};
  cycles.forEach(c => {
    const dt = c.started_at ? new Date(c.started_at).toISOString().slice(0, 10) : "-";
    map[dt] = (map[dt] || 0) + Number(c.toneladas_trituradas || 0);
  });

  const labels = Object.keys(map).sort();
  const data = labels.map(l => map[l]);

  const ctx = document.getElementById("chartProdLine").getContext("2d");
  if (prodChart) prodChart.destroy();
  prodChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Toneladas trituradas", data, fill: true, tension: 0.2 }] },
    options: { responsive: true }
  });
}

// Tempo médio por etapa (calcula média dos diffs)
function buildTimeBar(cycles) {
  const trituraTimes = [];
  const cookTimes = [];

  cycles.forEach(c => {
    if (c.start_tritura_at && c.end_tritura_at) {
      const diff = (new Date(c.end_tritura_at) - new Date(c.start_tritura_at)) / 60000;
      trituraTimes.push(diff);
    }
    if (c.start_cook_at && c.end_cook_at) {
      const diffc = (new Date(c.end_cook_at) - new Date(c.start_cook_at)) / 60000;
      cookTimes.push(diffc);
    }
  });

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const labels = ["Trituração (média)", "Cozimento (média)"];
  const data = [Math.round(avg(trituraTimes)), Math.round(avg(cookTimes))];

  const ctx = document.getElementById("chartTimeBar").getContext("2d");
  if (timeChart) timeChart.destroy();
  timeChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Minutos", data }] },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}

async function refreshAll() {
  try {
    const dateInput = document.getElementById("shiftDate");
    const shiftSelect = document.getElementById("shiftSelect");
    const dateRef = dateInput.value || currentDateISO();
    const shift = shiftSelect.value || "morning";

    const [cycles, productivity] = await Promise.all([
      fetchJSON("/api/cycles/all"),
      fetchJSON(`/api/dashboard/productivity?date=${encodeURIComponent(dateRef)}&shift=${encodeURIComponent(shift)}`)
    ]);

    fillSummaryCards(productivity);
    buildDigestorThroughputChart(productivity.throughput_por_digestor || []);
    buildShiftRankingTable(productivity.ranking_turno || []);
    buildProductionLine(cycles);
    buildTimeBar(cycles);
  } catch (e) {
    console.error(e);
    alert("Erro ao atualizar dashboard");
  }
}

window.addEventListener("load", () => {
  const dateInput = document.getElementById("shiftDate");
  const shiftSelect = document.getElementById("shiftSelect");

  dateInput.value = currentDateISO();
  shiftSelect.value = "morning";

  dateInput.addEventListener("change", refreshAll);
  shiftSelect.addEventListener("change", refreshAll);

  refreshAll();
});
