// public/js/operador.js
(() => {
  const socket = io();
  const body = document.getElementById('digestoresTableBody');
  const logContent = document.getElementById('logContent');

  // map timers by digestor id
  const timers = {};
  // store last returned ids (trituration_id / cooking_id) per digestor (temp client cache)
  const stateCache = {};

  function log(msg) {
    const time = new Date().toLocaleTimeString();
    logContent.innerText = `[${time}] ${msg}\n` + logContent.innerText;
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return '--:--';
    const s = Math.floor(ms / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  }

  function renderDigestores(list) {
    body.innerHTML = '';
    list.forEach(d => {
      const materia = (stateCache[d.id] && stateCache[d.id].materia_prima) || '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${d.nome}</strong></td>

        <td class="materia-col" data-id="${d.id}">
          <button class="btn btn-sm btn-outline-secondary materia-btn" data-mat="osso" data-did="${d.id}">Osso</button>
          <button class="btn btn-sm btn-outline-secondary materia-btn" data-mat="barrigada" data-did="${d.id}">Barrigada</button>
        </td>

        <td class="status-col" data-id="${d.id}">
          <span class="status-pill ${d.current_cycle ? 'status-operando' : 'status-parado'}" id="status-${d.id}">
            ${translateStatus(d)}
          </span>
        </td>

        <td class="time-col" data-id="${d.id}">
          <div><small>Trit.: <span id="trit-time-${d.id}">--:--</span></small></div>
          <div><small>Cook: <span id="cook-time-${d.id}">--:--</span></small></div>
        </td>

        <td class="last-times-col" data-id="${d.id}">
          <div><small>Trit. total: <span id="trit-total-${d.id}">—</span></small></div>
          <div><small>Cook total: <span id="cook-total-${d.id}">—</span></small></div>
        </td>

        <td class="actions-col text-center" data-id="${d.id}">
          <div class="d-flex justify-content-end flex-wrap">
            <button class="btn btn-op btn-tritura btn-start" data-id="${d.id}"><i class="bi bi-play-fill"></i> Iniciar</button>
            <button class="btn btn-op btn-finish-tritura btn-finish-trit disabled" data-id="${d.id}">Finalizar Tritura</button>
            <button class="btn btn-op btn-cook btn-finish-cook disabled" data-id="${d.id}">Finalizar Cozimento</button>
            <button class="btn btn-op btn-discharge btn-discharge-op disabled" data-id="${d.id}">Descarregar</button>
          </div>
        </td>
      `;

      body.appendChild(tr);

      // initial UI status
      applyRowState(d);
      setupMateriaButtons(d);
      bindButtons(d);
    });
  }

  function translateStatus(d) {
    // prefer explicit fields
    if (d.current_cook) return 'EM COZIMENTO';
    if (d.current_tritura) return 'EM TRITURAÇÃO';
    if (d.current_cycle) return 'EM OPERAÇÃO';
    return 'PARADO';
  }

  function applyRowState(d) {
    const id = d.id;
    // set materia highlight from cache
    const materia = (stateCache[id] && stateCache[id].materia_prima) || '';
    const materiaCol = document.querySelector(`.materia-col[data-id="${id}"]`);
    if (materiaCol) {
      Array.from(materiaCol.querySelectorAll('.materia-btn')).forEach(btn => {
        btn.classList.toggle('btn-primary', btn.dataset.mat === materia);
        btn.classList.toggle('btn-outline-secondary', btn.dataset.mat !== materia);
      });
    }

    // status color
    const statusEl = document.getElementById(`status-${id}`);
    if (statusEl) {
      if (d.current_cook) {
        statusEl.innerText = 'EM COZIMENTO';
        statusEl.style.background = '#d32f2f';
        statusEl.style.color = 'white';
      } else if (d.current_tritura) {
        statusEl.innerText = 'EM TRITURAÇÃO';
        statusEl.style.background = '#f39c12';
        statusEl.style.color = 'white';
      } else {
        statusEl.innerText = 'PARADO';
        statusEl.style.background = '#1e6d36';
        statusEl.style.color = 'white';
      }
    }

    // enable/disable buttons based on state
    const startBtn = document.querySelector(`.btn-start[data-id="${id}"]`);
    const finishTBtn = document.querySelector(`.btn-finish-trit[data-id="${id}"]`);
    const finishCookBtn = document.querySelector(`.btn-finish-cook[data-id="${id}"]`);
    const dischargeBtn = document.querySelector(`.btn-discharge-op[data-id="${id}"]`);

    // default disable
    [startBtn, finishTBtn, finishCookBtn, dischargeBtn].forEach(b=> b && b.classList.add('disabled'));

    if (d.current_tritura && !d.current_cook) {
      // currently triturando
      startBtn && startBtn.classList.add('disabled');
      finishTBtn && finishTBtn.classList.remove('disabled');
    } else if (d.current_cook) {
      // cooking
      finishCookBtn && finishCookBtn.classList.remove('disabled');
      startBtn && startBtn.classList.add('disabled');
    } else {
      // idle
      startBtn && startBtn.classList.remove('disabled');
    }
  }

  function setupMateriaButtons(d) {
    const id = d.id;
    const materiaBtns = document.querySelectorAll(`.materia-btn[data-did="${id}"]`);
    materiaBtns.forEach(btn => {
      btn.onclick = (ev) => {
        const mat = btn.dataset.mat;
        stateCache[id] = stateCache[id] || {};
        stateCache[id].materia_prima = mat;
        applyRowState(d);
        log(`Digestor ${id}: matéria-prima selecionada -> ${mat}`);
      };
    });
  }

  function bindButtons(d) {
    const id = d.id;
    // START Trit
    document.querySelectorAll(`.btn-start[data-id="${id}"]`).forEach(btn => {
      btn.onclick = async () => {
        if (btn.classList.contains('disabled')) return;
        // require materia selected
        const st = (stateCache[id] && stateCache[id].materia_prima);
        if (!st) { alert('Selecione a matéria-prima (Osso ou Barrigada) antes de iniciar.'); return; }

        const toneladas = prompt('Toneladas solicitadas (ex: 8):', '8');
        if (!toneladas) return;
        try {
          const res = await fetch('/api/trituracao/start', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ digestor_id: id, from_tova_id: 1, toneladas_solicitadas: toneladas })
          });
          const data = await res.json();
          if (res.ok) {
            stateCache[id] = stateCache[id] || {};
            stateCache[id].last_trit_id = data.trituration_id || data.trituration_id;
            stateCache[id].materia_prima = st;
            log(`Digestor ${id}: Trituração iniciada (id=${stateCache[id].last_trit_id})`);
            // request fresh state (server will broadcast)
            socket.emit('ping');
          } else {
            alert('Erro ao iniciar trituração: ' + (data.error || res.statusText));
          }
        } catch (e) {
          console.error(e); alert('Erro de rede');
        }
      };
    });

    // FINISH tritura
    document.querySelectorAll(`.btn-finish-trit[data-id="${id}"]`).forEach(btn => {
      btn.onclick = async () => {
        if (btn.classList.contains('disabled')) return;
        const tritId = (stateCache[id] && stateCache[id].last_trit_id);
        const toneladas = prompt('Toneladas trituradas (ex: 7.8):', '');
        if (!tritId) {
          alert('Não foi possível identificar a trituração. Recarregue a página.');
          return;
        }
        try {
          const res = await fetch('/api/trituracao/finish', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ trituration_id: tritId, toneladas_trituradas: toneladas || 0 })
          });
          const data = await res.json();
          if (!res.ok) { alert('Erro: ' + (data.error || res.statusText)); return; }
          log(`Digestor ${id}: Trituração finalizada (id=${tritId}). Iniciando cozimento...`);

          // start cooking automatically
          const cookRes = await fetch('/api/cooking/start', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ digestor_id: id, trituration_id: tritId })
          });
          if (cookRes.ok) {
            const cookJson = await cookRes.json();
            stateCache[id].last_cook_id = cookJson.cooking_id || cookJson.cooking_id;
            log(`Digestor ${id}: Cozimento iniciado (id=${stateCache[id].last_cook_id})`);
          } else {
            log(`Erro iniciando cozimento no server: ${cookRes.statusText}`);
          }
          socket.emit('ping');
        } catch (e) { console.error(e); alert('Erro de rede'); }
      };
    });

    // FINISH cook
    document.querySelectorAll(`.btn-finish-cook[data-id="${id}"]`).forEach(btn => {
      btn.onclick = async () => {
        if (btn.classList.contains('disabled')) return;
        const cookId = stateCache[id] && stateCache[id].last_cook_id;
        if (!cookId) { alert('Cozimento não encontrado.'); return; }
        try {
          const res = await fetch('/api/cooking/finish', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ cooking_id: cookId })
          });
          const data = await res.json();
          if (res.ok) {
            log(`Digestor ${id}: Cozimento finalizado (id=${cookId}). Aguardando descarregar.`);
            // enable discharge
            socket.emit('ping');
          } else {
            alert('Erro ao finalizar cozimento: ' + (data.error || res.statusText));
          }
        } catch (e) { console.error(e); alert('Erro de rede'); }
      };
    });

    // DISCHARGE
    document.querySelectorAll(`.btn-discharge-op[data-id="${id}"]`).forEach(btn => {
      btn.onclick = async () => {
        if (btn.classList.contains('disabled')) return;
        const tritId = stateCache[id] && stateCache[id].last_trit_id;
        const cookId = stateCache[id] && stateCache[id].last_cook_id;
        const toneladas = prompt('Toneladas descarregadas (ex: 7.5):', '');
        try {
          const res = await fetch('/api/digestor/discharge', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ digestor_id: id, trituration_cycle_id: tritId, cooking_cycle_id: cookId, toneladas_discarded: toneladas || 0 })
          });
          const data = await res.json();
          if (res.ok) {
            log(`Digestor ${id}: Descarregado (discharge_id=${data.discharge_id}). Processo finalizado.`);
            // clear local state for this digestor
            delete stateCache[id];
            socket.emit('ping');
          } else {
            alert('Erro ao descarregar: ' + (data.error || res.statusText));
          }
        } catch (e) { console.error(e); alert('Erro de rede'); }
      };
    });
  }

  // Update UI with digestors list
  socket.on('digestors:update', (list) => {
    // keep selected materia_prima from stateCache
    list.forEach(d => {
      const sc = stateCache[d.id] || {};
      // propagate materia persistently in UI only (server not storing yet)
      if (sc.materia_prima) d._materia_prima = sc.materia_prima;
    });

    renderDigestores(Array.isArray(list) ? list : []);
    // start timers
    startTimers(list);
  });

  // ping/pong support
  socket.on('connect', () => {
    log('Socket conectado: ' + socket.id);
    socket.emit('ping');
  });
  socket.on('pong', () => { /* ignore */ });

  // timers: update visible durations by reading timestamps in the digestor objects stored in DOM (we'll request server state every few seconds by sockets)
  function startTimers(list) {
    // clear intervals
    Object.values(timers).forEach(i => clearInterval(i));
    list.forEach(d => {
      const id = d.id;
      // get timestamps from d.current_tritura and d.current_cooking
      const trit = d.current_tritura;
      const cook = d.current_cooking;

      // store last totals (if finished)
      if (trit && trit.end_tritura_at) {
        document.getElementById(`trit-total-${id}`).innerText = trit.toneladas_trituradas ? String(trit.toneladas_trituradas) + ' tn' : '--';
      }
      if (cook && cook.end_cook_at) {
        document.getElementById(`cook-total-${id}`).innerText = 'Finalizado';
      }

      // create interval updater (every 1s)
      timers[id] = setInterval(() => {
        // refresh from latest known server snapshot: we read data from DOM attributes? Simpler: fetch /api/digestors single
        fetch('/api/digestors').then(r=>r.json()).then(all=>{
          const dd = all.find(x => x.id === id);
          if (!dd) return;
          // trit timer
          if (dd.current_tritura && !dd.current_tritura.end_tritura_at) {
            const started = new Date(dd.current_tritura.start_tritura_at).getTime();
            const now = Date.now();
            document.getElementById(`trit-time-${id}`).innerText = formatDuration(now - started);
          } else if (dd.current_tritura && dd.current_tritura.end_tritura_at) {
            // finished -> show elapsed
            const start = new Date(dd.current_tritura.start_tritura_at).getTime();
            const end = new Date(dd.current_tritura.end_tritura_at).getTime();
            document.getElementById(`trit-time-${id}`).innerText = formatDuration(end - start);
            document.getElementById(`trit-total-${id}`).innerText = (dd.current_tritura.toneladas_trituradas || '--') + ' tn';
          } else {
            document.getElementById(`trit-time-${id}`).innerText = '--:--';
          }

          // cook timer
          if (dd.current_cooking && !dd.current_cooking.end_cook_at) {
            const started = new Date(dd.current_cooking.start_cook_at).getTime();
            document.getElementById(`cook-time-${id}`).innerText = formatDuration(Date.now() - started);
          } else if (dd.current_cooking && dd.current_cooking.end_cook_at) {
            const start = new Date(dd.current_cooking.start_cook_at).getTime();
            const end = new Date(dd.current_cooking.end_cook_at).getTime();
            document.getElementById(`cook-time-${id}`).innerText = formatDuration(end - start);
            document.getElementById(`cook-total-${id}`).innerText = 'Finalizado';
          } else {
            document.getElementById(`cook-time-${id}`).innerText = '--:--';
          }
          // update row enable/disable visually
          applyRowState(dd);
        }).catch(()=>{});
      }, 1000);
    });
  }

  // initial fetch if socket not responding yet
  fetch('/api/digestors').then(r=>r.json()).then(list => {
    socket.emit('pong'); // noop to force
    renderDigestores(list);
    startTimers(list);
  }).catch(()=>{});
})();
