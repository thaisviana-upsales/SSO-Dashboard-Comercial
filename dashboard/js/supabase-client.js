/**
 * supabase-client.js — Integração Supabase para o Dashboard SSO
 *
 * Fonte de dados:
 *   - Histórico jan-jun 2026: data.js estático (EXCEL_HISTORICO, 1.157 registros)
 *   - Live jul+ 2026: view_dashboard_consolidado (somente GOOGLE_SHEETS_LIVE)
 *
 * Regra de corte (espelha a view_dashboard_consolidado):
 *   - EXCEL_HISTORICO com data_referencia < 2026-07-01 → exibido
 *   - EXCEL_HISTORICO com data_referencia >= 2026-07-01 → NUNCA exibido
 *   - GOOGLE_SHEETS_LIVE com data_referencia >= 2026-07-01 → exibido
 *
 * SEGURANÇA: somente a anon key pública é usada. Nenhum segredo
 * (service_role, GOOGLE_APPS_SCRIPT_SECRET, etc.) é exposto.
 *
 * NÃO ALTERAR: migrations, banco, Apps Script, Edge Function.
 */
window.SSO_SUPABASE = (() => {
  // ── Configuração pública ─────────────────────────────────────────────
  const SUPABASE_URL  = 'https://wutmhhqbdwslwiawqwut.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1dG1oaHFiZHdzbHdpYXdxd3V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MjM4ODAsImV4cCI6MjA5NDQ5OTg4MH0.UJAXvBLgbruCH_41FeTJz1rAeoCJjtUZh4NVtfeexxA';

  /** A partir desta data, somente GOOGLE_SHEETS_LIVE é exibido. */
  const CORTE_DATA = '2026-07-01';

  const SYNC_URL = SUPABASE_URL + '/functions/v1/sync-sheets';
  /** A view já aplica o mesmo filtro de corte internamente. */
  const VIEW_URL = SUPABASE_URL + '/rest/v1/view_dashboard_consolidado?select=*&source_type=eq.GOOGLE_SHEETS_LIVE';

  const AUTH_HEADERS = {
    'apikey'       : SUPABASE_ANON,
    'Authorization': 'Bearer ' + SUPABASE_ANON,
    'Accept'       : 'application/json',
  };

  // ── Mapeamento de campos: view → Engine ──────────────────────────────
  // A view retorna campos do banco. O Engine espera campos calculados
  // (mes_numero, curva_abc_cliente, etc.) que o pipeline.py injeta no data.js.
  // Aqui os recalculamos para os registros live.
  function normalizarRegistroLive(r) {
    const mesNum = r.mes_referencia
      || (r.data_referencia ? parseInt(r.data_referencia.slice(5, 7), 10) : null);
    const qtdFunc = r.quantidade_funcionarios ?? null;

    // Curva ABC — mesma lógica do pipeline.py
    let curva = 'Sem classificação';
    if (qtdFunc !== null && qtdFunc !== undefined) {
      if      (qtdFunc >= 120) curva = 'A+';
      else if (qtdFunc >= 80)  curva = 'A';
      else if (qtdFunc >= 50)  curva = 'B';
      else if (qtdFunc >= 11)  curva = 'C';
      else                     curva = 'D';
    }

    return {
      // Campos originais preservados
      ...r,
      // Campos calculados esperados pelo Engine
      mes_numero             : mesNum,
      mes_nome               : mesNum ? (Engine.MES_NOME || {})[mesNum] : '',
      ano                    : r.ano_referencia
                               || (r.data_referencia ? parseInt(r.data_referencia.slice(0, 4), 10) : null),
      curva_abc_cliente      : curva,
      // valor_total null = inválido
      flag_valor_invalido    : r.valor_total === null || r.valor_total === undefined,
      tem_data_real          : !!r.data_referencia,
      quantidade_funcionarios: qtdFunc,
      // Compatibilidade com templates que usam aba_origem
      aba_origem             : r.source_sheet || null,
      linha_origem           : null,
      data_importacao        : r.created_at || null,
    };
  }

  // ── Buscar somente registros GOOGLE_SHEETS_LIVE da view ──────────────
  async function fetchLive() {
    const resp = await fetch(VIEW_URL, { headers: AUTH_HEADERS });
    if (!resp.ok) throw new Error('Erro ao buscar dados live: ' + resp.status);
    const registros = await resp.json();
    if (!Array.isArray(registros)) throw new Error('Resposta inesperada da view');
    // Garantia extra: somente live com data >= CORTE_DATA
    return registros
      .filter(r => r.source_type === 'GOOGLE_SHEETS_LIVE'
                && r.data_referencia >= CORTE_DATA)
      .map(normalizarRegistroLive);
  }

  // ── Disparar sincronização (Edge Function) ───────────────────────────
  async function dispararSync() {
    const resp = await fetch(SYNC_URL, {
      method : 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ trigger: 'manual_button_click' }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error('Sync error ' + resp.status + ': ' + txt);
    }
    return await resp.json();
  }

  /**
   * recarregarDados — Atualiza o array ALL in-place.
   *
   * Estratégia:
   *   1. Mantém todos os registros EXCEL_HISTORICO do array atual
   *      (já são jan-jun 2026, vindos do data.js — não substituir).
   *   2. Substitui os registros GOOGLE_SHEETS_LIVE pela versão fresca
   *      buscada da view (somente jul+ 2026).
   *
   * Resultado: histórico jan-jun intacto + live jul+ atualizado.
   */
  async function recarregarDados(arrayRef) {
    const liveAtualizado = await fetchLive();

    // Preserva histórico EXCEL_HISTORICO (jan-jun) sem tocar
    const historicoJanJun = arrayRef.filter(r => r.source_type === 'EXCEL_HISTORICO');

    // Substitui in-place mantendo a referência do array
    arrayRef.length = 0;
    arrayRef.push(...historicoJanJun, ...liveAtualizado);

    return {
      historico: historicoJanJun.length,
      live      : liveAtualizado.length,
      total     : arrayRef.length,
    };
  }

  return { dispararSync, recarregarDados, CORTE_DATA };
})();
