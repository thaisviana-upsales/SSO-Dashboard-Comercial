/**
 * engine.js — Motor de cálculo SSO Dashboard
 * Todas as funções são puras: recebem registros, retornam métricas.
 * NUNCA modifica os dados originais.
 *
 * REGRA DE DATAS (jul/2026+) — TRS EVENTOS INDEPENDENTES:
 *   1. Lead/Oportunidade   → data_referencia    (coluna B da planilha) → mes_numero
 *   2. Proposta Enviada    → data_envio_orcamento                       → mes_envio_numero
 *   3. Venda / Faturamento → data_fechamento     (CONTRATO FECHADO)     → mes_fechamento_numero
 *
 * Para registros históricos (EXCEL_HISTORICO, jan-jun 2026) que NÃO têm
 * data_fechamento nem data_envio_orcamento, usa-se data_referencia como
 * fallback em todos os eventos — mantendo comportamento anterior para
 * jan-jun sem quebrar nada.
 *
 * REGRA DO FILTRO MENSAL:
 *   Um registro aparece no conjunto "filtered" de um mês M se:
 *     - mes_numero == M (tem oportunidade em M), OU
 *     - mes_envio_numero == M (tem proposta enviada em M), OU
 *     - status=CONTRATO FECHADO E mes_fechamento_numero == M (tem venda em M)
 *
 *   Dentro do conjunto filtrado, cada função conta o evento pelo
 *   campo de data correto:
 *     - kpis.leads     ← mes_numero == M (ou fallback)
 *     - kpis.propostas ← mes_envio_numero == M (ou fallback)
 *     - kpis.vendas    ← mes_fechamento_numero == M (ou fallback)
 */
