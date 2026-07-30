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
    metas: [],  // array de metas carregadas do Supabase (metas_comerciais)
  };

  let filtered = [];
  // ALL: histórico estático jan-jun (data.js) + live jul+ (Supabase).
  // Mantido como array mutável para recarregarDados() atualizar in-place.
  const ALL = [...SSO_DATA];  // 1.157 registros EXCEL_HISTORICO jan-jun

  // ── Utils ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const fmtBRL = v => Engine.fmtBRL(v);
  const fmtPct = v => Engine.fmtPct(v);
  const fmtNum = v => Engine.fmtNum(v);
  const fmtShort = v => Engine.fmtBRLShort(v);

  // ── Aplicar filtros ───────────────────────────────────────────────────
  function applyFilters() {
    filtered = Engine.filter(ALL, {
      months: state.months,
      vendedor: state.vendedor ? [state.vendedor] : [],
      fonte: state.fonte ? [state.fonte] : [],
      status: state.status ? [state.status] : [],
      tipo: state.tipo ? [state.tipo] : [],
      dateStart: state.dateStart,
      dateEnd: state.dateEnd,
    });
    renderAll();
  }

  // ── KPIs ──────────────────────────────────────────────────────────────
  function renderKPIs() {
    const k = Engine.kpis(filtered, state.months, state.dateStart, state.dateEnd);

    // Comparação com período anterior (quando 1 mês selecionado, sem filtro de data)
    let prev = null;
    if (state.months.length === 1 && !state.dateStart) {
      const m = state.months[0];
      const prevMonth = m - 1;
      if (prevMonth >= 1) {
        const prevRecs = Engine.filter(ALL, { months: [prevMonth], vendedor: state.vendedor ? [state.vendedor] : [], fonte: state.fonte ? [state.fonte] : [], status: state.status ? [state.status] : [], tipo: state.tipo ? [state.tipo] : [] });
        prev = Engine.kpis(prevRecs, [prevMonth]);
      }
    }

    setKPI('leads', fmtNum(k.leads), k, prev, 'leads', false);
    setKPI('propostas', fmtNum(k.propostas), k, prev, 'propostas', false);
    setKPI('previsao', fmtShort(k.prevFat), k, prev, 'prevFat', true);
    setKPI('vendas', fmtNum(k.vendas), k, prev, 'vendas', false);
    setKPI('faturamento', fmtShort(k.fatVendas), k, prev, 'fatVendas', true);
    setKPI('conversao', fmtPct(k.conversao), k, prev, 'conversao', false);

    // Período label
    const fmtBRd = d => d ? d.split('-').reverse().join('/') : '';
    let labels;
    if (state.dateStart) {
      labels = state.dateEnd && state.dateEnd !== state.dateStart
        ? `${fmtBRd(state.dateStart)} a ${fmtBRd(state.dateEnd)}`
        : fmtBRd(state.dateStart);
    } else {
      labels = state.months.length === 0
        ? 'Jan a Jul 2026 — periodo completo'
        : state.months.map(m => Engine.MES_NOME_FULL[m]).join(', ') + ' 2026';
    }
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
    const monthData = Engine.byMonth(filtered, allMonths, state.dateStart, state.dateEnd);
    Charts.renderVolume(monthData);
    Charts.renderFinancial(monthData);

    const statusData = Engine.byStatus(filtered);
    const total = filtered.length;
    Charts.renderDonut(statusData, total);

    const tiposData = Engine.byTipoContrato(filtered, state.months, state.dateStart, state.dateEnd);
    Charts.renderTipos(tiposData, tipo => {
      state.tipo = tipo;
      $('sel-tipo').value = tipo;
      applyFilters();
      updateChips();
    });

    Charts.renderFonte(Engine.byFonte(filtered, state.months, state.dateStart, state.dateEnd));
    Charts.renderVendedores(Engine.byVendedor(filtered, state.months, state.dateStart, state.dateEnd), state.vendedorMetric);
  }

  // ── Tabela ────────────────────────────────────────────────────────────
  function renderTable() {
    const data = Engine.byVendedor(filtered, state.months, state.dateStart, state.dateEnd);
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

    const tot = Engine.kpis(filtered, state.months, state.dateStart, state.dateEnd);
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
    drawerData = Engine.byTipoContrato(filtered, state.months);
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
    const data = Engine.byVendedor(filtered, state.months);
    const tot = Engine.kpis(filtered, state.months);
    const header = 'Vendedor,Leads,Propostas,Vendas,Conversao (%),Prev.Faturamento (R$),Fat.Vendas (R$)\n';
    const rows = data.map(d => `"${d.vendedor}",${d.leads},${d.propostas},${d.vendas},${d.conversao.toFixed(2)},${d.prevFat.toFixed(2)},${d.fatVendas.toFixed(2)}`).join('\n');
    const footer = `\nTOTAL,${tot.leads},${tot.propostas},${tot.vendas},${tot.conversao.toFixed(2)},${tot.prevFat.toFixed(2)},${tot.fatVendas.toFixed(2)}`;
    const blob = new Blob(['\uFEFF' + header + rows + footer], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'SSO_Dashboard_Exportacao.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Metas e Performance ──────────────────────────────────────────────
  function renderMetas() {
    if (typeof Goals === 'undefined') return;

    const k = Engine.kpis(filtered, state.months, state.dateStart, state.dateEnd);
    const metas = state.metas || [];
    const semMetas = metas.length === 0;

    // Aviso de sem dados
    const avisoEl = $('metas-sem-dados');
    if (avisoEl) avisoEl.style.display = semMetas ? '' : 'none';

    // Label de período
    const fmtBRd = d => d ? d.split('-').reverse().join('/') : '';
    const periodLabel = state.dateStart
      ? (state.dateEnd && state.dateEnd !== state.dateStart
          ? `${fmtBRd(state.dateStart)} a ${fmtBRd(state.dateEnd)}`
          : fmtBRd(state.dateStart))
      : (state.months.length
          ? state.months.map(m => Engine.MES_NOME_FULL[m]).join(', ') + ' 2026'
          : 'Jan a Dez 2026');
    const lbl = $('metas-period-label');
    if (lbl) lbl.textContent = periodLabel;

    const kpis = Goals.calcularKpisMetas(metas, state, k.fatVendas);

    const fmt = v => v != null ? Engine.fmtBRL(v) : '—';
    const fmtP = v => v != null ? v.toFixed(1) + '%' : '—';

    // Preencher cards
    const setCard = (idVal, idSub, val, subTxt, cls) => {
      const el = $(idVal);
      if (el) {
        el.textContent = val;
        const card = el.closest('.meta-card');
        if (card) {
          card.classList.remove('sem-meta', 'atingido', 'superado', 'atrasado');
          if (cls) card.classList.add(cls);
        }
      }
      const sub = $(idSub);
      if (sub) sub.textContent = subTxt || '';
    };

    if (kpis.semMeta) {
      setCard('mv-meta',         'ms-meta',         'Sem meta cadastrada', '', 'sem-meta');
      setCard('mv-realizado',    'ms-realizado',     fmt(kpis.realizado), '', '');
      setCard('mv-atingimento',  'ms-atingimento',  '—', 'Sem meta', 'sem-meta');
      setCard('mv-falta',        'ms-falta',        '—', 'Sem meta', 'sem-meta');
      setCard('mv-proporcional', 'ms-proporcional', '—', '', 'sem-meta');
      setCard('mv-ritmo',        'ms-ritmo',        '—', '', 'sem-meta');
    } else {
      const pct    = kpis.atingimento;
      const cls    = pct >= 100 ? 'atingido' : (pct >= 70 ? '' : 'atrasado');
      const clsSup = pct > 100 ? 'superado' : '';
      setCard('mv-meta',         'ms-meta',         fmt(kpis.meta),        '', '');
      setCard('mv-realizado',    'ms-realizado',     fmt(kpis.realizado),  '', cls);
      setCard('mv-atingimento',  'ms-atingimento',  fmtP(pct),            pct >= 100 ? 'Meta atingida' : '', cls);
      setCard('mv-falta',        'ms-falta',        fmt(kpis.faltaMeta),  kpis.superado > 0 ? 'Superado!' : '', kpis.superado > 0 ? 'atingido' : cls);
      setCard('mv-proporcional', 'ms-proporcional', kpis.metaAteHoje != null ? fmt(kpis.metaAteHoje) : '—', 'Acumulado até hoje', '');
      setCard('mv-ritmo',        'ms-ritmo',        kpis.ritmo != null ? fmtP(kpis.ritmo) : '—', 'Vs meta proporcional', kpis.ritmo != null && kpis.ritmo >= 100 ? 'atingido' : '');
    }

    // Barra de progresso
    const barFill = $('metas-bar-fill');
    const barExcess = $('metas-bar-excess');
    const pctLabel = $('metas-pct-label');
    if (barFill && barExcess && pctLabel) {
      const pct = kpis.semMeta ? 0 : (kpis.atingimento || 0);
      const cor = Goals.corProgresso(kpis.semMeta ? null : pct);
      pctLabel.textContent = kpis.semMeta ? '—' : fmtP(pct);

      if (pct > 100) {
        barFill.style.width = '100%';
        barFill.style.backgroundColor = '#16a34a';
        barExcess.style.width = Math.min((pct - 100), 30) + '%';
        barExcess.style.display = '';
      } else {
        barFill.style.width = Math.min(pct, 100) + '%';
        barFill.style.backgroundColor = cor;
        barExcess.style.display = 'none';
      }
    }

    // Ranking
    const rankingBody = $('metas-ranking-body');
    if (rankingBody && typeof Goals.calcularRankingMetas === 'function') {
      const byVend = Engine.byVendedor(filtered, state.months, state.dateStart, state.dateEnd);
      const ranking = Goals.calcularRankingMetas(metas, byVend, state);

      if (!ranking.length) {
        rankingBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--gray-400);font-style:italic">Sem dados para o filtro selecionado</td></tr>';
      } else {
        rankingBody.innerHTML = ranking.map((r, i) => {
          const pos = i + 1;
          const posCls = pos === 1 ? 'pos-1' : pos === 2 ? 'pos-2' : pos === 3 ? 'pos-3' : '';
          const pct = r.atingimento != null ? Math.min(r.atingimento, 100) : 0;
          const cor = Goals.corProgresso(r.semMeta ? null : r.atingimento);
          const barW = r.semMeta ? 0 : pct;
          return `<tr>
            <td class="td-pos ${posCls}">${pos}</td>
            <td class="td-vendor">${escHTML(r.vendedor)}</td>
            <td>${r.semMeta ? '<span class="td-sem-meta">Sem meta</span>' : Engine.fmtBRL(r.meta)}</td>
            <td>${Engine.fmtBRL(r.realizado)}</td>
            <td>${r.semMeta ? '<span class="td-sem-meta">—</span>' : (r.atingimento.toFixed(1) + '%')}</td>
            <td>${r.semMeta ? '<span class="td-sem-meta">—</span>' : Engine.fmtBRL(r.faltaMeta)}</td>
            <td>
              <div class="mini-bar-wrap">
                <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${barW.toFixed(1)}%;background:${cor}"></div></div>
                <span class="mini-bar-pct">${r.semMeta ? '—' : (r.atingimento.toFixed(0) + '%')}</span>
              </div>
            </td>
          </tr>`;
        }).join('');
      }
    }
  }

  // ── Renderização total ────────────────────────────────────────────
  function renderAll() {
    renderKPIs();
    renderCharts();
    renderTable();
    // renderMetas isolado: erro aqui nunca afeta KPIs, gráficos ou tabela
    try { renderMetas(); } catch(e) { console.warn('[SSO] renderMetas falhou:', e); }
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
        // Exclusão mútua: clicar em mês limpa o filtro de data específica
        state.dateStart = null;
        state.dateEnd   = null;
        if (window._mainDP) window._mainDP.clear();
        document.getElementById('dp-hist-warning')?.classList.remove('visible');
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
        Charts.renderVendedores(Engine.byVendedor(filtered, state.months), state.vendedorMetric);
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

    // Sincronização Live — Botão ATUALIZAR PAINEL
    // Sincroniza somente dados GOOGLE_SHEETS_LIVE (jul+). O histórico jan-jun
    // permanece intacto em ALL, vindo do data.js estático.
    const btnSync = $('btn-sync-now');
    const btnSyncText = $('btn-sync-text');
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        if (btnSync.disabled) return;
        btnSync.disabled = true;
        if (btnSyncText) btnSyncText.textContent = 'Atualizando...';

        try {
          if (typeof SSO_SUPABASE === 'undefined') throw new Error('Módulo Supabase não carregado');

          const syncResData = await SSO_SUPABASE.dispararSync().catch(e => {
            console.warn('[SSO] Sync Edge Function falhou (dados mantidos):', e);
            return {};
          });

          const resultado = await SSO_SUPABASE.recarregarDados(ALL);

          // Recarregar metas também após sync
          if (SSO_SUPABASE.carregarMetas) {
            state.metas = await SSO_SUPABASE.carregarMetas(2026);
          }

          const s = syncResData.summary || {};
          const nowStr = new Date().toLocaleString('pt-BR');
          if ($('last-update')) $('last-update').textContent = 'Atualizado: ' + nowStr;
          alert(
            `Sincronização concluída!\n\n` +
            `Inseridos: ${s.inserted || 0}\n` +
            `Atualizados: ${s.updated || 0}\n` +
            `Inalterados: ${s.skipped || 0}\n\n` +
            `Histórico jan-jun: ${resultado.historico} registros\n` +
            `Live jul+: ${resultado.live} registros\n` +
            `Metas carregadas: ${state.metas.length}`
          );
        } catch (err) {
          console.error('[SSO] Erro na sincronização:', err);
          alert('Aviso: Não foi possível sincronizar. Dados históricos mantidos.');
        } finally {
          btnSync.disabled = false;
          if (btnSyncText) btnSyncText.textContent = 'ATUALIZAR PAINEL';
          applyFilters();
        }
      });
    }

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
          onApply: function (start, end) {
            state.dateStart = start;
            state.dateEnd   = end || start;
            // Exclusão mútua: aplicar data limpa os filtros de mês
            if (start) {
              state.months = [];
              syncMonthPills();
            }
            const warn = document.getElementById('dp-hist-warning');
            if (warn) warn.classList.toggle('visible', !!(start && start < '2026-07-01' && (!end || end < '2026-07-01')));
            applyFilters();
            updateChips();
          },
        });
      }
    } catch (e) {
      console.warn('[SSO] DatePicker init falhou:', e);
    }

    filtered = ALL;
    renderAll();
    updateChips();

    // Carga live em segundo plano — busca GOOGLE_SHEETS_LIVE do Supabase sem
    // bloquear a UI. O histórico jan-jun (1.157 registros) é preservado intacto.
    // ATENÇÃO: dados comerciais e metas são carregados SEPARADAMENTE para que
    // falha em metas não bloqueie os dados live principais.
    if (typeof SSO_SUPABASE !== 'undefined') {
      // 1. Carrega dados comerciais live (crítico)
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

          // 2. Carrega metas em segundo plano (não crítico)
          if (SSO_SUPABASE.carregarMetas) {
            SSO_SUPABASE.carregarMetas(2026)
              .then(metas => {
                state.metas = metas || [];
                try { renderMetas(); } catch(e) { console.warn('[SSO] renderMetas:', e); }
              })
              .catch(err => console.warn('[SSO] carregarMetas falhou:', err));
          }
        })
        .catch(err => {
          console.warn('[SSO] Carga live falhou — exibindo somente dados históricos:', err);
          if ($('last-update'))
            $('last-update').textContent = 'Dados de: ' + SSO_EXPORTED_AT + ' (offline)';
        });
    } else {
      console.warn('[SSO] SSO_SUPABASE não definido — supabase-client.js não carregado');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
