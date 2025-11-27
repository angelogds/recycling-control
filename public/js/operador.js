cat > public/js/operador.js << 'EOF'
/* operador.js — cliente (socket + ações) */
const socket = io();
let modalStart, modalFinishTrit, modalFinishCook, modalDischarge;

document.addEventListener('DOMContentLoaded', () => {
  modalStart = new bootstrap.Modal(document.getElementById('modalStartCarga'));
  modalFinishTrit = new bootstrap.Modal(document.getElementById('modalFinishTrit'));
  modalFinishCook = new bootstrap.Modal(document.getElementById('modalFinishCook'));
  modalDischarge = new bootstrap.Modal(document.getElementById('modalDischarge'));
  loadInitial();
});

socket.on('digestors:update', data => renderDigestors(data));
socket.on('tovas:update', data => console.debug('tovas', data));
socket.on('entries:update', data => console.debug('entries', data));

function addLog(msg){
  const el = document.getElementById('logContent');
  el.innerHTML = `<div>${new Date().toLocaleString()} → ${msg}</div>` + el.innerHTML;
}

async function loadInitial(){
  const d = await fetch('/api/digestors').then(r=>r.json());
  renderDigestors(d);
}

function renderDigestors(list){
  const grid = document.getElementById('digestorGrid');
  grid.innerHTML = '';
  list.forEach(d=>{
    const tritId = d.current_tritura ? d.current_tritura.id : null;
    const cookId = d.current_cooking ? d.current_cooking.id : null;
    const col = document.createElement('div');
    col.className = 'col-md-6';
    col.innerHTML = `
      <div class="card card-premium p-3">
        <h3 class="title-premium">${d.nome}</h3>
        <p class="small text-muted">Capacidade: ${d.capacidade_tn} tn</p>
        <div class="progress-premium mb-2"><div class="progress-premium-inner" style="width:100%"></div></div>
        <div class="small mb-2">
          <strong>Trituração:</strong> ${tritId ? '#'+tritId : 'Nenhuma'}<br>
          <strong>Cozimento:</strong> ${cookId ? '#'+cookId : 'Nenhuma'}<br>
          <strong>Ciclo:</strong> ${d.current_cycle ? '#'+d.current_cycle.id : 'Nenhum'}
        </div>
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-premium btn-sm" onclick="openStartCarga(${d.id})">Iniciar Carregamento</button>
          <button class="btn btn-outline-premium btn-sm" onclick="openFinishTrit(${tritId})" ${tritId ? '' : 'disabled'}>Finalizar Trituração</button>
          <button class="btn btn-outline-premium btn-sm" onclick="openStartCook(${cookId})" ${cookId ? '' : 'disabled'}>Iniciar Cozimento</button>
          <button class="btn btn-outline-premium btn-sm" onclick="openFinishCook(${cookId})" ${cookId ? '' : 'disabled'}>Finalizar Cozimento</button>
          <button class="btn btn-warning btn-sm" onclick="openDischarge(${d.id}, ${tritId||'null'}, ${cookId||'null'})">Descarregar</button>
        </div>
      </div>
    `;
    grid.appendChild(col);
  });
}

/* Iniciar carga */
async function openStartCarga(digestorId){
  document.getElementById('start_digestor_id').value = digestorId;
  const tovas = await fetch('/api/tovas').then(r=>r.json());
  const sel = document.getElementById('select_tova'); sel.innerHTML='';
  tovas.forEach(t => sel.innerHTML += `<option value="${t.id}">${t.nome} — ${t.current_tn}/${t.capacidade_tn}</option>`);
  document.getElementById('ton_solicitadas').value='';
  modalStart.show();
}
async function confirmStartCarga(){
  const digestor_id = document.getElementById('start_digestor_id').value;
  const from_tova_id = document.getElementById('select_tova').value;
  const toneladas_solicitadas = parseFloat(document.getElementById('ton_solicitadas').value);
  if(!toneladas_solicitadas || toneladas_solicitadas<=0){ alert('Informe toneladas válidas'); return; }
  const res = await fetch('/api/trituracao/start', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ digestor_id, from_tova_id, toneladas_solicitadas })}).then(r=>r.json());
  if(res.error) { alert(res.error); return; }
  addLog(`Carregamento iniciado: trit ${res.trituration_id}`);
  modalStart.hide();
}

/* Finalizar trituração */
function openFinishTrit(tritId){
  if(!tritId) return alert('Nenhuma trituração ativa.');
  document.getElementById('finish_trit_id').value = tritId;
  document.getElementById('ton_trituradas').value = '';
  modalFinishTrit.show();
}
async function confirmFinishTrit(){
  const tritId = document.getElementById('finish_trit_id').value;
  const toneladas_trituradas = parseFloat(document.getElementById('ton_trituradas').value);
  if(!toneladas_trituradas || toneladas_trituradas<=0){ alert('Informe toneladas trituradas'); return; }
  const res = await fetch('/api/trituracao/finish', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ trituration_id: tritId, toneladas_trituradas })}).then(r=>r.json());
  if(res.error) { alert(res.error); return; }
  addLog(`Trituração #${tritId} finalizada`);
  modalFinishTrit.hide();
}

/* Cozimento start/finish */
function openStartCook(cookId){
  if(!cookId) return alert('Nenhum cooking pendente');
  fetch('/api/cooking/start', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ cooking_id: cookId })}).then(()=> addLog(`Cozimento ${cookId} iniciado`));
}
function openFinishCook(cookId){
  if(!cookId) return alert('Nenhum cozimento ativo');
  document.getElementById('finish_cook_id').value = cookId;
  document.getElementById('cook_notes').value = '';
  modalFinishCook.show();
}
async function confirmFinishCook(){
  const cookId = document.getElementById('finish_cook_id').value;
  await fetch('/api/cooking/finish',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ cooking_id: cookId })});
  addLog(`Cozimento ${cookId} finalizado`);
  modalFinishCook.hide();
}

/* Discharge */
function openDischarge(digestorId, tritId, cookId){
  document.getElementById('discharge_digestor_id').value = digestorId;
  document.getElementById('discharge_trit_id').value = tritId || '';
  document.getElementById('discharge_cook_id').value = cookId || '';
  document.getElementById('ton_descarregadas').value = '';
  document.getElementById('discharge_notes').value = '';
  modalDischarge.show();
}
async function confirmDischarge(){
  const digestor_id = document.getElementById('discharge_digestor_id').value;
  const trit = document.getElementById('discharge_trit_id').value || null;
  const cook = document.getElementById('discharge_cook_id').value || null;
  const toneladas_discarded = parseFloat(document.getElementById('ton_descarregadas').value) || 0;
  const notes = document.getElementById('discharge_notes').value || null;
  const res = await fetch('/api/digestor/discharge', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ digestor_id, trituration_cycle_id: trit, cooking_cycle_id: cook, toneladas_discarded, notes })}).then(r=>r.json());
  if(res.error) { alert(res.error); return; }
  addLog(`Digestor ${digestor_id} descarregado`);
  modalDischarge.hide();
}
EOF
