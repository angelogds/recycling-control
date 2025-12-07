// public/js/dashboard.js
// Busca dados das APIs e plota 3 gráficos com Chart.js

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Erro ao buscar " + url);
  return r.json();
}

let prodChart, effChart, timeChart;

async function refreshAll(){
  try {
    const cycles = await fetchJSON("/api/cycles/all");
    const digestors = await fetchJSON("/api/digestors");
    // entries optional
    let entries = [];
    try { entries = await fetchJSON("/api/entries/pending"); } catch(e){}

    buildProductionLine(cycles);
    buildEfficiencyPie(cycles, digestors);
    buildTimeBar(cycles);
  } catch (e) {
    console.error(e);
    alert("Erro ao atualizar dashboard");
  }
}

// Produção diária (soma de toneladas_trituradas por dia)
function buildProductionLine(cycles){
  // map by day
  const map = {};
  cycles.forEach(c => {
    const dt = c.started_at ? new Date(c.started_at).toISOString().slice(0,10) : 'unknown';
    const t = (c.toneladas_trituradas || 0) || ((c.toneladas_trituradas===0)?0:0);
    map[dt] = (map[dt]||0) + (t||0);
  });
  const labels = Object.keys(map).sort();
  const data = labels.map(l => map[l]);

  const ctx = document.getElementById("chartProdLine").getContext("2d");
  if (prodChart) prodChart.destroy();
  prodChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Toneladas trituradas", data, fill: true, tension: 0.2 }] },
    options: { responsive: true, plugins: { legend: { display: true } } }
  });
}

// Eficiência por digestor (conta ciclos finalizados vs iniciados)
function buildEfficiencyPie(cycles, digestors){
  const counts = {};
  digestors.forEach(d => counts[d.nome] = 0);
  cycles.forEach(c => {
    const name = (digestors.find(dd => dd.id === c.digestor_id) || {}).nome || ("Digestor " + c.digestor_id);
    counts[name] = (counts[name]||0) + 1;
  });
  const labels = Object.keys(counts);
  const data = labels.map(l => counts[l]);

  const ctx = document.getElementById("chartEffPie").getContext("2d");
  if (effChart) effChart.destroy();
  effChart = new Chart(ctx, {
    type: "pie",
    data: { labels, datasets: [{ data }] },
    options: { responsive: true }
  });
}

// Tempo médio por etapa (calcula média dos diffs)
function buildTimeBar(cycles){
  const trituraTimes = [];
  const cookTimes = [];

  cycles.forEach(c => {
    const sT = c.start_tritura_at || c.started_at;
    const eT = c.end_tritura_at || c.ended_at;
    if (sT && eT) {
      const diff = (new Date(eT) - new Date(sT)) / 60000; // minutos
      trituraTimes.push(diff);
    }
    if (c.start_cook_at && c.end_cook_at) {
      const diffc = (new Date(c.end_cook_at) - new Date(c.start_cook_at)) / 60000;
      cookTimes.push(diffc);
    }
  });

  const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
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

window.addEventListener("load", refreshAll);
