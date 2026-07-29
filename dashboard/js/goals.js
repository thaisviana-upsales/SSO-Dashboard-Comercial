/**
 * goals.js — Motor de Metas Comerciais SSO
 *
 * Funções puras: recebem dados, retornam métricas. Sem side-effects.
 *
 * REGRAS:
 *   - Meta não cadastrada ≠ meta zero (ausência é exibida como "Sem meta")
 *   - Mês sem vendedor → usa registro GERAL
 *   - Mês com vendedor → usa meta do vendedor
 *   - Período específico → meta proporcional (meta × dias_úteis_no_range / dias_úteis_mes)
 *   - Realizado = fatVendas já calculado pelo engine.js (CONTRATO FECHADO + data_fechamento)
 *
 * NORMALIZAÇÃO DE VENDEDOR (para comparação):
 *   - MAIÚSCULAS + sem espaços extras + sem acentos (só para lookup)
 *   - Identidade: VITORIA == VITÓRIA (lookup sem acento)
 *   - VINICIOS ≠ VINICIUS (nomes distintos — não unir)
 */

const Goals = (() => {

  // ── Feriados nacionais do Brasil em 2026 (configurável) ────────────────
  const FERIADOS_2026 = new Set([
    '2026-01-01', // Confraternização Universal
    '2026-04-03', // Paixão de Cristo
    '2026-04-21', // Tiradentes
    '2026-05-01', // Dia do Trabalhador
    '2026-09-07', // Independência do Brasil
    '2026-10-12', // N. Sra. Aparecida
    '2026-11-02', // Finados
    '2026-11-15', // Proclamação da República
    '2026-12-25', // Natal
  ]);

  // ── Constante para "sem meta" ────────────────────────────────────────
  const SEM_META = null;

  // ── Normalizar nome de vendedor para comparação (sem acento) ─────────
  function normVendedor(s) {
    return String(s || '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  // ── Contar dias úteis em um intervalo LOCAL (inclusivo) ───────────────
  /**
   * contarDiasUteis('2026-08-01', '2026-08-31') → número de dias úteis
   * Exclui sábados, domingos e feriados de FERIADOS_2026.
   */
  function contarDiasUteis(startStr, endStr) {
    const [sy, sm, sd] = startStr.split('-').map(Number);
    const [ey, em, ed] = endStr.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end   = new Date(ey, em - 1, ed);
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getDay(); // 0=Dom, 6=Sáb
      if (dow !== 0 && dow !== 6) {
        const iso = isoLocal(cur);
        if (!FERIADOS_2026.has(iso)) count++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  function isoLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ── Primeiro e último dia do mês ──────────────────────────────────────
  function primeiroDia(ano, mes) {
    return `${ano}-${String(mes).padStart(2,'0')}-01`;
  }
  function ultimoDia(ano, mes) {
    return isoLocal(new Date(ano, mes, 0));
  }

  // ── Buscar meta para (meses, vendedor) ───────────────────────────────
  /**
   * Retorna o valor da meta mensal somada dos meses selecionados.
   *
   * Regras:
   *  - Se vendedor especificado: usa meta do vendedor naquele mês
   *  - Sem vendedor: usa registro GERAL do mês
   *  - Mês sem registro: excluído da soma (não zero)
   *  - Se NENHUM mês tiver meta: retorna null ("Sem meta cadastrada")
   */
  function buscarMeta(metas, meses, vendedor) {
    if (!metas || !metas.length) return SEM_META;
    const alvo = vendedor ? normVendedor(vendedor) : 'GERAL';

    // Tenta encontrar pelo nome exato; se não, tenta por comparação sem acento
    const lookup = (mes) => {
      const exact = metas.find(
        m => m.mes === mes && normVendedor(m.vendedor) === alvo
      );
      if (exact) return exact;
      // Fallback: sem acento
      return metas.find(
        m => m.mes === mes && normVendedor(m.vendedor) === normVendedor(alvo)
      ) || null;
    };

    if (!meses || !meses.length) {
      // "Todos" — soma todos os meses com meta cadastrada
      const mesesComMeta = [...new Set(metas.filter(m =>
        m.vendedor === (vendedor ? alvo : 'GERAL') ||
        (!vendedor && m.vendedor === 'GERAL')
      ).map(m => m.mes))];
      if (!mesesComMeta.length) return SEM_META;
      let total = 0;
      let comMeta = 0;
      for (const mes of mesesComMeta) {
        const registro = lookup(mes);
        if (registro && registro.meta_mensal != null) {
          total += registro.meta_mensal;
          comMeta++;
        }
      }
      return comMeta > 0 ? total : SEM_META;
    }

    let total  = 0;
    let comMeta = 0;
    for (const mes of meses) {
      const registro = lookup(mes);
      if (registro && registro.meta_mensal != null) {
        total += registro.meta_mensal;
        comMeta++;
      }
    }
    return comMeta > 0 ? total : SEM_META;
  }

  // ── Calcular meta proporcional para data range ────────────────────────
  /**
   * calcularMetaProporcional — proporcionaliza a meta pelo período selecionado.
   *
   * Para cada mês que o range intersecta:
   *   contribuição = meta_mensal × dias_úteis_no_range_neste_mês / dias_úteis_mes
   *
   * Se dias_uteis_mes não estiver cadastrado, usa contarDiasUteis() do mês completo.
   * Se meta_mensal é null para um mês, contribuição = 0 (excluída da soma).
   *
   * Retorna { metaPeriodo, warning? }
   */
  function calcularMetaProporcional(metas, dateStart, dateEnd, vendedor) {
    if (!dateStart || !dateEnd) return { metaPeriodo: SEM_META };
    if (!metas || !metas.length) return { metaPeriodo: SEM_META };

    const [sy, sm] = dateStart.split('-').map(Number);
    const [ey, em] = dateEnd.split('-').map(Number);
    const alvo = vendedor ? normVendedor(vendedor) : 'GERAL';
    const warnings = [];

    let totalMeta  = 0;
    let algumaMeta = false;

    // Iterar mês a mês no range
    let curAno = sy, curMes = sm;
    while (curAno < ey || (curAno === ey && curMes <= em)) {
      const iniMes = primeiroDia(curAno, curMes);
      const fimMes = ultimoDia(curAno, curMes);

      // Intersecção do range com este mês
      const rangeIni = dateStart > iniMes ? dateStart : iniMes;
      const rangeFim = dateEnd   < fimMes ? dateEnd   : fimMes;

      if (rangeIni <= rangeFim) {
        // Procurar meta do mês
        const registro = metas.find(m =>
          m.mes === curMes && m.ano === curAno &&
          normVendedor(m.vendedor) === alvo
        ) || metas.find(m =>
          m.mes === curMes && m.ano === curAno && m.vendedor === 'GERAL'
        );

        if (registro && registro.meta_mensal != null) {
          const duMes = registro.dias_uteis_mes
            || contarDiasUteis(iniMes, fimMes);
          const duRange = contarDiasUteis(rangeIni, rangeFim);

          // Validar consistência dos dias úteis
          if (registro.dias_uteis_mes) {
            const duMesCalc = contarDiasUteis(iniMes, fimMes);
            if (Math.abs(duMes - duMesCalc) > 1) {
              warnings.push(
                `Mês ${curMes}/${curAno}: dias úteis cadastrado=${duMes} calculado=${duMesCalc}`
              );
            }
          }

          if (duMes > 0) {
            totalMeta += registro.meta_mensal * duRange / duMes;
            algumaMeta = true;
          }
        }
      }

      // Avançar mês
      curMes++;
      if (curMes > 12) { curMes = 1; curAno++; }
    }

    return {
      metaPeriodo: algumaMeta ? Math.round(totalMeta * 100) / 100 : SEM_META,
      warnings   : warnings.length ? warnings : undefined,
    };
  }

  // ── Meta proporcional até hoje (para ritmo) ────────────────────────────
  function calcularMetaAteHoje(metas, meses, vendedor, ano) {
    const hoje = isoLocal(new Date());
    if (!meses || !meses.length) return SEM_META;

    // Pega o mês atual (se estiver na seleção)
    const mesAtual = new Date().getMonth() + 1;
    if (!meses.includes(mesAtual)) return SEM_META;

    const alvo = vendedor ? normVendedor(vendedor) : 'GERAL';
    const registro = metas.find(m =>
      m.mes === mesAtual && normVendedor(m.vendedor) === alvo
    );
    if (!registro || registro.meta_mensal == null) return SEM_META;

    const iniMes = primeiroDia(ano || 2026, mesAtual);
    const duMes   = registro.dias_uteis_mes || contarDiasUteis(iniMes, ultimoDia(ano || 2026, mesAtual));
    const duAteHoje = contarDiasUteis(iniMes, hoje);
    if (duMes === 0) return SEM_META;
    return Math.round(registro.meta_mensal * duAteHoje / duMes * 100) / 100;
  }

  // ── KPIs de Metas ────────────────────────────────────────────────────
  /**
   * calcularKpisMetas — retorna todos os indicadores da seção Metas.
   *
   * @param metas       Array de metas carregadas do Supabase
   * @param state       Estado atual do dashboard (months, vendedor, dateStart, dateEnd)
   * @param fatVendas   Realizado = Engine.kpis().fatVendas
   */
  function calcularKpisMetas(metas, state, fatVendas) {
    const { months, vendedor, dateStart, dateEnd } = state;
    const realizado = fatVendas || 0;
    let meta, metaAteHoje;

    if (dateStart && dateEnd) {
      // Modo data específica: meta proporcional
      const result = calcularMetaProporcional(metas, dateStart, dateEnd, vendedor);
      meta        = result.metaPeriodo;
      metaAteHoje = SEM_META; // Não aplicável em modo de período específico
    } else {
      // Modo mensal
      meta        = buscarMeta(metas, months, vendedor);
      metaAteHoje = calcularMetaAteHoje(metas, months, vendedor, 2026);
    }

    if (meta == null) {
      return {
        meta        : SEM_META,
        realizado,
        atingimento : SEM_META,
        faltaMeta   : SEM_META,
        superado    : SEM_META,
        metaAteHoje : SEM_META,
        ritmo       : SEM_META,
        semMeta     : true,
      };
    }

    const atingimento  = meta > 0 ? (realizado / meta) * 100 : 0;
    const faltaMeta    = Math.max(meta - realizado, 0);
    const superado     = Math.max(realizado - meta, 0);
    const ritmo        = metaAteHoje != null && metaAteHoje > 0
      ? (realizado / metaAteHoje) * 100
      : SEM_META;

    return {
      meta,
      realizado,
      atingimento,
      faltaMeta,
      superado,
      metaAteHoje,
      ritmo,
      semMeta: false,
    };
  }

  // ── Ranking por Vendedor ──────────────────────────────────────────────
  /**
   * calcularRankingMetas — gera ranking de performance por vendedor.
   *
   * @param metas         Array de metas do Supabase
   * @param byVendedorData  Array retornado por Engine.byVendedor()
   * @param state         Estado do dashboard
   */
  function calcularRankingMetas(metas, byVendedorData, state) {
    const { months, dateStart, dateEnd } = state;
    const ranking = [];

    for (const v of byVendedorData) {
      const nomeVend = v.vendedor;
      const realizado = v.fatVendas || 0;
      let meta;

      if (dateStart && dateEnd) {
        const result = calcularMetaProporcional(metas, dateStart, dateEnd, nomeVend);
        meta = result.metaPeriodo;
      } else {
        meta = buscarMeta(metas, months, nomeVend);
      }

      const atingimento = meta != null && meta > 0
        ? (realizado / meta) * 100
        : SEM_META;
      const faltaMeta   = meta != null ? Math.max(meta - realizado, 0) : SEM_META;

      ranking.push({
        vendedor  : nomeVend,
        meta,
        realizado,
        atingimento,
        faltaMeta,
        semMeta   : meta == null,
      });
    }

    // Ordenar: com meta primeiro (por atingimento desc), depois sem meta
    ranking.sort((a, b) => {
      if (a.semMeta && !b.semMeta) return  1;
      if (!a.semMeta && b.semMeta) return -1;
      return (b.atingimento || 0) - (a.atingimento || 0);
    });

    return ranking;
  }

  // ── Cor da barra de progresso ─────────────────────────────────────────
  function corProgresso(pct) {
    if (pct == null) return 'var(--gray-400)';
    if (pct >= 100)  return '#16a34a';   // verde
    if (pct >= 70)   return '#d97706';   // âmbar
    return '#dc2626';                     // vermelho
  }

  // ── API pública ────────────────────────────────────────────────────────
  return {
    FERIADOS_2026,
    contarDiasUteis,
    normVendedor,
    buscarMeta,
    calcularMetaProporcional,
    calcularMetaAteHoje,
    calcularKpisMetas,
    calcularRankingMetas,
    corProgresso,
    SEM_META,
  };
})();
