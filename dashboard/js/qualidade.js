/**
 * qualidade.js — Controlador da página Qualidade de Vendas SSO
 * Todos os dados vêm da camada validada (Etapa 1).
 * Sem status no filtro — não distorce a conversão.
 */
(() => {
  // ── Estado ────────────────────────────────────────────────────────────
  const state = {
    months: [], vendedor: '', fonte: '', tipo: '', curva: '',
    dateStart: null, dateEnd: null,
    tableSort: { col: 'fatVendas', asc: false },
  };

  let filtered = [];
  // ALL: histórico estático jan-jun (data.js) + live jul+ (Supabase).
  // Mutável para recarregarDados() poder atualizar in-place.
  const ALL = [...SSO_DATA];  // 1.157 registros EXCEL_HISTORICO jan-jun
  const $ = id => document.getElementById(id);
  const { fmtBRL, fmtPct, fmtNum, fmtBRLShort, MES_NOME, MES_NOME_FULL, ALL_MONTHS,
    CURVAS_ORDEM, CURVAS_FAIXAS, CURVAS_CORES } = Engine;

  const CURVA_CSS = {
    'A+': 'aplus', 'A': 'a', 'B': 'b', 'C': 'c', 'D': 'd', 'Sem classificação': 'sem'
  };

  // ── Chart instances ───────────────────────────────────────────────────
  const charts = {};
  const BASE_FONT = { family: "'Inter', system-ui, sans-serif", size: 11 };
  const BASE_GRID = { color: 'rgba(0,0,0,.04)', drawTicks: false };

  function destroyChart(id) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  }

  // ── Filtrar ───────────────────────────────────────────────────────────
  function applyFilters() {
    filtered = Engine.filterQualidade(ALL, state);
    renderAll();
  }

  // ── KPIs Gerais ───────────────────────────────────────────────────────
  function renderCockpit(curvaData) {
    const totProp = curvaData.reduce((s, d) => s + d.propostas, 0);
    const totVend = curvaData.reduce((s, d) => s + d.vendas, 0);
    const totFat = curvaData.reduce((s, d) => s + d.fatVendas, 0);
    const totVCV = curvaData.reduce((s, d) => s + (d.vendasSemValor !== undefined ? d.vendas - d.vendasSemValor : 0), 0);
    const conv = totProp > 0 ? totVend / totProp * 100 : 0;
    const ticket = totVCV > 0 ? totFat / totVCV : null;

    $('v-propostas').textContent = fmtNum(totProp);
    $('v-vendas').textContent = fmtNum(totVend);
    $('v-conversao').textContent = fmtPct(conv);
    $('v-faturamento').textContent = fmtBRLShort(totFat);
    $('v-ticket').textContent = ticket ? fmtBRLShort(ticket) : '—';

    // Maior conversão (propostas > 0)
    const comProp = curvaData.filter(d => d.propostas > 0);
    if (comProp.length) {
      const mc = comProp.reduce((a, b) => b.conversao > a.conversao ? b : a);
      const badgeLbl = mc.curva === 'Sem classificação' ? 'S/C' : mc.curva;
      $('badge-maior-conv').textContent = badgeLbl;
      $('badge-maior-conv').style.background = mc.cor;
      $('v-maior-conv-pct').textContent = fmtPct(mc.conversao);
      $('v-maior-conv-label').textContent = mc.faixa;
    }

    // Maior faturamento
    const mf = curvaData.reduce((a, b) => b.fatVendas > a.fatVendas ? b : a);
    const badgeFatLbl = mf.curva === 'Sem classificação' ? 'S/C' : mf.curva;
    $('badge-maior-fat').textContent = badgeFatLbl;
    $('badge-maior-fat').style.background = mf.cor;
    $('v-maior-fat-val').textContent = fmtBRLShort(mf.fatVendas);
    $('v-maior-fat-label').textContent = mf.faixa;

    // Período
    const lbl = state.months.length === 0
      ? 'Jan a Jul 2026 — período completo'
      : state.months.map(m => MES_NOME_FULL[m]).join(', ') + ' 2026';
    $('cockpit-period').textContent = lbl;
  }

  // ── Cards por Curva ───────────────────────────────────────────────────
  function renderCurvaCards(curvaData) {
    const maxFat = Math.max(...curvaData.map(d => d.fatVendas), 1);
    const grid = $('curva-cards-grid');
    grid.innerHTML = curvaData.map(d => {
      const css = CURVA_CSS[d.curva] || 'sem';
      const isSelected = state.curva === d.curva;
      const partBar = (d.participacaoFat / 100 * 100).toFixed(1);
      return `
        <div class="curva-card ${isSelected ? 'selected border-' + css : ''}" data-curva="${d.curva}">
          <div class="curva-card-header">
            <span class="curva-badge curva-${css}">${d.curva}</span>
            <span class="curva-faixa">${d.faixa}</span>
          </div>
          <div class="curva-stat">
            <div class="curva-stat-row">
              <span class="curva-stat-label">Propostas</span>
              <span class="curva-stat-value">${fmtNum(d.propostas)}</span>
            </div>
            <div class="curva-stat-row">
              <span class="curva-stat-label">Vendas</span>
              <span class="curva-stat-value">${fmtNum(d.vendas)}</span>
            </div>
            <div class="curva-stat-row">
              <span class="curva-stat-label">Conversão</span>
              <span class="curva-stat-value highlight" style="color:${d.conversao >= 50 ? 'var(--success)' : d.conversao < 30 ? 'var(--alert)' : 'var(--copper)'}">${fmtPct(d.conversao)}</span>
            </div>
            <div class="curva-stat-row">
              <span class="curva-stat-label">Faturamento</span>
              <span class="curva-stat-value">${fmtBRLShort(d.fatVendas)}</span>
            </div>
            <div class="curva-stat-row">
              <span class="curva-stat-label">Ticket Médio</span>
              <span class="curva-stat-value">${d.ticketMedio ? fmtBRLShort(d.ticketMedio) : '—'}</span>
            </div>
          </div>
          <div style="font-size:10px;color:var(--gray-400);margin-top:8px;text-align:right">${fmtPct(d.participacaoFat)} do faturamento</div>
          <div class="curva-participacao-bar">
            <div class="curva-participacao-fill curva-${css}" style="width:${partBar}%"></div>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.curva-card').forEach(card => {
      card.addEventListener('click', () => {
        const c = card.dataset.curva;
        state.curva = state.curva === c ? '' : c;
        if ($('sel-curva')) $('sel-curva').value = state.curva;
        applyFilters(); updateChips();
      });
    });
  }

  // ── Gráfico 1: Propostas × Vendas ─────────────────────────────────────
  function renderChartPropVend(curvaData) {
    destroyChart('pv');
    const ctx = $('chart-prop-vend')?.getContext('2d');
    if (!ctx) return;
    charts['pv'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: curvaData.map(d => d.curva),
        datasets: [
          { label: 'Propostas', data: curvaData.map(d => d.propostas), backgroundColor: 'rgba(133,32,12,.18)', borderColor: '#85200C', borderWidth: 1.5, borderRadius: 4 },
          { label: 'Vendas', data: curvaData.map(d => d.vendas), backgroundColor: curvaData.map(d => d.cor + 'CC'), borderColor: curvaData.map(d => d.cor), borderWidth: 1, borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: BASE_FONT, usePointStyle: true, padding: 14, color: '#475467' } },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: BASE_FONT, color: '#667085' }, border: { display: false } },
          y: { grid: BASE_GRID, beginAtZero: true, ticks: { font: BASE_FONT, color: '#667085', padding: 6 }, border: { display: false } },
        },
      },
    });
  }

  // ── Gráfico 2: Conversão por Curva + linha de referência ──────────────
  function renderChartConversao(curvaData, convGeral) {
    destroyChart('conv');
    const ctx = $('chart-conversao')?.getContext('2d');
    if (!ctx) return;
    charts['conv'] = new Chart(ctx, {
      data: {
        labels: curvaData.map(d => d.curva),
        datasets: [
          {
            type: 'bar', label: 'Conversão (%)', data: curvaData.map(d => d.conversao),
            backgroundColor: curvaData.map(d => d.cor + 'BB'), borderColor: curvaData.map(d => d.cor),
            borderWidth: 1.5, borderRadius: 4, barThickness: 20, indexAxis: 'y',
          },
          {
            type: 'line', label: `Geral (${convGeral.toFixed(2).replace('.', ',')}%)`,
            data: curvaData.map(() => convGeral),
            borderColor: '#121212', borderWidth: 1.5, borderDash: [5, 4],
            pointRadius: 0, fill: false, indexAxis: 'y',
          },
        ],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: BASE_FONT, usePointStyle: true, padding: 14, color: '#475467' } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${typeof c.parsed.x === 'number' ? c.parsed.x.toFixed(2).replace('.', ',') + '%' : ''}` } }
        },
        scales: {
          x: { grid: BASE_GRID, beginAtZero: true, ticks: { font: BASE_FONT, color: '#667085', callback: v => v.toFixed(0) + '%' }, border: { display: false } },
          y: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: BASE_FONT, color: '#475467' }, border: { display: false } },
        },
      },
    });
  }

  // ── Gráfico 3: Faturamento + Ticket Médio ─────────────────────────────
  function renderChartFatTicket(curvaData) {
    destroyChart('ft');
    const ctx = $('chart-fat-ticket')?.getContext('2d');
    if (!ctx) return;
    charts['ft'] = new Chart(ctx, {
      data: {
        labels: curvaData.map(d => d.curva),
        datasets: [
          { type: 'bar', label: 'Faturamento', data: curvaData.map(d => d.fatVendas), backgroundColor: curvaData.map(d => d.cor + 'AA'), borderColor: curvaData.map(d => d.cor), borderWidth: 1.5, borderRadius: 4, yAxisID: 'y' },
          { type: 'line', label: 'Ticket Médio', data: curvaData.map(d => d.ticketMedio || 0), borderColor: '#121212', backgroundColor: 'rgba(18,18,18,.08)', pointBackgroundColor: '#121212', pointRadius: 5, fill: false, tension: .3, borderWidth: 2, yAxisID: 'y2' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: BASE_FONT, usePointStyle: true, padding: 14, color: '#475467' } },
          tooltip: { mode: 'index', intersect: false, callbacks: { label: c => c.datasetIndex === 0 ? ` Faturamento: ${fmtBRL(c.parsed.y)}` : ` Ticket Médio: ${fmtBRL(c.parsed.y)}` } }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: BASE_FONT, color: '#667085' }, border: { display: false } },
          y: { position: 'left', grid: BASE_GRID, beginAtZero: true, ticks: { font: BASE_FONT, color: '#667085', callback: v => fmtBRLShort(v) }, border: { display: false } },
          y2: { position: 'right', grid: { display: false }, beginAtZero: true, ticks: { font: BASE_FONT, color: '#667085', callback: v => fmtBRLShort(v) }, border: { display: false } },
        },
      },
    });
  }

  // ── Gráfico 4: Matriz de Qualidade (Bubble) ───────────────────────────
  function renderChartMatriz(curvaData) {
    destroyChart('mtz');
    const ctx = $('chart-matriz')?.getContext('2d');
    if (!ctx) return;
    const maxFat = Math.max(...curvaData.filter(d => d.fatVendas > 0).map(d => d.fatVendas), 1);
    const datasets = curvaData
      .filter(d => d.propostas > 0)
      .map(d => ({
        label: d.curva,
        data: [{ x: +d.conversao.toFixed(2), y: d.ticketMedio ? +d.ticketMedio.toFixed(2) : 0, r: Math.max(8, Math.sqrt(d.fatVendas / maxFat) * 38) }],
        backgroundColor: d.cor + '99', borderColor: d.cor, borderWidth: 2,
      }));
    charts['mtz'] = new Chart(ctx, {
      type: 'bubble',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: BASE_FONT, usePointStyle: true, pointStyleWidth: 10, padding: 12, color: '#475467' } },
          tooltip: {
            callbacks: {
              label: c => {
                const d = curvaData.find(x => x.curva === c.dataset.label);
                if (!d) return '';
                return [`  ${d.curva} (${d.faixa})`, `  Conversão: ${fmtPct(d.conversao)}`, `  Ticket Médio: ${d.ticketMedio ? fmtBRL(d.ticketMedio) : '—'}`, `  Faturamento: ${fmtBRL(d.fatVendas)}`];
              },
            }
          },
        },
        scales: {
          x: { title: { display: true, text: 'Conversão (%)', font: BASE_FONT, color: '#667085' }, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: BASE_FONT, color: '#667085', callback: v => v + '%' }, border: { display: false } },
          y: { title: { display: true, text: 'Ticket Médio (R$)', font: BASE_FONT, color: '#667085' }, grid: BASE_GRID, beginAtZero: true, ticks: { font: BASE_FONT, color: '#667085', callback: v => fmtBRLShort(v) }, border: { display: false } },
        },
      },
    });
  }

  // ── Tabela ────────────────────────────────────────────────────────────
  function renderTable(curvaData) {
    const { col, asc } = state.tableSort;
    const sorted = [...curvaData].sort((a, b) => {
      const va = col === 'faixa' || col === 'curva' ? (a[col] || '') : (a[col] ?? -1);
      const vb = col === 'faixa' || col === 'curva' ? (b[col] || '') : (b[col] ?? -1);
      if (typeof va === 'string') return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      return asc ? va - vb : vb - va;
    });

    ['curva', 'faixa', 'propostas', 'vendas', 'conversao', 'prevFat', 'fatVendas', 'ticketMedio', 'participacaoVendas', 'participacaoFat', 'vendasSemValor'].forEach(c => {
      const el = $('sa-' + c);
      if (el) el.textContent = c === col ? (asc ? ' ▲' : ' ▼') : ' ·';
      const th = document.querySelector(`th[data-col="${c}"]`);
      if (th) th.classList.toggle('sorted', c === col);
    });

    const body = $('table-body');
    body.innerHTML = sorted.map(d => {
      const css = CURVA_CSS[d.curva] || 'sem';
      return `<tr>
        <td><div class="curva-cell"><span class="curva-dot" style="background:${d.cor}"></span><strong>${d.curva}</strong></div></td>
        <td class="td-faixa" style="text-align:left">${d.faixa}</td>
        <td>${fmtNum(d.propostas)}</td>
        <td>${fmtNum(d.vendas)}</td>
        <td class="td-pct-curva" style="color:${d.conversao >= 50 ? 'var(--success)' : d.conversao < 30 ? 'var(--alert)' : 'inherit'}">${fmtPct(d.conversao)}</td>
        <td>${fmtBRL(d.prevFat)}</td>
        <td>${fmtBRL(d.fatVendas)}</td>
        <td>${d.ticketMedio ? fmtBRL(d.ticketMedio) : '—'}</td>
        <td>${fmtPct(d.participacaoVendas)}</td>
        <td>${fmtPct(d.participacaoFat)}</td>
        <td style="color:${d.vendasSemValor > 0 ? 'var(--alert)' : 'var(--gray-400)'}">${d.vendasSemValor}</td>
      </tr>`;
    }).join('');

    const tot = curvaData.reduce((acc, d) => ({
      propostas: acc.propostas + d.propostas, vendas: acc.vendas + d.vendas,
      prevFat: acc.prevFat + d.prevFat, fatVendas: acc.fatVendas + d.fatVendas,
      vendasSemValor: acc.vendasSemValor + d.vendasSemValor,
    }), { propostas: 0, vendas: 0, prevFat: 0, fatVendas: 0, vendasSemValor: 0 });
    const totConv = tot.propostas > 0 ? tot.vendas / tot.propostas * 100 : 0;

    $('table-foot').innerHTML = `<tr>
      <td colspan="2" style="text-align:left">Total</td>
      <td>${fmtNum(tot.propostas)}</td><td>${fmtNum(tot.vendas)}</td>
      <td class="td-pct-curva">${fmtPct(totConv)}</td>
      <td>${fmtBRL(tot.prevFat)}</td><td>${fmtBRL(tot.fatVendas)}</td>
      <td>—</td><td>100,00%</td><td>100,00%</td>
      <td style="color:${tot.vendasSemValor > 0 ? 'var(--alert)' : 'var(--gray-400)'}">${tot.vendasSemValor}</td>
    </tr>`;
  }

  // ── Render completo ───────────────────────────────────────────────────
  function renderAll() {
    const curvaData = Engine.byCurva(filtered);
    const convGeral = curvaData.reduce((s, d) => s + d.vendas, 0) /
      Math.max(curvaData.reduce((s, d) => s + d.propostas, 0), 1) * 100;
    renderCockpit(curvaData);
    renderCurvaCards(curvaData);
    renderChartPropVend(curvaData);
    renderChartConversao(curvaData, convGeral);
    renderChartFatTicket(curvaData);
    renderChartMatriz(curvaData);
    renderTable(curvaData);
    if (window.Correlacoes) Correlacoes.update(filtered);
  }

  // ── Chips de filtros ativos ───────────────────────────────────────────
  const escH = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

  function updateChips() {
    const bar = $('chips-bar');
    bar.innerHTML = '';
    const has = state.months.length || state.vendedor || state.fonte || state.tipo || state.curva || state.dateStart;
    $('btn-clear').disabled = !has;
    $('restore-btn').style.display = has ? '' : 'none';

    const addChip = (label, clear) => {
      const el = document.createElement('div');
      el.className = 'chip';
      el.innerHTML = `<span>${escH(label)}</span><button class="chip-remove"><svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 1l8 8M9 1L1 9"/></svg></button>`;
      el.querySelector('.chip-remove').addEventListener('click', clear);
      bar.appendChild(el);
    };

    const fmtBR = d => d ? d.split('-').reverse().join('/') : '';
    if (state.months.length) addChip('Período: ' + state.months.map(m => MES_NOME[m]).join(', '), () => { state.months = []; syncPills(); applyFilters(); updateChips(); });
    if (state.vendedor) addChip('Vendedor: ' + state.vendedor, () => { state.vendedor = ''; $('sel-vendedor').value = ''; applyFilters(); updateChips(); });
    if (state.fonte) addChip('Fonte: ' + state.fonte, () => { state.fonte = ''; $('sel-fonte').value = ''; applyFilters(); updateChips(); });
    if (state.tipo) addChip('Tipo: ' + (state.tipo.length > 28 ? state.tipo.slice(0, 26) + '…' : state.tipo), () => { state.tipo = ''; $('sel-tipo').value = ''; applyFilters(); updateChips(); });
    if (state.curva) addChip('Curva: ' + state.curva, () => { state.curva = ''; $('sel-curva').value = ''; applyFilters(); updateChips(); });
    if (state.dateStart) {
      const lbl = state.dateEnd && state.dateEnd !== state.dateStart
        ? `Data: ${fmtBR(state.dateStart)} – ${fmtBR(state.dateEnd)}`
        : `Data: ${fmtBR(state.dateStart)}`;
      addChip(lbl, () => {
        state.dateStart = null; state.dateEnd = null;
        document.getElementById('dp-trigger-qual')?.dispatchEvent(new Event('_clear_external'));
        applyFilters(); updateChips();
        document.getElementById('dp-hist-warning')?.classList.remove('visible');
      });
    }
  }

  function syncPills() {
    document.querySelectorAll('.month-pill').forEach(b => {
      const m = +b.dataset.month;
      b.classList.toggle('active', m === 0 ? state.months.length === 0 : state.months.includes(m));
    });
  }

  // ── Populate selects ──────────────────────────────────────────────────
  function fillSel(id, placeholder, values) {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>` + values.map(v => `<option value="${escH(v)}">${escH(v)}</option>`).join('');
  }

  function populateSelects() {
    fillSel('sel-vendedor', 'Vendedor', Engine.uniqueValues(ALL, 'vendedor'));
    fillSel('sel-fonte', 'Fonte do Lead', Engine.uniqueValues(ALL, 'fonte_lead'));
    fillSel('sel-tipo', 'Tipo de Contrato', Engine.uniqueValues(ALL, 'tipo_contrato'));
    fillSel('sel-curva', 'Curva ABC', Engine.CURVAS_ORDEM);
  }

  // ── Export CSV ────────────────────────────────────────────────────────
  function exportCSV() {
    const curvaData = Engine.byCurva(filtered);
    const header = 'Curva,Faixa,Propostas,Vendas,Conversão(%),Previsão(R$),Faturamento(R$),TicketMédio(R$),Part.Vendas(%),Part.Fat.(%),VendasSemValor\n';
    const rows = curvaData.map(d =>
      `"${d.curva}","${d.faixa}",${d.propostas},${d.vendas},${d.conversao.toFixed(2)},${d.prevFat.toFixed(2)},${d.fatVendas.toFixed(2)},${d.ticketMedio ? d.ticketMedio.toFixed(2) : ''},${d.participacaoVendas.toFixed(2)},${d.participacaoFat.toFixed(2)},${d.vendasSemValor}`
    ).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'SSO_QualidadeVendas_CurvaABC.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Eventos ───────────────────────────────────────────────────────────
  function wireEvents() {
    document.querySelectorAll('.month-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = +btn.dataset.month;
        if (m === 0) { state.months = []; }
        else {
          const i = state.months.indexOf(m);
          if (i >= 0) state.months.splice(i, 1); else state.months.push(m);
          state.months.sort((a, b) => a - b);
        }
        syncPills(); applyFilters(); updateChips();
      });
    });

    $('sel-vendedor')?.addEventListener('change', e => { state.vendedor = e.target.value; applyFilters(); updateChips(); });
    $('sel-fonte')?.addEventListener('change', e => { state.fonte = e.target.value; applyFilters(); updateChips(); });
    $('sel-tipo')?.addEventListener('change', e => { state.tipo = e.target.value; applyFilters(); updateChips(); });
    $('sel-curva')?.addEventListener('change', e => { state.curva = e.target.value; applyFilters(); updateChips(); });

    $('btn-clear')?.addEventListener('click', () => {
      state.months = []; state.vendedor = ''; state.fonte = ''; state.tipo = ''; state.curva = '';
      state.dateStart = null; state.dateEnd = null;
      ['sel-vendedor', 'sel-fonte', 'sel-tipo', 'sel-curva'].forEach(id => { if ($(id)) $(id).value = ''; });
      document.getElementById('dp-hist-warning')?.classList.remove('visible');
      syncPills(); applyFilters(); updateChips();
    });
    $('btn-restore')?.addEventListener('click', () => $('btn-clear').click());
    $('btn-export-csv')?.addEventListener('click', exportCSV);
    $('btn-export-pdf')?.addEventListener('click', () => window.print());

    document.querySelectorAll('.exec-table th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (state.tableSort.col === col) state.tableSort.asc = !state.tableSort.asc;
        else { state.tableSort.col = col; state.tableSort.asc = col === 'curva' || col === 'faixa'; }
        renderTable(Engine.byCurva(filtered));
      });
    });

    // Filtro por data (DatePicker)
    document.addEventListener('qual-date-change', e => {
      state.dateStart = e.detail.start;
      state.dateEnd = e.detail.end;
      applyFilters(); updateChips();
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────
  function init() {
    $('last-update').textContent = 'Dados de: ' + SSO_EXPORTED_AT;
    populateSelects();
    wireEvents();
    filtered = ALL;
    if (window.Correlacoes) Correlacoes.init();
    renderAll();
    updateChips();

    // Carga live em segundo plano — busca GOOGLE_SHEETS_LIVE do Supabase sem
    // bloquear a UI. O histórico jan-jun (1.157 registros) é preservado intacto.
    if (typeof SSO_SUPABASE !== 'undefined') {
      SSO_SUPABASE.recarregarDados(ALL)
        .then(resultado => {
          const nowStr = new Date().toLocaleString('pt-BR');
          if ($('last-update')) {
            $('last-update').textContent =
              'Atualizado: ' + nowStr +
              ' · Histórico: ' + resultado.historico +
              ' · Live jul+: ' + resultado.live;
          }
          applyFilters();
          if (window.Correlacoes) Correlacoes.update(filtered);
        })
        .catch(err => {
          console.warn('[SSO Qualidade] Carga live falhou — exibindo somente históricos:', err);
          if ($('last-update'))
            $('last-update').textContent = 'Dados de: ' + SSO_EXPORTED_AT + ' (offline)';
        });
    } else {
      console.warn('[SSO Qualidade] SSO_SUPABASE não definido — supabase-client.js não carregado');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ════════════════════════════════════════════════════════════════════
   MÓDULO DE CORRELAÇÕES AVANÇADAS
   Injetado no escopo global para ser chamado pela IIFE principal.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);
  const { fmtBRL, fmtBRLShort, fmtPct, fmtNum, CURVAS_ORDEM, CURVAS_CORES } = Engine;

  const CURVA_CSS = { 'A+': 'aplus', 'A': 'a', 'B': 'b', 'C': 'c', 'D': 'd', 'Sem classificação': 'sem' };

  /* Estado local das 3 correlações */
  const corrState = { vendMetric: 'propostas', fonteMetric: 'propostas', tipoMetric: 'vendas' };
  let _corrFiltered = null; // referência sincronizada com o filtro global

  /* ── Utilidades ─────────────────────────────────────────────────── */
  function fmtCell(v, m) {
    if (v === null || v === undefined || v === 0) return '—';
    if (m === 'conversao') return fmtPct(v);
    if (m === 'fatVendas' || m === 'ticketMedio') return fmtBRLShort(v);
    return fmtNum(v);
  }

  function heatBg(v, max, m) {
    if (!v || !max) return 'rgba(245,246,248,1)';
    const t = Math.sqrt(Math.min(v / max, 1));
    if (m === 'conversao') return `rgba(26,122,74,${(0.08 + t * 0.72).toFixed(2)})`;
    if (m === 'ticketMedio') return `rgba(201,138,91,${(0.08 + t * 0.72).toFixed(2)})`;
    return `rgba(133,32,12,${(0.06 + t * 0.68).toFixed(2)})`;
  }

  function heatFg(v, max) {
    if (!v || !max) return 'var(--gray-300)';
    return Math.sqrt(v / max) > 0.5 ? '#fff' : 'var(--graphite)';
  }

  function escH(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  /* ── Heat Table (Vendedor / Tipo) ───────────────────────────────── */
  function buildHeatTable(ctData, metric, rowLabel, rowField, onCellClick) {
    const { rows, curvas } = ctData;
    if (!rows.length) return '<div class="empty-state"><p>Sem dados para o período selecionado.</p></div>';

    // Máx por coluna para normalização independente
    const colMax = {};
    for (const cv of curvas) {
      colMax[cv] = Math.max(...rows.map(r => {
        const v = r.cells[cv][metric];
        return (v !== null && typeof v === 'number') ? v : 0;
      }), 0.001);
    }

    const headerCells = curvas.map(cv =>
      `<th class="heat-col-header"><span class="curva-badge curva-${CURVA_CSS[cv]}" style="font-size:9px;padding:2px 7px">${cv}</span></th>`
    ).join('');

    const totalLabel = metric === 'conversao' ? 'conversao' : metric === 'ticketMedio' ? 'fatVendas' : metric;

    const bodyRows = rows.map(row =>
      `<tr>
        <td class="heat-row-label" title="${escH(row.row)}">${escH(row.row)}</td>
        ${curvas.map(cv => {
        const v = row.cells[cv][metric];
        const bg = heatBg(v, colMax[cv], metric);
        const fg = heatFg(v, colMax[cv]);
        return `<td class="heat-cell" style="background:${bg};color:${fg}"
            data-row="${escH(row.row)}" data-curva="${cv}"
            title="${escH(row.row)} × ${cv}: ${fmtCell(v, metric)}">${fmtCell(v, metric)}</td>`;
      }).join('')}
        <td class="heat-total-cell">${fmtCell(row.totals[totalLabel] || row.totals.propostas, metric)}</td>
      </tr>`
    ).join('');

    return `<table class="heat-table">
      <thead><tr>
        <th class="heat-col-header" style="text-align:left">${rowLabel}</th>
        ${headerCells}
        <th class="heat-col-header">Total</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
  }

  /* ── 1. Render Vendedor × Curva ──────────────────────────────────── */
  function renderVendCurva() {
    if (!_corrFiltered) return;
    const ct = Engine.crossTabMetric(_corrFiltered, 'vendedor');
    const container = $('matrix-vend-curva');
    if (!container) return;
    container.innerHTML = buildHeatTable(ct, corrState.vendMetric, 'Vendedor', 'vendedor', (row, cv) => { });

    container.querySelectorAll('.heat-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        // Dispara evento customizado que o módulo principal escuta
        document.dispatchEvent(new CustomEvent('corr-filter', {
          detail: { vendedor: cell.dataset.row, curva: cell.dataset.curva }
        }));
      });
    });
  }

  /* ── 2. Render Fonte × Curva (Stacked Bars) ─────────────────────── */
  let _fonteChart = null;
  function renderFonteCurva() {
    if (!_corrFiltered) return;
    const ct = Engine.crossTabMetric(_corrFiltered, 'fonte_lead');
    const canvas = $('chart-fonte-curva');
    if (!canvas) return;
    if (_fonteChart) { _fonteChart.destroy(); _fonteChart = null; }

    const metric = corrState.fonteMetric;
    const BASE_FONT = { family: "'Inter',system-ui,sans-serif", size: 11 };
    const curvas = ['A+', 'A', 'B', 'C', 'D', 'Sem classificação'];

    const isStacked = metric !== 'conversao';
    const datasets = curvas.map(cv => ({
      label: cv,
      data: ct.rows.map(r => {
        const v = r.cells[cv][metric];
        return (v !== null && typeof v === 'number') ? v : 0;
      }),
      backgroundColor: (CURVAS_CORES[cv] || '#999') + 'CC',
      borderColor: CURVAS_CORES[cv] || '#999',
      borderWidth: 1,
      borderRadius: 3,
    }));

    _fonteChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: ct.rows.map(r => r.row), datasets },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: BASE_FONT, usePointStyle: true, padding: 12, color: '#475467' } },
          tooltip: {
            mode: 'index', intersect: false,
            callbacks: { label: c => ` ${c.dataset.label}: ${fmtCell(c.parsed.x, metric)}` },
          },
        },
        scales: {
          x: {
            stacked: isStacked, grid: { color: 'rgba(0,0,0,.04)' }, beginAtZero: true,
            ticks: { font: BASE_FONT, color: '#667085', callback: v => metric === 'conversao' ? v + '%' : metric === 'fatVendas' ? fmtBRLShort(v) : v }, border: { display: false }
          },
          y: { stacked: isStacked, ticks: { font: BASE_FONT, color: '#475467' }, border: { display: false }, grid: { display: false } },
        },
      },
    });
  }

  /* ── 3. Render Tipo de Contrato × Curva ──────────────────────────── */
  let _allTipoData = null;
  function renderTipoCurva(top = 15) {
    if (!_corrFiltered) return;
    const ct = Engine.crossTabMetric(_corrFiltered, 'tipo_contrato');
    _allTipoData = ct;
    const topRows = { rows: ct.rows.slice(0, top), curvas: ct.curvas };
    const container = $('matrix-tipo-curva');
    if (!container) return;
    container.innerHTML = buildHeatTable(topRows, corrState.tipoMetric, 'Tipo de Contrato', 'tipo_contrato', () => { });

    container.querySelectorAll('.heat-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('corr-filter', {
          detail: { tipo: cell.dataset.row, curva: cell.dataset.curva }
        }));
      });
    });
  }

  /* ── Drawer Tipo de Contrato (ranking completo) ───────────────────── */
  function openTipoDrawer() {
    const overlay = $('tipo-drawer-overlay');
    const drawer = $('tipo-drawer');
    if (!overlay || !drawer) return;
    overlay.classList.add('active'); drawer.classList.add('active');
    renderTipoDrawerBody('');
  }

  function closeTipoDrawer() {
    $('tipo-drawer-overlay')?.classList.remove('active');
    $('tipo-drawer')?.classList.remove('active');
  }

  function renderTipoDrawerBody(search) {
    const body = $('tipo-drawer-body');
    if (!body || !_allTipoData) return;
    const metric = corrState.tipoMetric;
    const q = search.toLowerCase().trim();
    const rows = _allTipoData.rows.filter(r => !q || r.row.toLowerCase().includes(q));

    if (!rows.length) { body.innerHTML = '<p style="padding:16px;color:var(--gray-400);font-size:12px">Nenhum tipo encontrado.</p>'; return; }

    const curvas = _allTipoData.curvas;
    const colMax = {};
    for (const cv of curvas) {
      colMax[cv] = Math.max(..._allTipoData.rows.map(r => {
        const v = r.cells[cv][metric]; return (v !== null && typeof v === 'number') ? v : 0;
      }), 0.001);
    }

    body.innerHTML = `<table class="heat-table" style="font-size:10px">
      <thead><tr>
        <th class="heat-col-header" style="text-align:left">Tipo de Contrato</th>
        ${curvas.map(cv => `<th class="heat-col-header"><span class="curva-badge curva-${CURVA_CSS[cv]}" style="font-size:8px;padding:1px 5px">${cv}</span></th>`).join('')}
        <th class="heat-col-header">Total</th>
      </tr></thead>
      <tbody>${rows.map((row, i) => `<tr>
        <td class="heat-row-label" title="${escH(row.row)}" style="font-size:10px"><span style="color:var(--gray-300);font-size:9px;margin-right:6px">${i + 1}</span>${escH(row.row)}</td>
        ${curvas.map(cv => {
      const v = row.cells[cv][metric];
      const bg = heatBg(v, colMax[cv], metric);
      const fg = heatFg(v, colMax[cv]);
      return `<td class="heat-cell" style="background:${bg};color:${fg};font-size:10px">${fmtCell(v, metric)}</td>`;
    }).join('')}
        <td class="heat-total-cell" style="font-size:10px">${fmtCell(row.totals[metric === 'conversao' ? 'conversao' : metric === 'ticketMedio' ? 'fatVendas' : metric] || row.totals.propostas, metric)}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div class="drawer-pagination"><span>${rows.length} tipos encontrados</span></div>`;
  }

  /* ── Seletores de métrica ───────────────────────────────────────── */
  function wireMetricSel(selId, stateKey, renderFn) {
    const sel = $(selId);
    if (!sel) return;
    sel.querySelectorAll('.metric-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sel.querySelectorAll('.metric-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        corrState[stateKey] = btn.dataset.metric;
        renderFn();
      });
    });
  }

  /* ── Exportar CSV correlações ────────────────────────────────────── */
  function exportCorrelacoesCsv() {
    if (!_allTipoData) return;
    const header = ['Tipo de Contrato', ...Engine.CURVAS_ORDEM.map(c => c + ' (vendas)'), 'Total'].join(',');
    const rows = _allTipoData.rows.map(r =>
      [`"${r.row}"`, ...Engine.CURVAS_ORDEM.map(cv => r.cells[cv]?.vendas || 0), r.totals.vendas].join(',')
    );
    const csv = '\uFEFF' + header + '\n' + rows.join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'SSO_Correlacoes_TipoContrato.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  /* ── API pública ────────────────────────────────────────────────── */
  window.Correlacoes = {
    update(records) {
      _corrFiltered = records;
      renderVendCurva();
      renderFonteCurva();
      renderTipoCurva(15);
    },
    init() {
      wireMetricSel('metric-vend-curva', 'vendMetric', renderVendCurva);
      wireMetricSel('metric-fonte-curva', 'fonteMetric', renderFonteCurva);
      wireMetricSel('metric-tipo-curva', 'tipoMetric', () => renderTipoCurva(15));

      $('btn-open-tipo-drawer')?.addEventListener('click', openTipoDrawer);
      $('btn-close-tipo-drawer')?.addEventListener('click', closeTipoDrawer);
      $('tipo-drawer-overlay')?.addEventListener('click', closeTipoDrawer);
      $('tipo-drawer-search')?.addEventListener('input', e => renderTipoDrawerBody(e.target.value));

      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTipoDrawer(); });

      // Sincronização Live — Botão ATUALIZAR PAINEL
      // Sincroniza somente GOOGLE_SHEETS_LIVE (jul+). Histórico jan-jun preservado.
      const btnSync = $('btn-sync-now');
      const btnSyncText = $('btn-sync-text');
      if (btnSync) {
        btnSync.addEventListener('click', async () => {
          if (btnSync.disabled) return;
          btnSync.disabled = true;
          if (btnSyncText) btnSyncText.textContent = 'Atualizando...';

          try {
            const syncResData = await SSO_SUPABASE.dispararSync().catch(e => {
              console.warn('[SSO Qualidade] Sync falhou:', e);
              return {};
            });

            const resultado = await SSO_SUPABASE.recarregarDados(ALL);

            const s = syncResData.summary || {};
            const nowStr = new Date().toLocaleString('pt-BR');
            if ($('last-update')) $('last-update').textContent = 'Atualizado: ' + nowStr;
            alert(
              `Sincronização concluída!\n\n` +
              `Inseridos: ${s.inserted || 0}\n` +
              `Atualizados: ${s.updated || 0}\n` +
              `Inalterados: ${s.skipped || 0}\n\n` +
              `Histórico jan-jun: ${resultado.historico} registros\n` +
              `Live jul+: ${resultado.live} registros`
            );
          } catch (err) {
            console.error('[SSO Qualidade] Erro na sincronização:', err);
            alert('Aviso: Não foi possível sincronizar. Dados históricos mantidos.');
          } finally {
            btnSync.disabled = false;
            if (btnSyncText) btnSyncText.textContent = 'ATUALIZAR PAINEL';
            applyFilters();
            if (window.Correlacoes) Correlacoes.update(filtered);
          }
        });
      }

      // Filtro por clique nas células → dispara evento para o app principal escutar
      document.addEventListener('corr-filter', e => {
        const { vendedor, curva, tipo } = e.detail;
        if (vendedor !== undefined) document.querySelector('#sel-vendedor').value = vendedor;
        if (curva !== undefined) document.querySelector('#sel-curva').value = curva || '';
        if (tipo !== undefined) document.querySelector('#sel-tipo').value = tipo || '';
        // Trigger change events para o app principal processar
        ['sel-vendedor', 'sel-curva', 'sel-tipo'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.dispatchEvent(new Event('change'));
        });
      });
    },
  };
})();

/* ── DatePicker — Qualidade de Vendas ───────────────────────────────── */
(function () {
  const JULIO_2026 = '2026-07-01';

  function isPreJuly(start, end) {
    return start && end && start < JULIO_2026 && end < JULIO_2026;
  }

  function showHist(visible) {
    const el = document.getElementById('dp-hist-warning');
    if (el) el.classList.toggle('visible', visible);
  }

  function getMainState() {
    // Acessar o state do módulo principal — usar evento customizado
    return window._qualDateState || { dateStart: null, dateEnd: null };
  }

  window._qualDateState = { dateStart: null, dateEnd: null };

  document.addEventListener('DOMContentLoaded', function () {
    const trigger = document.getElementById('dp-trigger-qual');
    if (!trigger || typeof SSODatePicker === 'undefined') return;

    const dp = new SSODatePicker({
      triggerEl: trigger,
      placeholder: 'Data específica',
      onApply: function (start, end) {
        window._qualDateState.dateStart = start;
        window._qualDateState.dateEnd = end;
        showHist(start && isPreJuly(start, end));
        document.dispatchEvent(new CustomEvent('qual-date-change', { detail: { start, end } }));
      },
      onClear: function () {
        window._qualDateState.dateStart = null;
        window._qualDateState.dateEnd = null;
        showHist(false);
        document.dispatchEvent(new CustomEvent('qual-date-change', { detail: { start: null, end: null } }));
      },
    });

    // Limpar também pelo botão principal
    document.getElementById('btn-clear')?.addEventListener('click', function () {
      dp.clear();
      window._qualDateState.dateStart = null;
      window._qualDateState.dateEnd = null;
      showHist(false);
    });

    // O módulo qualidade.js (IIFE principal) escuta este evento e aplica o filtro
    document.addEventListener('qual-date-change', function (e) {
      // Já coberto pelo wiring abaixo no state
    });
  });
})();
