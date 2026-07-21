/**
 * charts.js — Renderização dos 6 gráficos com Chart.js
 */
const Charts = (() => {
  const W = '#85200C', W2 = '#551308', CU = '#C98A5B', GR = '#1A7A4A',
        AL = '#B42318', BL = '#667085', G50 = '#F5F6F8';

  const PALETTE = [W, CU, GR, '#4E6AF5', '#8B5CF6', '#0EA5E9', '#F59E0B', AL, '#10B981', '#6366F1'];

  function fmtBRL(v) {
    if (!v) return 'R$ 0';
    if (Math.abs(v) >= 1e6) return 'R$ ' + (v / 1e6).toFixed(2).replace('.', ',') + 'M';
    if (Math.abs(v) >= 1e3) return 'R$ ' + (v / 1e3).toFixed(1).replace('.', ',') + 'K';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  const BASE_FONT = { family: "'Inter', system-ui, sans-serif", size: 11 };

  const BASE_OPTS = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { font: BASE_FONT, usePointStyle: true, pointStyleWidth: 8, padding: 16, color: '#475467' } },
    },
    scales: {
      x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: BASE_FONT, color: '#667085' }, border: { display: false } },
      y: { grid: { color: 'rgba(0,0,0,.04)', drawTicks: false }, ticks: { font: BASE_FONT, color: '#667085', padding: 6 }, border: { display: false } },
    },
  };

  const instances = {};

  function destroy(id) {
    if (instances[id]) { instances[id].destroy(); delete instances[id]; }
  }

  function noDataOverlay(id, msg = 'Sem dados para o filtro selecionado') {
    destroy(id);
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const wrap = canvas.parentElement;
    let el = wrap.querySelector('.no-data');
    if (!el) {
      el = document.createElement('div');
      el.className = 'no-data';
      el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3l18 18M9 9a3 3 0 0 0 4.24 4.24M17.6 17.6A8 8 0 1 0 6.4 6.4"/></svg><p>${msg}</p>`;
      canvas.style.display = 'none';
      wrap.appendChild(el);
    }
  }

  function clearOverlay(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const el = wrap.querySelector('.no-data');
    if (el) el.remove();
    canvas.style.display = '';
  }

  // ── 1. Evolução de Volume (combo) ─────────────────────────────────────
  function renderVolume(monthData) {
    clearOverlay('chart-volume');
    if (!monthData.length) { noDataOverlay('chart-volume'); return; }
    destroy('chart-volume');
    const ctx = document.getElementById('chart-volume').getContext('2d');
    instances['chart-volume'] = new Chart(ctx, {
      data: {
        labels: monthData.map(m => m.label),
        datasets: [
          { type: 'bar', label: 'Leads', data: monthData.map(m => m.leads), backgroundColor: 'rgba(133,32,12,.15)', borderColor: W, borderWidth: 1.5, borderRadius: 4, order: 2 },
          { type: 'bar', label: 'Propostas', data: monthData.map(m => m.propostas), backgroundColor: 'rgba(201,138,91,.2)', borderColor: CU, borderWidth: 1.5, borderRadius: 4, order: 3 },
          { type: 'line', label: 'Vendas', data: monthData.map(m => m.vendas), borderColor: GR, backgroundColor: 'rgba(26,122,74,.1)', pointBackgroundColor: GR, pointRadius: 4, pointHoverRadius: 6, fill: true, tension: .35, borderWidth: 2, order: 1 },
        ],
      },
      options: {
        ...BASE_OPTS,
        plugins: { ...BASE_OPTS.plugins, tooltip: { mode: 'index', intersect: false, callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toLocaleString('pt-BR')}` } } },
        scales: { x: BASE_OPTS.scales.x, y: { ...BASE_OPTS.scales.y, beginAtZero: true } },
      },
    });
  }

  // ── 2. Evolução Financeira ────────────────────────────────────────────
  function renderFinancial(monthData) {
    clearOverlay('chart-financial');
    if (!monthData.length) { noDataOverlay('chart-financial'); return; }
    destroy('chart-financial');
    const ctx = document.getElementById('chart-financial').getContext('2d');
    instances['chart-financial'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: monthData.map(m => m.label),
        datasets: [
          { label: 'Previsao de Faturamento', data: monthData.map(m => m.prevFat), backgroundColor: 'rgba(133,32,12,.18)', borderColor: W, borderWidth: 1.5, borderRadius: 4 },
          { label: 'Faturamento Realizado', data: monthData.map(m => m.fatVendas), backgroundColor: W, borderColor: W2, borderWidth: 1, borderRadius: 4 },
        ],
      },
      options: {
        ...BASE_OPTS,
        plugins: { ...BASE_OPTS.plugins, tooltip: { mode: 'index', intersect: false, callbacks: { label: c => ` ${c.dataset.label}: ${fmtBRL(c.parsed.y)}` } } },
        scales: { x: BASE_OPTS.scales.x, y: { ...BASE_OPTS.scales.y, beginAtZero: true, ticks: { ...BASE_OPTS.scales.y.ticks, callback: v => fmtBRL(v) } } },
      },
    });
  }

  // ── 3. Status Donut ───────────────────────────────────────────────────
  const STATUS_COLORS = { 'CONTRATO FECHADO': GR, 'PROPOSTA ENVIADA': CU, 'RECUSADO': AL };
  function renderDonut(statusData, total) {
    clearOverlay('chart-donut');
    if (!statusData.length) { noDataOverlay('chart-donut'); return; }
    destroy('chart-donut');
    const ctx = document.getElementById('chart-donut').getContext('2d');
    const colors = statusData.map((d, i) => STATUS_COLORS[d.status] || PALETTE[i + 3]);
    const centerPlugin = {
      id: 'centerText',
      beforeDraw(chart) {
        const { width: w, height: h, ctx: c } = chart;
        c.save();
        c.font = `700 ${Math.min(w, h) * .1}px Inter,system-ui,sans-serif`;
        c.fillStyle = '#121212';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const cx = (chart.chartArea.left + chart.chartArea.right) / 2;
        const cy = (chart.chartArea.top + chart.chartArea.bottom) / 2;
        c.fillText(total.toLocaleString('pt-BR'), cx, cy - 8);
        c.font = `400 ${Math.min(w, h) * .055}px Inter,system-ui,sans-serif`;
        c.fillStyle = '#667085';
        c.fillText('total', cx, cy + 12);
        c.restore();
      }
    };
    instances['chart-donut'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: statusData.map(d => d.status),
        datasets: [{ data: statusData.map(d => d.count), backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }],
      },
      options: {
        cutout: '68%', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: BASE_FONT, padding: 14, usePointStyle: true, pointStyleWidth: 8, color: '#475467' } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed.toLocaleString('pt-BR')} (${(c.parsed / total * 100).toFixed(1).replace('.', ',')}%)` } },
        },
      },
      plugins: [centerPlugin],
    });
  }

  // ── 4. Tipos de Contrato (horizontal, top 15) ─────────────────────────
  function renderTipos(tiposData, onBarClick) {
    clearOverlay('chart-tipos');
    if (!tiposData.length) { noDataOverlay('chart-tipos'); return; }
    destroy('chart-tipos');

    const top = tiposData.slice(0, 15);
    const outros = tiposData.slice(15);
    const outrosCount = outros.reduce((s, d) => s + d.propostas, 0);
    const labels = top.map(d => d.tipo.length > 32 ? d.tipo.slice(0, 30) + '…' : d.tipo);
    const values = top.map(d => d.propostas);
    const fullLabels = top.map(d => d.tipo);
    if (outrosCount > 0) { labels.push('Outros (' + outros.length + ')'); values.push(outrosCount); fullLabels.push('__outros__'); }

    const ctx = document.getElementById('chart-tipos').getContext('2d');
    instances['chart-tipos'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Propostas', data: values, backgroundColor: labels.map((_, i) => i < top.length ? 'rgba(133,32,12,.75)' : 'rgba(102,112,133,.4)'), borderRadius: 4, barThickness: 14 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => fullLabels[ctx[0].dataIndex] === '__outros__' ? 'Outros tipos' : (tiposData.find(d => d.tipo === fullLabels[ctx[0].dataIndex])?.tipo || ctx[0].label),
              label: c => {
                const full = fullLabels[c.dataIndex];
                if (full === '__outros__') return [` Propostas: ${outrosCount.toLocaleString('pt-BR')}`, ` Tipos agrupados: ${outros.length}`];
                const d = tiposData.find(x => x.tipo === full);
                if (!d) return [];
                return [` Propostas: ${d.propostas.toLocaleString('pt-BR')}`, ` Vendas: ${d.vendas.toLocaleString('pt-BR')}`, ` Conversao: ${d.conversao.toFixed(1).replace('.', ',')}%`, ` Previsao: ${fmtBRL(d.prevFat)}`, ` Fat. Realizado: ${fmtBRL(d.fatVendas)}`];
              },
            },
          },
        },
        scales: { x: { ...BASE_OPTS.scales.x, beginAtZero: true }, y: { ...BASE_OPTS.scales.y, ticks: { font: { ...BASE_FONT, size: 10 }, color: '#475467' } } },
        onClick(evt, elems) {
          if (!elems.length || !onBarClick) return;
          const tipo = fullLabels[elems[0].index];
          if (tipo !== '__outros__') onBarClick(tipo);
        },
      },
    });
  }

  // ── 5. Fonte do Lead ──────────────────────────────────────────────────
  function renderFonte(fonteData) {
    clearOverlay('chart-fonte');
    if (!fonteData.length) { noDataOverlay('chart-fonte'); return; }
    destroy('chart-fonte');
    const top = fonteData.slice(0, 12);
    const ctx = document.getElementById('chart-fonte').getContext('2d');
    instances['chart-fonte'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: top.map(d => d.fonte.length > 20 ? d.fonte.slice(0, 18) + '…' : d.fonte),
        datasets: [{ label: 'Propostas', data: top.map(d => d.propostas), backgroundColor: 'rgba(201,138,91,.75)', borderRadius: 4, barThickness: 14 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: c => top[c[0].dataIndex].fonte, label: c => {
            const d = top[c.dataIndex];
            return [` Oportunidades: ${d.leads.toLocaleString('pt-BR')}`, ` Propostas: ${d.propostas.toLocaleString('pt-BR')}`, ` Vendas: ${d.vendas.toLocaleString('pt-BR')}`, ` Conversao: ${d.conversao.toFixed(1).replace('.', ',')}%`, ` Previsao: ${fmtBRL(d.prevFat)}`, ` Fat. Realizado: ${fmtBRL(d.fatVendas)}`];
          }}},
        },
        scales: { x: { ...BASE_OPTS.scales.x, beginAtZero: true }, y: { ...BASE_OPTS.scales.y, ticks: { font: { ...BASE_FONT, size: 10 }, color: '#475467' } } },
      },
    });
  }

  // ── 6. Vendedores ─────────────────────────────────────────────────────
  function renderVendedores(vendData, metric) {
    clearOverlay('chart-vendedores');
    if (!vendData.length) { noDataOverlay('chart-vendedores'); return; }
    destroy('chart-vendedores');
    const sorted = [...vendData].sort((a, b) => b[metric] - a[metric]);
    const ctx = document.getElementById('chart-vendedores').getContext('2d');
    const isMoney = metric === 'fatVendas' || metric === 'prevFat';
    const isPct = metric === 'conversao';
    instances['chart-vendedores'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map(d => d.vendedor),
        datasets: [{ data: sorted.map(d => d[metric]), backgroundColor: sorted.map((_, i) => PALETTE[i % PALETTE.length] + 'CC'), borderRadius: 4, barThickness: 16 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => {
            const d = sorted[c.dataIndex];
            return [` Leads: ${d.leads.toLocaleString('pt-BR')}`, ` Propostas: ${d.propostas.toLocaleString('pt-BR')}`, ` Vendas: ${d.vendas.toLocaleString('pt-BR')}`, ` Conversao: ${d.conversao.toFixed(1).replace('.', ',')}%`, ` Previsao: ${fmtBRL(d.prevFat)}`, ` Fat. Realizado: ${fmtBRL(d.fatVendas)}`];
          }}},
        },
        scales: {
          x: { ...BASE_OPTS.scales.x, beginAtZero: true, ticks: { ...BASE_OPTS.scales.x.ticks, callback: v => isMoney ? fmtBRL(v) : isPct ? v.toFixed(1).replace('.', ',') + '%' : v.toLocaleString('pt-BR') } },
          y: { ...BASE_OPTS.scales.y, ticks: { font: { ...BASE_FONT, size: 11 }, color: '#475467' } },
        },
      },
    });
  }

  return { renderVolume, renderFinancial, renderDonut, renderTipos, renderFonte, renderVendedores };
})();