const Engine = (() => {

  // ── Helpers ────────────────────────────────────────────────────────────
  const normStatus  = s => (s || '').trim().toUpperCase();
  const temContrato = r => !!(r.tipo_contrato && r.tipo_contrato.trim());
  const valorValido = r => r.valor_total !== null && r.valor_total !== undefined && !r.flag_valor_invalido;

  /**
   * Mês do FECHAMENTO da venda:
   * - GOOGLE_SHEETS_LIVE com data_fechamento → mes_fechamento_numero
   * - EXCEL_HISTORICO ou sem data_fechamento → fallback para mes_numero
   */
  function mesFechamento(r) {
    return r.mes_fechamento_numero ?? r.mes_numero ?? null;
  }

  /**
   * Mês do ENVIO do orçamento (proposta):
   * - GOOGLE_SHEETS_LIVE com data_envio_orcamento → mes_envio_numero
   * - fallback para mes_numero (histórico ou sem data de envio)
   */
  function mesEnvio(r) {
    return r.mes_envio_numero ?? r.mes_numero ?? null;
  }

  /**
   * Mês da OPORTUNIDADE (data_referencia / coluna B).
   * Para históricos sem data_referencia, usa mes_numero direto.
   */
  function mesOportunidade(r) {
    return r.mes_numero ?? null;
  }

  /** true se o registro tem venda efetivada nos meses informados */
  function vendaNosMeses(r, meses) {
    if (!meses?.length) return true;
    return meses.includes(mesFechamento(r));
  }

  // ── Constantes Curva ABC ───────────────────────────────────────────────
  const CURVAS_ORDEM  = ['A+', 'A', 'B', 'C', 'D', 'Sem classificação'];
  const CURVAS_FAIXAS = { 'A+':'≥ 120 func.','A':'80–119 func.','B':'50–79 func.','C':'11–49 func.','D':'0–10 func.','Sem classificação':'—' };
  const CURVAS_CORES  = { 'A+':'#1A7A4A','A':'#4E6AF5','B':'#C98A5B','C':'#85200C','D':'#667085','Sem classificação':'#98A2B3' };

  // ── Filtro de data por campo (oportunidade vs venda) ──────────────────
  function _oportunidadeInRange(record, f) {
    if (!f.dateStart && !f.dateEnd) return true;
    const dr = record.data_referencia;
    if (!dr) return false;
    if (f.dateStart && dr < f.dateStart) return false;
    if (f.dateEnd   && dr > f.dateEnd)   return false;
    return true;
  }

  function _vendaInRange(record, f) {
    if (!f.dateStart && !f.dateEnd) return true;
    const df = record.data_fechamento || record.data_referencia;
    if (!df) return false;
    if (f.dateStart && df < f.dateStart) return false;
    if (f.dateEnd   && df > f.dateEnd)   return false;
    return true;
  }

  const _dateInRange = _oportunidadeInRange;

  // ── Filtro global de registros ───────────────────────────────────────
  /**
   * filter — seleciona registros antes de calcular KPIs.
   *
   * Filtro de mês usa lógica OR (3 eventos independentes):
   *   ⨁ mes_numero (data_referencia) está no filtro (lead/oportunidade)
   *   ⨁ mes_envio_numero (data_envio_orcamento) está no filtro (proposta)
   *   ⨁ mes_fechamento_numero (data_fechamento) está no filtro E status=CONTRATO FECHADO (venda)
   *
   * Uma linha com coluna B vazia entra se tiver proposta ou venda no mês.
   */
  function filter(records, f) {
    return records.filter(r => {
      // Filtro de mês: OR dos 3 eventos
      if (f.months?.length) {
        const st = normStatus(r.status);
        const mOpp   = r.mes_numero          ?? null;
        const mEnvio = r.mes_envio_numero    ?? null;
        const mFech  = r.mes_fechamento_numero ?? null;

        const evtOpp   = mOpp   !== null && f.months.includes(mOpp);
        const evtProp  = mEnvio !== null && f.months.includes(mEnvio);
        const evtVenda = mFech  !== null && f.months.includes(mFech)
                         && st === 'CONTRATO FECHADO';

        const isFallback = r.source_type === 'EXCEL_HISTORICO'
                           || (!r.data_envio_orcamento && !r.data_fechamento);
        if (isFallback) {
          if (!evtOpp) return false;
        } else {
          if (!evtOpp && !evtProp && !evtVenda) return false;
        }
      }
      if (f.vendedor?.length && !f.vendedor.includes(r.vendedor))          return false;
      if (f.fonte?.length    && !f.fonte.includes(r.fonte_lead))           return false;
      if (f.status?.length   && !f.status.includes(normStatus(r.status)))  return false;
      if (f.tipo?.length     && !f.tipo.includes(r.tipo_contrato))         return false;
      
      // Filtro de data exato (dateStart/dateEnd) usa data_referencia para oportunidade
      if (f.dateStart || f.dateEnd) {
        const dr = r.data_referencia;
        if (!dr) {
          const alt = r.data_envio_orcamento || r.data_fechamento;
          if (!alt) return false;
          if (f.dateStart && alt < f.dateStart) return false;
          if (f.dateEnd   && alt > f.dateEnd)   return false;
        } else {
          if (f.dateStart && dr < f.dateStart) return false;
          if (f.dateEnd   && dr > f.dateEnd)   return false;
        }
      }
      return true;
    });
  }

  function filterQualidade(records, f) {
    return records.filter(r => {
      if (f.months?.length && !f.months.includes(r.mes_numero)) return false;
      if (f.vendedor && r.vendedor !== f.vendedor) return false;
      if (f.fonte && r.fonte_lead !== f.fonte) return false;
      if (f.tipo && r.tipo_contrato !== f.tipo) return false;
      if (f.curva && (r.curva_abc_cliente || 'Sem classificação') !== f.curva) return false;
      if (!_dateInRange(r, f)) return false;
      return true;
    });
  }

  // ── KPIs ────────────────────────────────────────────────────────────
  /**
   * kpis — calcula indicadores para um conjunto de registros.
   *
   * @param records  Registros já passados pelo filter() (contêm todos os
   *                 registros relevantes para o período: opps, propostas e vendas).
   * @param months   Meses selecionados. Cada evento só é contado quando o
   *                 seu campo de data específico está nesses meses.
   *
   * SEPARAÇÃO POR TIPO DE EVENTO:
   *   leads     → mes_numero (data_referencia) no filtro
   *   propostas → mes_envio_numero (data_envio_orcamento) no filtro
   *   vendas    → CONTRATO FECHADO E mes_fechamento_numero (data_fechamento) no filtro
   *   prevFat   → soma valor_total das propostas (mesmo conjunto de propostas)
   *   fatVendas → soma valor_total das vendas
   */
  function kpis(records, months) {
    let leads = 0, propostas = 0, vendas = 0, abertas = 0, recusadas = 0;
    let prevFat = 0, fatVendas = 0;

    for (const r of records) {
      const st = normStatus(r.status);

      // ─ LEAD: contar pelo mês da oportunidade (data_referencia) ────────────
      const mOpp = mesOportunidade(r);
      const isFallbackLead = r.source_type === 'EXCEL_HISTORICO'
                             || (!r.data_envio_orcamento && !r.data_fechamento);
      const leadNoMes = !months?.length
        || (isFallbackLead ? months.includes(mOpp) : mOpp !== null && months.includes(mOpp));
      if (leadNoMes) {
        leads++;
      }

      // ─ PROPOSTA: contar pelo mês do envio do orçamento ─────────────────
      const mEnv = mesEnvio(r);
      const propostaNoMes = !months?.length
        || (mEnv !== null && months.includes(mEnv));
      if (propostaNoMes && temContrato(r)) {
        propostas++;
        if (valorValido(r)) prevFat += r.valor_total;
      }

      // ─ STATUS (abertas / recusadas) ───────────────────────────────
      if (st === 'PROPOSTA ENVIADA') abertas++;
      else if (st === 'RECUSADO')    recusadas++;

      // ─ VENDA: contar pelo mês do fechamento (data_fechamento) ──────────
      if (st === 'CONTRATO FECHADO') {
        const mFech = mesFechamento(r);
        const vendaNoFiltro = !months?.length
          || (mFech !== null && months.includes(mFech));
        if (vendaNoFiltro) {
          vendas++;
          if (valorValido(r)) fatVendas += r.valor_total;
        }
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
  const MES_NOME      = {1:'Jan',2:'Fev',3:'Mar',4:'Abr',5:'Mai',6:'Jun',7:'Jul',8:'Ago',9:'Set',10:'Out',11:'Nov',12:'Dez'};
  const MES_NOME_FULL = {1:'Janeiro',2:'Fevereiro',3:'Março',4:'Abril',5:'Maio',6:'Junho',7:'Julho',8:'Agosto',9:'Setembro',10:'Outubro',11:'Novembro',12:'Dezembro'};
  const ALL_MONTHS    = [1,2,3,4,5,6,7,8,9,10,11,12];

  /**
   * byMonth — agrega métricas por mês.
   *
   * Leads/propostas: agrupados por mes_numero (data_referencia).
   * Vendas/faturamento: agrupados por mesFechamento(r) (data_fechamento).
   *
   * Resultado: cada mês exibe os leads criados naquele mês E as vendas
   * fechadas naquele mês (que podem ser de oportunidades de meses anteriores).
   */
  function byMonth(records, monthsToShow = ALL_MONTHS) {
    // Mapa por mês de OPORTUNIDADE (data_referencia / mes_numero)
    const mapOpp = {};
    // Mapa por mês de PROPOSTA (data_envio_orcamento / mes_envio_numero)
    const mapProp = {};
    // Mapa por mês de VENDA (data_fechamento / mes_fechamento_numero)
    const mapVenda = {};

    for (const m of monthsToShow) {
      mapOpp[m]   = { leads: 0 };
      mapProp[m]  = { propostas: 0, prevFat: 0, abertas: 0, recusadas: 0 };
      mapVenda[m] = { vendas: 0, fatVendas: 0 };
    }

    for (const r of records) {
      const st  = normStatus(r.status);
      const isHistorico = r.source_type === 'EXCEL_HISTORICO'
                          || (!r.data_envio_orcamento && !r.data_fechamento);

      // ─ Lead: conta pelo mes_numero (data_referencia) ─────────────────
      const mOpp = r.mes_numero ?? null;
      if (mOpp !== null && mapOpp[mOpp]) {
        mapOpp[mOpp].leads++;
      }

      // ─ Proposta: conta pelo mes_envio_numero (data_envio_orcamento) ───
      const mEnv = isHistorico ? mOpp : (r.mes_envio_numero ?? null);
      if (mEnv !== null && mapProp[mEnv] && temContrato(r)) {
        mapProp[mEnv].propostas++;
        if (valorValido(r)) mapProp[mEnv].prevFat += r.valor_total;
      }
      if (mEnv !== null && mapProp[mEnv]) {
        if (st === 'PROPOSTA ENVIADA') mapProp[mEnv].abertas++;
        else if (st === 'RECUSADO')    mapProp[mEnv].recusadas++;
      }

      // ─ Venda: conta pelo mes_fechamento_numero (data_fechamento) ──────
      if (st === 'CONTRATO FECHADO') {
        const mV = isHistorico ? mOpp : mesFechamento(r);
        if (mV !== null && mapVenda[mV]) {
          mapVenda[mV].vendas++;
          if (valorValido(r)) mapVenda[mV].fatVendas += r.valor_total;
        }
      }
    }

    return monthsToShow.map(m => {
      const o = mapOpp[m];
      const p = mapProp[m];
      const v = mapVenda[m];
      const conversao = o.leads > 0 ? (v.vendas / o.leads) * 100 : 0;
      return {
        mes      : m,
        label    : MES_NOME[m],
        labelFull: MES_NOME_FULL[m],
        leads    : o.leads,
        propostas: p.propostas,
        abertas  : p.abertas,
        recusadas: p.recusadas,
        prevFat  : p.prevFat,
        vendas   : v.vendas,
        fatVendas: v.fatVendas,
        conversao,
      };
    });
  }

  // ── Por Status ─────────────────────────────────────────────────────────
  function byStatus(records) {
    const map = {};
    for (const r of records) {
      const st = normStatus(r.status) || '(sem status)';
      map[st] = (map[st] || 0) + 1;
    }
    const PRIORITY = { 'CONTRATO FECHADO': 0, 'PROPOSTA ENVIADA': 1, 'RECUSADO': 2 };
    return Object.entries(map)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => {
        const pa = PRIORITY[a.status] ?? 99;
        const pb = PRIORITY[b.status] ?? 99;
        return pa !== pb ? pa - pb : b.count - a.count;
      });
  }

  // ── Por Tipo de Contrato ─────────────────────────────────────────────
  /**
   * Leads/propostas: agrupados por mes_numero (data_referencia).
   * Vendas/faturamento: CONTRATO FECHADO agrupados por mes_fechamento_numero.
   *
   * months: array de meses selecionados. [] ou undefined = todos.
   */
  function byTipoContrato(records, months) {
    const map = {};
    for (const r of records) {
      if (!temContrato(r)) continue;
      const tipo = r.tipo_contrato.trim();
      if (!map[tipo]) map[tipo] = { leads: 0, propostas: 0, vendas: 0, prevFat: 0, fatVendas: 0 };
      const d = map[tipo];
      const st = normStatus(r.status);
      const isHistorico = r.source_type === 'EXCEL_HISTORICO'
                          || (!r.data_envio_orcamento && !r.data_fechamento);

      // Lead pelo mes_numero
      const mOpp = r.mes_numero ?? null;
      const leadNoMes = !months?.length
        || (mOpp !== null && months.includes(mOpp));
      if (leadNoMes) d.leads++;

      // Proposta pelo mes_envio_numero (ou fallback mes_numero no histórico)
      const mEnv = isHistorico ? mOpp : (r.mes_envio_numero ?? null);
      const propostaNoMes = !months?.length
        || (mEnv !== null && months.includes(mEnv));
      if (propostaNoMes) {
        d.propostas++;
        if (valorValido(r)) d.prevFat += r.valor_total;
      }

      // Venda pelo mes_fechamento_numero (ou fallback mes_numero no histórico)
      if (st === 'CONTRATO FECHADO') {
        const mFech = isHistorico ? mOpp : mesFechamento(r);
        const vendaNoMes = !months?.length
          || (mFech !== null && months.includes(mFech));
        if (vendaNoMes) {
          d.vendas++;
          if (valorValido(r)) d.fatVendas += r.valor_total;
        }
      }
    }
    return Object.entries(map)
      .map(([tipo, d]) => ({
        tipo, ...d,
        conversao: d.leads > 0 ? (d.vendas / d.leads) * 100 : 0,
      }))
      .sort((a, b) => b.propostas - a.propostas);
  }

  // ── Por Fonte do Lead ───────────────────────────────────────────────
  function byFonte(records, months) {
    const map = {};
    for (const r of records) {
      const f = r.fonte_lead || '(sem fonte)';
      if (!map[f]) map[f] = { leads: 0, propostas: 0, vendas: 0, prevFat: 0, fatVendas: 0 };
      const d = map[f];
      const st = normStatus(r.status);
      const isHistorico = r.source_type === 'EXCEL_HISTORICO'
                          || (!r.data_envio_orcamento && !r.data_fechamento);

      // Lead pelo mes_numero
      const mOpp = r.mes_numero ?? null;
      const leadNoMes = !months?.length
        || (mOpp !== null && months.includes(mOpp));
      if (leadNoMes) d.leads++;

      // Proposta pelo mes_envio_numero (ou fallback mes_numero no histórico)
      const mEnv = isHistorico ? mOpp : (r.mes_envio_numero ?? null);
      const propostaNoMes = !months?.length
        || (mEnv !== null && months.includes(mEnv));
      if (propostaNoMes && temContrato(r)) {
        d.propostas++;
        if (valorValido(r)) d.prevFat += r.valor_total;
      }

      // Venda pelo mes_fechamento_numero (ou fallback mes_numero no histórico)
      if (st === 'CONTRATO FECHADO') {
        const mFech = isHistorico ? mOpp : mesFechamento(r);
        const vendaNoMes = !months?.length
          || (mFech !== null && months.includes(mFech));
        if (vendaNoMes) {
          d.vendas++;
          if (valorValido(r)) d.fatVendas += r.valor_total;
        }
      }
    }
    return Object.entries(map)
      .map(([fonte, d]) => ({
        fonte, ...d,
        conversao: d.leads > 0 ? (d.vendas / d.leads) * 100 : 0,
      }))
      .sort((a, b) => b.propostas - a.propostas);
  }

  // ── Por Vendedor ───────────────────────────────────────────────────────────────────
  /**
   * months: array de meses selecionados. [] ou undefined = todos.
   * - Leads/propostas: contados quando mes_numero está no filtro
   * - Vendas/faturamento: contados quando mes_fechamento_numero está no filtro
   *   (suporta registros de transição: opp de mês anterior fechada no mês filtrado)
   */
  function byVendedor(records, months) {
    const map = {};
    for (const r of records) {
      const v = r.vendedor || '(sem vendedor)';
      if (!map[v]) map[v] = { leads: 0, propostas: 0, vendas: 0, prevFat: 0, fatVendas: 0 };
      const d = map[v];
      const st = normStatus(r.status);
      const isHistorico = r.source_type === 'EXCEL_HISTORICO'
                          || (!r.data_envio_orcamento && !r.data_fechamento);

      // Lead pelo mes_numero (data_referencia)
      const mOpp = r.mes_numero ?? null;
      const leadNoMes = !months?.length
        || (mOpp !== null && months.includes(mOpp));
      if (leadNoMes) d.leads++;

      // Proposta pelo mes_envio_numero (data_envio_orcamento)
      // Fallback para mes_numero no histórico (EXCEL_HISTORICO)
      const mEnv = isHistorico ? mOpp : (r.mes_envio_numero ?? null);
      const propostaNoMes = !months?.length
        || (mEnv !== null && months.includes(mEnv));
      if (propostaNoMes && temContrato(r)) {
        d.propostas++;
        if (valorValido(r)) d.prevFat += r.valor_total;
      }

      // Venda pelo mes_fechamento_numero (data_fechamento)
      // Fallback para mes_numero no histórico
      if (st === 'CONTRATO FECHADO') {
        const mFech = isHistorico ? mOpp : mesFechamento(r);
        const vendaNoMes = !months?.length
          || (mFech !== null && months.includes(mFech));
        if (vendaNoMes) {
          d.vendas++;
          if (valorValido(r)) d.fatVendas += r.valor_total;
        }
      }
    }
    return Object.entries(map)
      .map(([vendedor, d]) => ({
        vendedor, ...d,
        conversao: d.leads > 0 ? (d.vendas / d.leads) * 100 : 0,
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
    const totalFat    = records.reduce((s, r) =>
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
      const participacaoFat    = totalFat    > 0 ? fatVendas / totalFat    * 100 : 0;
      const participacaoVendas = totalVendas > 0 ? vendas    / totalVendas * 100 : 0;
      return {
        curva, faixa: CURVAS_FAIXAS[curva], cor: CURVAS_CORES[curva],
        registros: regs.length, propostas, vendas, conversao,
        prevFat, fatVendas, ticketMedio,
        vendasSemValor: vendas - vendasComValor,
        participacaoFat, participacaoVendas,
      };
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

  return {
    filter, filterQualidade, kpis, byMonth, byStatus,
    byTipoContrato, byFonte, byVendedor,
    byCurva, crossTabMetric, uniqueValues,
    fmtBRL, fmtPct, fmtNum, fmtBRLShort,
    MES_NOME, MES_NOME_FULL, ALL_MONTHS,
    CURVAS_ORDEM, CURVAS_FAIXAS, CURVAS_CORES,
    // Helpers exportados para uso em app.js se necessário
    mesFechamento, vendaNosMeses,
  };
})();
