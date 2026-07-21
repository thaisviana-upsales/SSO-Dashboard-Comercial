/**
 * engine.js — Motor de cálculo SSO Dashboard
 * Todas as funções são puras: recebem registros, retornam métricas.
 * NUNCA modifica os dados originais.
 * Regras idênticas às do agregador.py (Etapa 1).
 */
const Engine = (() => {

  // ── Helpers ────────────────────────────────────────────────────────────
  const normStatus = s => (s || '').trim().toUpperCase();
  const temContrato = r => !!(r.tipo_contrato && r.tipo_contrato.trim());
  const valorValido = r => r.valor_total !== null && r.valor_total !== undefined && !r.flag_valor_invalido;

  // ── Constantes Curva ABC ───────────────────────────────────────────────
  const CURVAS_ORDEM  = ['A+', 'A', 'B', 'C', 'D', 'Sem classificação'];
  const CURVAS_FAIXAS = { 'A+':'≥ 120 func.','A':'80–119 func.','B':'50–79 func.','C':'11–49 func.','D':'0–10 func.','Sem classificação':'—' };
  const CURVAS_CORES  = { 'A+':'#1A7A4A','A':'#4E6AF5','B':'#C98A5B','C':'#85200C','D':'#667085','Sem classificação':'#98A2B3' };

  // ── Filtro global ──────────────────────────────────────────────────────
  function filter(records, f) {
    return records.filter(r => {
      if (f.months?.length && !f.months.includes(r.mes_numero)) return false;
      if (f.vendedor?.length && !f.vendedor.includes(r.vendedor)) return false;
      if (f.fonte?.length && !f.fonte.includes(r.fonte_lead)) return false;
      if (f.status?.length && !f.status.includes(normStatus(r.status))) return false;
      if (f.tipo?.length && !f.tipo.includes(r.tipo_contrato)) return false;
      return true;
    });
  }

  // ── KPIs ───────────────────────────────────────────────────────────────
  function kpis(records) {
    let leads = 0, propostas = 0, vendas = 0, abertas = 0, recusadas = 0;
    let prevFat = 0, fatVendas = 0;

    for (const r of records) {
      leads++;
      const st = normStatus(r.status);
      if (temContrato(r)) {
        propostas++;
        if (valorValido(r)) prevFat += r.valor_total;
      }
      if (st === 'CONTRATO FECHADO') {
        vendas++;
        if (valorValido(r)) fatVendas += r.valor_total;
      } else if (st === 'PROPOSTA ENVIADA') {
        abertas++;
      } else if (st === 'RECUSADO') {
        recusadas++;
      }
    }

    const conversao = propostas > 0 ? (vendas / propostas) * 100 : 0;
    return { leads, propostas, vendas, abertas, recusadas, prevFat, fatVendas, conversao };
  }

  // ── Por Mês ────────────────────────────────────────────────────────────
  const MES_NOME = {1:'Jan',2:'Fev',3:'Mar',4:'Abr',5:'Mai',6:'Jun',7:'Jul'};
  const MES_NOME_FULL = {1:'Janeiro',2:'Fevereiro',3:'Março',4:'Abril',5:'Maio',6:'Junho',7:'Julho'};
  const ALL_MONTHS = [1,2,3,4,5,6,7];

  function byMonth(records, monthsToShow = ALL_MONTHS) {
    const map = {};
    for (const m of monthsToShow) map[m] = [];
    for (const r of records) {
      if (map[r.mes_numero] !== undefined) map[r.mes_numero].push(r);
    }
    return monthsToShow.map(m => ({
      mes: m,
      label: MES_NOME[m],
      labelFull: MES_NOME_FULL[m],
      ...kpis(map[m]),
    }));
  }

  // ── Por Status ─────────────────────────────────────────────────────────
  function byStatus(records) {
    const map = {};
    for (const r of records) {
      const st = normStatus(r.status) || '(sem status)';
      map[st] = (map[st] || 0) + 1;
    }
    // Ordenar: fechado, enviada, recusado, outros
    const PRIORITY = { 'CONTRATO FECHADO': 0, 'PROPOSTA ENVIADA': 1, 'RECUSADO': 2 };
    return Object.entries(map)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => {
        const pa = PRIORITY[a.status] ?? 99;
        const pb = PRIORITY[b.status] ?? 99;
        return pa !== pb ? pa - pb : b.count - a.count;
      });
  }

  // ── Por Tipo de Contrato ───────────────────────────────────────────────
  function byTipoContrato(records) {
    const map = {};
    for (const r of records) {
      if (!temContrato(r)) continue;
      const tipo = r.tipo_contrato.trim();
      if (!map[tipo]) map[tipo] = { leads: 0, propostas: 0, vendas: 0, prevFat: 0, fatVendas: 0 };
      const d = map[tipo];
      d.leads++;
      d.propostas++;
      if (valorValido(r)) d.prevFat += r.valor_total;
      if (normStatus(r.status) === 'CONTRATO FECHADO') {
        d.vendas++;
        if (valorValido(r)) d.fatVendas += r.valor_total;
      }
    }
    return Object.entries(map)
      .map(([tipo, d]) => ({
        tipo,
        ...d,
        conversao: d.propostas > 0 ? (d.vendas / d.propostas) * 100 : 0,
      }))
      .sort((a, b) => b.propostas - a.propostas);
  }

  // ── Por Fonte do Lead ──────────────────────────────────────────────────
  function byFonte(records) {
    const map = {};
    for (const r of records) {
      const f = r.fonte_lead || '(sem fonte)';
      if (!map[f]) map[f] = { leads: 0, propostas: 0, vendas: 0, prevFat: 0, fatVendas: 0 };
      const d = map[f];
      d.leads++;
      if (temContrato(r)) {
        d.propostas++;
        if (valorValido(r)) d.prevFat += r.valor_total;
      }
      if (normStatus(r.status) === 'CONTRATO FECHADO') {
        d.vendas++;
        if (valorValido(r)) d.fatVendas += r.valor_total;
      }
    }
    return Object.entries(map)
      .map(([fonte, d]) => ({
        fonte,
        ...d,
        conversao: d.propostas > 0 ? (d.vendas / d.propostas) * 100 : 0,
      }))
      .sort((a, b) => b.propostas - a.propostas);
  }

  // ── Por Vendedor ───────────────────────────────────────────────────────
  function byVendedor(records) {
    const map = {};
    for (const r of records) {
      const v = r.vendedor || '(sem vendedor)';
      if (!map[v]) map[v] = { leads: 0, propostas: 0, vendas: 0, prevFat: 0, fatVendas: 0 };
      const d = map[v];
      d.leads++;
      if (temContrato(r)) {
        d.propostas++;
        if (valorValido(r)) d.prevFat += r.valor_total;
      }
      if (normStatus(r.status) === 'CONTRATO FECHADO') {
        d.vendas++;
        if (valorValido(r)) d.fatVendas += r.valor_total;
      }
    }
    return Object.entries(map)
      .map(([vendedor, d]) => ({
        vendedor,
        ...d,
        conversao: d.propostas > 0 ? (d.vendas / d.propostas) * 100 : 0,
      }))
      .sort((a, b) => b.propostas - a.propostas);
  }

  // ── Valores únicos para filtros ────────────────────────────────────────
  function uniqueValues(records, field) {
    const set = new Set();
    for (const r of records) {
      const v = field === 'status' ? normStatus(r.status) : r[field];
      if (v) set.add(v);
    }
    return [...set].sort();
  }

  // ── Formatadores ───────────────────────────────────────────────────────
  const fmtBRL = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
  const fmtPct = v => `${(v || 0).toFixed(2).replace('.', ',')}%`;
  const fmtNum = v => (v || 0).toLocaleString('pt-BR');
  const fmtBRLShort = v => {
    if (!v) return 'R$ 0';
    if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M`;
    if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1).replace('.', ',')}K`;
    return fmtBRL(v);
  };

  // ── Por Curva ABC ──────────────────────────────────────────────────────
  function byCurva(records) {
    const map = {};
    for (const c of CURVAS_ORDEM) map[c] = [];
    for (const r of records) {
      const c = r.curva_abc_cliente || 'Sem classificação';
      if (map[c] !== undefined) map[c].push(r); else map['Sem classificação'].push(r);
    }
    const totalFat = records.reduce((s, r) =>
      normStatus(r.status) === 'CONTRATO FECHADO' && valorValido(r) ? s + r.valor_total : s, 0);
    const totalVendas = records.filter(r => normStatus(r.status) === 'CONTRATO FECHADO').length;

    return CURVAS_ORDEM.map(curva => {
      const regs = map[curva];
      let propostas = 0, vendas = 0, prevFat = 0, fatVendas = 0, vendasComValor = 0;
      for (const r of regs) {
        if (temContrato(r)) { propostas++; if (valorValido(r)) prevFat += r.valor_total; }
        if (normStatus(r.status) === 'CONTRATO FECHADO') {
          vendas++;
          if (valorValido(r)) { fatVendas += r.valor_total; vendasComValor++; }
        }
      }
      const conversao = propostas > 0 ? vendas / propostas * 100 : 0;
      const ticketMedio = vendasComValor > 0 ? fatVendas / vendasComValor : null;
      const participacaoFat = totalFat > 0 ? fatVendas / totalFat * 100 : 0;
      const participacaoVendas = totalVendas > 0 ? vendas / totalVendas * 100 : 0;
      return {
        curva, faixa: CURVAS_FAIXAS[curva], cor: CURVAS_CORES[curva],
        registros: regs.length, propostas, vendas, conversao,
        prevFat, fatVendas, ticketMedio,
        vendasSemValor: vendas - vendasComValor,
        participacaoFat, participacaoVendas,
      };
    });
  }

  // Filtro sem status (página Qualidade de Vendas)
  function filterQualidade(records, f) {
    return records.filter(r => {
      if (f.months?.length && !f.months.includes(r.mes_numero)) return false;
      if (f.vendedor && r.vendedor !== f.vendedor) return false;
      if (f.fonte && r.fonte_lead !== f.fonte) return false;
      if (f.tipo && r.tipo_contrato !== f.tipo) return false;
      if (f.curva && (r.curva_abc_cliente || 'Sem classificação') !== f.curva) return false;
      return true;
    });
  }

  // ── Tabulação cruzada (Vendedor/Fonte/Tipo × Curva) ───────────────────
  function crossTabMetric(records, rowField) {
    const CURVAS = ['A+', 'A', 'B', 'C', 'D', 'Sem classificação'];
    const rowMap = {};
    for (const r of records) {
      const rk = (rowField === 'curva_abc_cliente' ? r.curva_abc_cliente : r[rowField]) || '(sem)';
      const cv = r.curva_abc_cliente || 'Sem classificação';
      if (!rowMap[rk]) rowMap[rk] = {};
      if (!rowMap[rk][cv]) rowMap[rk][cv] = { propostas: 0, vendas: 0, fatVendas: 0, prevFat: 0, vcv: 0 };
      const c = rowMap[rk][cv];
      if (temContrato(r)) { c.propostas++; if (valorValido(r)) c.prevFat += r.valor_total; }
      if (normStatus(r.status) === 'CONTRATO FECHADO') {
        c.vendas++;
        if (valorValido(r)) { c.fatVendas += r.valor_total; c.vcv++; }
      }
    }
    const result = Object.entries(rowMap).map(([row, cm]) => {
      const cells = {};
      let rp = 0, rv = 0, rf = 0;
      for (const cv of CURVAS) {
        const d = cm[cv] || { propostas: 0, vendas: 0, fatVendas: 0, prevFat: 0, vcv: 0 };
        cells[cv] = { ...d, conversao: d.propostas > 0 ? d.vendas / d.propostas * 100 : 0, ticketMedio: d.vcv > 0 ? d.fatVendas / d.vcv : null };
        rp += d.propostas; rv += d.vendas; rf += d.fatVendas;
      }
      const rConv = rp > 0 ? rv / rp * 100 : 0;
      return { row, cells, totals: { propostas: rp, vendas: rv, fatVendas: rf, conversao: rConv } };
    });
    result.sort((a, b) => b.totals.propostas - a.totals.propostas);
    return { rows: result, curvas: CURVAS };
  }

  return { filter, filterQualidade, kpis, byMonth, byStatus, byTipoContrato, byFonte, byVendedor,
           byCurva, crossTabMetric, uniqueValues, fmtBRL, fmtPct, fmtNum, fmtBRLShort,
           MES_NOME, MES_NOME_FULL, ALL_MONTHS, CURVAS_ORDEM, CURVAS_FAIXAS, CURVAS_CORES };
})();
