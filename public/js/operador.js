// public/js/operador.js
const socket = io();

socket.on('connect', () => console.log('socket connected', socket.id));
socket.on('digestors:update', (data) => renderDigestors(data));
socket.on('tovas:update', (tovas) => fillTovas(tovas));
socket.on('entries:update', (entries) => console.log('entries update', entries));

function addLog(msg){
  const el = document.getElementById('logContent');
  if(!el) return;
  el.innerHTML = `<div>${new Date().toLocaleString()} → ${msg}</div>` + el.innerHTML;
}

async function loadInitial(){
  const d = await fetch('/api/digestors').then(r=>r.json());
  renderDigestors(d);
}
loadInitial();

function renderDigestors(list){
  const grid = document.getElementById('digestorGrid');
  if(!grid) return;
  grid.innerHTML = '';
  list.forEach(d => {
    const col = document.createElement('div');
    col.className = 'col-12 col-md-6 mb-3';
    col.innerHTML = `
      <div class="card p-3">
        <h4 class="text-success">${d.nome}</h4>
        <p class="mb-1">Capacidade: ${d.capacidade_tn} tn</p>
        <div style="background:#166534;height:12px;border-radius:8px;margin-bottom:8px"><div style="width:100%;text-align:center;color:#fff;font-size:12px">IDLE</div></div>
        <div class="small"><strong>Trituração:</strong> ${d.current_tritura ? '#' + d.current_tritura.id : 'Nenhuma'}<br>
        <strong>Cozimento:</strong> ${d.current_cooking ? '#' + d.current_cooking.id : 'Nenhuma'}<br>
        <strong>Ciclo:</strong> ${d.current_cycle ? '#' + d.current_cycle.id : 'Nenhum'}</div>
        <div class="mt-3">
          <button class="btn btn-premium btn-sm me-2" onclick="openStartCarga(${d.id})">Iniciar Carregamento</button>
          <button class="btn btn-outline-premium btn-sm me-2" onclick="openFinishTrit(${d.current_tritura ? d.current_tritura.id : 'null'})">Finalizar Trituração</button>
          <button class="btn btn-outline-premium btn-sm me-2" onclick="openFinishCook(${d.current_cooking ? d.current_cooking.id : 'null'})">Finalizar Cozimento</button>
          <button class="btn btn-warning btn-sm" onclick="openDischarge(${d.id})">Descarregar</button>
        </div>
      </div>
    `;
    grid.appendChild(col);
  });
}

// modais
function openStartCarga(digestorId){
  document.getElementById('sc_digestor_id').value = digestorId;
  // fill tovas
  fetch('/api/tovas').then(r=>r.json()).then(tovas=>{
    const sel = document.getElementById('sc_from_tova');
    sel.innerHTML = '';
    tovas.forEach(t => {
      const o = document.createElement('option');
      o.value = t.id;
      o.text = `${t.nome} (${t.current_tn || 0} tn)`;
      sel.appendChild(o);
    });
    new bootstrap.Modal(document.getElementById('modalStartCarga')).show();
  });
}

document.getElementById && document.getElementById('formStartCarga')?.addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const form = ev.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const res = await fetch('/api/trituracao/start', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if(res.ok){ addLog('Iniciada trituração no digestor ' + data.digestor_id); bootstrap.Modal.getInstance(document.getElementById('modalStartCarga')).hide(); }
});

document.getElementById && document.getElementById('formFinishTritura')?.addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(ev.target).entries());
  const res = await fetch('/api/trituracao/finish', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if(res.ok){ addLog('Trituração finalizada ' + data.trituration_id); bootstrap.Modal.getInstance(document.getElementById('modalFinishTritura')).hide(); }
});

document.getElementById && document.getElementById('formFinishCook')?.addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(ev.target).entries());
  const res = await fetch('/api/cooking/finish', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if(res.ok){ addLog('Cozimento finalizado ' + data.cooking_id); bootstrap.Modal.getInstance(document.getElementById('modalFinishCook')).hide(); }
});

document.getElementById && document.getElementById('formDischarge')?.addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(ev.target).entries());
  const res = await fetch('/api/digestor/discharge', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if(res.ok){ addLog('Digestor descarregado ' + data.digestor_id); bootstrap.Modal.getInstance(document.getElementById('modalDischarge')).hide(); }
});

function openFinishTritura(tritId){
  if(!tritId){ alert('Não há trituração ativa'); return; }
  document.getElementById('ft_trit_id').value = tritId;
  new bootstrap.Modal(document.getElementById('modalFinishTritura')).show();
}
function openFinishCook(cookId){
  if(!cookId){ alert('Não há cozimento ativo'); return; }
  document.getElementById('fc_cook_id').value = cookId;
  new bootstrap.Modal(document.getElementById('modalFinishCook')).show();
}
function openDischarge(digestorId){
  document.getElementById('d_digestor_id').value = digestorId;
  new bootstrap.Modal(document.getElementById('modalDischarge')).show();
}

function fillTovas(tovas){
  // opcional
}
