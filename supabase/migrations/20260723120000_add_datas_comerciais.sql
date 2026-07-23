-- =============================================================================
-- Migration: 20260723120000_add_datas_comerciais.sql
-- Adiciona colunas de datas comerciais e atualiza view com regra de transição
-- =============================================================================

-- 1. Adicionar colunas de datas comerciais
ALTER TABLE public.registros_comerciais
  ADD COLUMN IF NOT EXISTS data_fechamento      DATE,
  ADD COLUMN IF NOT EXISTS data_envio_orcamento DATE;

-- 2. Índice para queries de vendas por data de fechamento
CREATE INDEX IF NOT EXISTS idx_registros_data_fechamento
  ON public.registros_comerciais(data_fechamento)
  WHERE data_fechamento IS NOT NULL;

-- 3. Recriar a view expondo os novos campos e aplicando regra de transição
--    Regra de transição: importar GOOGLE_SHEETS_LIVE quando:
--      A) data_referencia >= 01/07/2026 (oportunidade nova)
--      B) OU status = CONTRATO FECHADO E data_fechamento >= 01/07/2026
--         (oportunidade antiga fechada depois do corte)

DROP VIEW IF EXISTS public.view_dashboard_consolidado;

CREATE VIEW public.view_dashboard_consolidado
WITH (security_invoker = false) AS
SELECT
  id_registro,
  source_type,
  spreadsheet_id,
  source_sheet,
  source_record_id,
  data_referencia,
  mes_referencia,
  ano_referencia,
  data_fechamento,
  data_envio_orcamento,
  vendedor,
  quantidade_funcionarios,
  fonte_lead,
  valor_mensal,
  valor_total,
  status,
  tipo_contrato,
  tipo_base,
  situacao_contrato,
  numero_os,
  row_hash,
  is_active,
  created_at,
  updated_at,
  synced_at
FROM public.registros_comerciais
WHERE is_active = true
  AND (
    -- Histórico jan-jun: somente EXCEL_HISTORICO antes do corte
    (source_type = 'EXCEL_HISTORICO' AND data_referencia < DATE '2026-07-01')

    -- Live jul+: oportunidade nova (data_referencia >= corte)
    OR (source_type = 'GOOGLE_SHEETS_LIVE'
        AND data_referencia >= DATE '2026-07-01')

    -- Transição: oportunidade anterior ao corte, fechada depois do corte
    OR (source_type = 'GOOGLE_SHEETS_LIVE'
        AND UPPER(TRIM(status)) = 'CONTRATO FECHADO'
        AND data_fechamento >= DATE '2026-07-01')
  );

-- Garantir que anon possa ler a view
GRANT SELECT ON public.view_dashboard_consolidado TO anon;
GRANT SELECT ON public.view_dashboard_consolidado TO authenticated;
