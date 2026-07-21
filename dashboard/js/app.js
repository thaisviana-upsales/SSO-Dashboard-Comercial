/**
 * app.js — Orquestrador principal do Dashboard SSO
 * Gerencia: estado, filtros, KPIs, tabela, drawer, export
 */
(() => {
  // ── Estado ────────────────────────────────────────────────────────────
  const state = {
    months: [],
    vendedor: '',
    fonte: '',
    status: '',
    tipo: '',
    dateStart: null,
    dateEnd: null,
    vendedorMetric: 'propostas',
    tableSort: { col: 'propostas', asc: false },
  };

  let filtered = [];
  const ALL = SSO_DATA;  // dados completos da Etapa 1

  // ── Utils ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const fmtBRL = v => Engine.fmtBRL(v);
  const fmtPct = v => Engine.fmtPct(v);
  const fmtNum = v => Engine.fmtNum(v);
  const fmtShort = v => Engine.fmtBRLShort(v);

  // ── Aplicar filtros ───────────────────────────────────────────────────
  function applyFilters() {
    filtered = Engine.filter(ALL, {
      months:    state.months,
      vendedor:  state.vendedor ? [state.vendedor] : [],
      fonte:     state.fonte    ? [state.fonte]    : [],
      status:    state.status   ? [state.status]   : [],
      tipo:      state.tipo     ? [state.tipo]     : [],
      dateStart: state.dateStart,
      dateEnd:   state.dateEnd,
    });
    renderAll();
  }

  // ── KPIs ──────────────────────────────────────────────────────────────
  function renderKPIs() {
    const k = Engine.kpis(filtered);

    // Comparação com período anterior (quando 1 mês selecionado)
    let prev = null;
    if (state.months.length === 1) {
      const m = state.months[0];
      const prevMonth = m - 1;
      if (prevMonth >= 1) {
        const prevRecs = Engine.filter(ALL, { months: [prevMonth], vendedor: state.vendedor ? [state.vendedor] : [], fonte: state.fonte ? [state.fonte] : [], status: state.status ? [state.status] : [], tipo: state.tipo ? [state.tipo] : [] });
        prev = Engine.kpis(prevRecs);
      }
    }

    setKPI('leads', fmtNum(k.leads), k, prev, 'leads', false);
    setKPI('propostas', fmtNum(k.propostas), k, prev, 'propostas', false);
    setKPI('previsao', fmtShort(k.prevFat), k, prev, 'prevFat', true);
    setKPI('vendas', fmtNum(k.vendas), k, prev, 'vendas', false);
    setKPI('faturamento', fmtShort(k.fatVendas), k, prev, 'fatVendas', true);
    setKPI('conversao', fmtPct(k.conversao), k, prev, 'conversao', false);

    // Período label
    const labels = state.months.length === 0
      ? 'Jan a Jul 2026 — periodo completo'
      : state.months.map(m => Engine.MES_NOME_FULL[m]).join(', ') + ' 2026';
    $('cockpit-period').textContent = labels;
  }

  function setKPI(id, value, k, prev, field, isMoney) {
    $('v-' + id).textContent = value;
    const deltaEl = $('d-' + id);
    if (!deltaEl) return;
    if (!prev || prev[field] === undefined) { deltaEl.textContent = ''; return; }
    const diff = k[field] - prev[field];
    const pct = prev[field] !== 0 ? (diff / prev[field]) * 100 : 0;
    if (Math.abs(pct) < 0.1) { deltaEl.textContent = 'Estavel'; deltaEl.className = 'kpi-delta neutral'; return; }
    const up = diff > 0;
    const arrow = up ? '▲' : '▼';
    const cls = up ? 'up' : 'down';
    deltaEl.textContent = `${arrow} ${Math.abs(pct).toFixed(1).replace('.', ',')}% vs mês anterior`;
    deltaEl.className = 'kpi-delta ' + cls;
  }

  // ── Gráficos ──────────────────────────────────────────────────────────
  function renderCharts() {
    const allMonths = state.months.length ? state.months : Engine.ALL_MONTHS;
    const monthData = Engine.byMonth(filtered, allMonths);
    Charts.renderVolume(monthData);
    Charts.renderFinancial(monthData);

    const statusData = Engine.byStatus(filtered);
    const total = filtered.length;
    Charts.renderDonut(statusData, total);

    const tiposData = Engine.byTipoContrato(filtered);
    Charts.renderTipos(tiposData, tipo => {
      state.tipo = tipo;
      $('sel-tipo').value = tipo;
      applyFilters();
      updateChips();
    });

    Charts.renderFonte(Engine.byFonte(filtered));
    Charts.renderVendedores(Engine.byVendedor(filtered), state.vendedorMetric);
  }

  // ── Tabela ────────────────────────────────────────────────────────────
  function renderTable() {
    const data = Engine.byVendedor(filtered);
    const { col, asc } = state.tableSort;

    data.sort((a, b) => {
      let va = a[col], vb = b[col];
      if (typeof va === 'string') return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      return asc ? va - vb : vb - va;
    });

    // Atualiza setas
    ['vendedor', 'leads', 'propostas', 'vendas', 'conversao', 'prevFat', 'fatVendas'].forEach(c => {
      const el = $('sa-' + c);
      if (el) el.textContent = c === col ? (asc ? ' ▲' : ' ▼') : ' ·';
      const th = document.querySelector(`th[data-col="${c}"]`);
      if (th) th.classList.toggle('sorted', c === col);
    });

    const body = $('table-body');
    if (!data.length) { body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--gray-400);font-style:italic">Sem dados para o filtro selecionado</td></tr>`; $('table-foot').innerHTML = ''; return; }

    body.innerHTML = data.map(d => `
      <tr>
        <td class="td-vendor">${d.vendedor}</td>
        <td>${fmtNum(d.leads)}</td>
        <td>${fmtNum(d.propostas)}</td>
        <td>${fmtNum(d.vendas)}</td>
        <td class="td-pct">${fmtPct(d.conversao)}</td>
        <td>${fmtBRL(d.prevFat)}</td>
        <td>${fmtBRL(d.fatVendas)}</td>
      </tr>`).join('');

    const tot = Engine.kpis(filtered);
    $('table-foot').innerHTML = `<tr>
      <td>Total</td>
      <td>${fmtNum(tot.leads)}</td>
      <td>${fmtNum(tot.propostas)}</td>
      <td>${fmtNum(tot.vendas)}</td>
      <td class="td-pct">${fmtPct(tot.conversao)}</td>
      <td>${fmtBRL(tot.prevFat)}</td>
      <td>${fmtBRL(tot.fatVendas)}</td>
    </tr>`;
  }

  // ── Drawer ────────────────────────────────────────────────────────────
  let drawerData = [];

  function openDrawer() {
    drawerData = Engine.byTipoContrato(filtered);
    renderDrawerList(drawerData);
    $('drawer-ranking').classList.add('open');
    $('drawer-overlay').classList.add('open');
    $('drawer-search').value = '';
  }

  function closeDrawer() {
    $('drawer-ranking').classList.remove('open');
    $('drawer-overlay').classList.remove('open');
  }

  function renderDrawerList(data) {
    const max = Math.max(...data.map(d => d.propostas), 1);
    $('drawer-body').innerHTML = data.length
      ? data.map((d, i) => `
          <div class="drawer-row" data-tipo="${escHTML(d.tipo)}">
            <span class="drawer-rank">${i + 1}</span>
            <span class="drawer-name" title="${escHTML(d.tipo)}">${escHTML(d.tipo)}</span>
            <div class="drawer-bar-wrap"><div class="drawer-bar" style="width:${(d.propostas / max * 100).toFixed(1)}%"></div></div>
            <span class="drawer-count">${d.propostas}</span>
          </div>`).join('')
      : '<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:12px">Nenhum resultado encontrado</div>';

    $('drawer-body').querySelectorAll('.drawer-row').forEach(row => {
      row.addEventListener('click', () => {
        const tipo = row.dataset.tipo;
        state.tipo = tipo;
        $('sel-tipo').value = tipo;
        closeDrawer();
        applyFilters();
        updateChips();
      });
    });
  }

  function escHTML(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ── Chips de filtros ativos ───────────────────────────────────────────
  function updateChips() {
    const bar = $('chips-bar');
    bar.innerHTML = '';
    const hasFilter = state.months.length || state.vendedor || state.fonte || state.status || state.tipo || state.dateStart;
    $('btn-clear').disabled = !hasFilter;
    $('restore-btn').style.display = hasFilter ? '' : 'none';

    const add = (label, clear) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = `<span>${escHTML(label)}</span><button class="chip-remove" title="Remover"><svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 1l8 8M9 1L1 9"/></svg></button>`;
      chip.querySelector('.chip-remove').addEventListener('click', clear);
      bar.appendChild(chip);
    };

    const fmtBRd = d => d ? d.split('-').reverse().join('/') : '';
    if (state.months.length) {
      const labels = state.months.map(m => Engine.MES_NOME[m]).join(', ');
      add('Periodo: ' + labels, () => { state.months = []; syncMonthPills(); applyFilters(); updateChips(); });
    }
    if (state.vendedor) add('Vendedor: ' + state.vendedor, () => { state.vendedor = ''; $('sel-vendedor').value = ''; applyFilters(); updateChips(); });
    if (state.fonte) add('Fonte: ' + state.fonte, () => { state.fonte = ''; $('sel-fonte').value = ''; applyFilters(); updateChips(); });
    if (state.status) add('Status: ' + state.status, () => { state.status = ''; $('sel-status').value = ''; applyFilters(); updateChips(); });
    if (state.tipo) {
      const label = state.tipo.length > 28 ? state.tipo.slice(0, 26) + '…' : state.tipo;
      add('Tipo: ' + label, () => { state.tipo = ''; $('sel-tipo').value = ''; applyFilters(); updateChips(); });
    }
    if (state.dateStart) {
      const lbl = state.dateEnd && state.dateEnd !== state.dateStart
        ? `Data: ${fmtBRd(state.dateStart)} – ${fmtBRd(state.dateEnd)}`
        : `Data: ${fmtBRd(state.dateStart)}`;
      add(lbl, () => {
        state.dateStart = null; state.dateEnd = null;
        if (window._mainDP) window._mainDP.clear();
        document.getElementById('dp-hist-warning')?.classList.remove('visible');
        applyFilters(); updateChips();
      });
    }
  }

  function syncMonthPills() {
    document.querySelectorAll('.month-pill').forEach(btn => {
      const m = +btn.dataset.month;
      const active = m === 0 ? state.months.length === 0 : state.months.includes(m);
      btn.classList.toggle('active', active);
    });
  }

  // ── Populate selects ──────────────────────────────────────────────────
  function populateSelects() {
    const vendors = Engine.uniqueValues(ALL, 'vendedor');
    const fontes = Engine.uniqueValues(ALL, 'fonte_lead');
    const statuses = ['CONTRATO FECHADO', 'PROPOSTA ENVIADA', 'RECUSADO'];
    const tipos = Engine.uniqueValues(ALL, 'tipo_contrato');

    fillSelect('sel-vendedor', 'Vendedor', vendors);
    fillSelect('sel-fonte', 'Fonte do Lead', fontes);
    fillSelect('sel-status', 'Status', statuses);
    fillSelect('sel-tipo', 'Tipo de Contrato', tipos);
  }

  function fillSelect(id, placeholder, values) {
    const sel = $(id);
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      values.map(v => `<option value="${escHTML(v)}">${escHTML(v)}</option>`).join('');
  }

  // ── Exportar CSV ──────────────────────────────────────────────────────
  function exportCSV() {
    const data = Engine.byVendedor(filtered);
    const tot = Engine.kpis(filtered);
    const header = 'Vendedor,Leads,Propostas,Vendas,Conversao (%),Prev.Faturamento (R$),Fat.Vendas (R$)\n';
    const rows = data.map(d => `"${d.vendedor}",${d.leads},${d.propostas},${d.vendas},${d.conversao.toFixed(2)},${d.prevFat.toFixed(2)},${d.fatVendas.toFixed(2)}`).join('\n');
    const footer = `\nTOTAL,${tot.leads},${tot.propostas},${tot.vendas},${tot.conversao.toFixed(2)},${tot.prevFat.toFixed(2)},${tot.fatVendas.toFixed(2)}`;
    const blob = new Blob(['\uFEFF' + header + rows + footer], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'SSO_Dashboard_Exportacao.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Renderização total ────────────────────────────────────────────────
  function renderAll() {
    renderKPIs();
    renderCharts();
    renderTable();
  }

  // ── Wiring de eventos ─────────────────────────────────────────────────
  function wireEvents() {
    // Meses
    document.querySelectorAll('.month-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = +btn.dataset.month;
        if (m === 0) {
          state.months = [];
        } else {
          const idx = state.months.indexOf(m);
          if (idx >= 0) state.months.splice(idx, 1); else state.months.push(m);
          state.months.sort((a, b) => a - b);
        }
        syncMonthPills();
        applyFilters();
        updateChips();
      });
    });

    // Selects
    $('sel-vendedor').addEventListener('change', e => { state.vendedor = e.target.value; applyFilters(); updateChips(); });
    $('sel-fonte').addEventListener('change', e => { state.fonte = e.target.value; applyFilters(); updateChips(); });
    $('sel-status').addEventListener('change', e => { state.status = e.target.value; applyFilters(); updateChips(); });
    $('sel-tipo').addEventListener('change', e => { state.tipo = e.target.value; applyFilters(); updateChips(); });

    // Limpar tudo
    $('btn-clear').addEventListener('click', () => {
      state.months = []; state.vendedor = ''; state.fonte = ''; state.status = ''; state.tipo = '';
      state.dateStart = null; state.dateEnd = null;
      $('sel-vendedor').value = ''; $('sel-fonte').value = ''; $('sel-status').value = ''; $('sel-tipo').value = '';
      if (window._mainDP) window._mainDP.clear();
      document.getElementById('dp-hist-warning')?.classList.remove('visible');
      syncMonthPills(); applyFilters(); updateChips();
    });

    $('btn-restore').addEventListener('click', () => $('btn-clear').click());

    // Drawer
    $('btn-open-drawer').addEventListener('click', openDrawer);
    $('btn-close-drawer').addEventListener('click', closeDrawer);
    $('drawer-overlay').addEventListener('click', closeDrawer);
    $('drawer-search').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      renderDrawerList(q ? drawerData.filter(d => d.tipo.toLowerCase().includes(q)) : drawerData);
    });

    // Métrica vendedores
    document.querySelectorAll('.metric-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.metric-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.vendedorMetric = btn.dataset.metric;
        Charts.renderVendedores(Engine.byVendedor(filtered), state.vendedorMetric);
      });
    });

    // Tabela — ordenação
    document.querySelectorAll('.exec-table th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (state.tableSort.col === col) state.tableSort.asc = !state.tableSort.asc;
        else { state.tableSort.col = col; state.tableSort.asc = col === 'vendedor'; }
        renderTable();
      });
    });

    // Export
    $('btn-export-csv').addEventListener('click', exportCSV);
    $('btn-export-pdf').addEventListener('click', () => window.print());

    // Keyboard ESC fecha drawer
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────
  function init() {
    $('last-update').textContent = 'Dados de: ' + SSO_EXPORTED_AT;
    populateSelects();
    wireEvents();

    // DatePicker — inicializado em try/catch isolado para não bloquear o restante
    try {
      const dpTrigger = document.getElementById('dp-trigger-main');
      if (dpTrigger && typeof SSODatePicker !== 'undefined') {
        window._mainDP = new SSODatePicker({
          triggerEl: dpTrigger,
          placeholder: 'Data específica',
          onApply: function(start, end) {
            state.dateStart = start;
            state.dateEnd   = end || start;
            const warn = document.getElementById('dp-hist-warning');
            if (warn) warn.classList.toggle('visible', !!(start && start < '2026-07-01' && (!end || end < '2026-07-01')));
            applyFilters();
            updateChips();
          },
        });
      }
    } catch(e) {
      console.warn('[SSO] DatePicker init falhou:', e);
    }

    filtered = ALL;
    renderAll();
    updateChips();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
