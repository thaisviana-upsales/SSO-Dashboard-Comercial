-- =============================================================================
-- Migration: 20260728130000_reset_google_sheets_live.sql
-- Reset de Registros Live com IDs Instáveis — Dashboard SSO
--
-- CONTEXTO:
--   Múltiplas chamadas a gerarIdsAusentes() gravaram UUIDs random nas células
--   da planilha. Cada sync que leu um UUID diferente criou um novo registro
--   no Supabase em vez de atualizar o existente.
--
-- CORREÇÃO APLICADA NO CÓDIGO (já commitada antes desta migration):
--   - Code.js: lerDadosSanitizados() SEMPRE usa makeDeterministicId()
--   - engine.js: todas as funções byX() deduplicam vendas por source_record_id
--   - sync-sheets/index.ts: reconciliação sem UUID_REGEX
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Inativa TODOS os GOOGLE_SHEETS_LIVE ativos (IDs instáveis)
--   2. O próximo sync recria com IDs determinísticos estáveis
--
-- ⚠ SEQUÊNCIA OBRIGATÓRIA:
--   1. Execute esta migration
--   2. Publique nova versão do Apps Script com Code.js corrigido
--   3. Clique em Sincronizar no dashboard
--   4. Execute as queries de auditoria pós-sync abaixo
--
-- ⚠ HISTÓRICO JAN-JUN (EXCEL_HISTORICO) NÃO É TOCADO.
-- =============================================================================

-- ── PRÉ-RESET: estado atual por aba ──────────────────────────────────────────
SELECT
  source_sheet,
  COUNT(*)                                                          AS total_ativos,
  COUNT(CASE WHEN UPPER(TRIM(COALESCE(status,''))) = 'CONTRATO FECHADO'
                  AND data_fechamento >= '2026-07-01' THEN 1 END)  AS vendas_julho,
  SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) = 'CONTRATO FECHADO'
                AND data_fechamento >= '2026-07-01'
           THEN COALESCE(valor_total, 0) ELSE 0 END)               AS faturamento_julho
FROM public.registros_comerciais
WHERE source_type = 'GOOGLE_SHEETS_LIVE'
  AND is_active   = true
GROUP BY source_sheet
ORDER BY source_sheet;

-- ── RESET ─────────────────────────────────────────────────────────────────────
UPDATE public.registros_comerciais
SET    is_active  = false,
       updated_at = NOW()
WHERE  source_type = 'GOOGLE_SHEETS_LIVE'
  AND  is_active   = true;

-- Confirmar reset: deve retornar 0
SELECT COUNT(*) AS live_ativos_apos_reset
FROM public.registros_comerciais
WHERE source_type = 'GOOGLE_SHEETS_LIVE'
  AND is_active   = true;

-- =============================================================================
-- QUERIES DE AUDITORIA PÓS-SYNC (rodar após sincronizar)
-- =============================================================================

-- 1. Contagem e faturamento por aba (julho)
SELECT
  source_sheet                                                     AS aba,
  COUNT(*)                                                         AS registros_ativos,
  COUNT(CASE WHEN UPPER(TRIM(COALESCE(status,''))) = 'CONTRATO FECHADO'
                  AND data_fechamento >= '2026-07-01'
                  AND data_fechamento <  '2026-08-01' THEN 1 END) AS vendas_julho,
  SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) = 'CONTRATO FECHADO'
                AND data_fechamento >= '2026-07-01'
                AND data_fechamento <  '2026-08-01'
           THEN COALESCE(valor_total, 0) ELSE 0 END)              AS faturamento_julho
FROM public.registros_comerciais
WHERE source_type = 'GOOGLE_SHEETS_LIVE'
  AND is_active   = true
GROUP BY source_sheet
ORDER BY source_sheet;
-- VINICIUS.26 esperado: vendas_julho=4, faturamento_julho=46637.30

-- 2. Verificar duplicatas verdadeiras por source_record_id (esperado: 0 linhas)
SELECT source_sheet, source_record_id, COUNT(*) AS qtd
FROM public.registros_comerciais
WHERE source_type = 'GOOGLE_SHEETS_LIVE'
  AND is_active   = true
GROUP BY source_sheet, source_record_id
HAVING COUNT(*) > 1
ORDER BY source_sheet;

-- 3. Detalhe VINICIUS.26 julho
SELECT source_record_id, data_referencia, data_fechamento, status, valor_total
FROM public.registros_comerciais
WHERE source_sheet = 'VINICIUS.26'
  AND source_type  = 'GOOGLE_SHEETS_LIVE'
  AND is_active    = true
  AND UPPER(TRIM(COALESCE(status,''))) = 'CONTRATO FECHADO'
  AND data_fechamento >= '2026-07-01'
  AND data_fechamento <  '2026-08-01'
ORDER BY data_fechamento;
-- Esperado: 4 linhas, SUM(valor_total) = 46637.30
