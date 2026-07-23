-- =============================================================================
-- Migration: 20260723200000_fix_definitivo_view_e_valores.sql
-- Correção Definitiva — Dashboard SSO
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Recria a view_dashboard_consolidado com:
--      a. Suporte a registros com data_referencia NULL (entrada por proposta/venda)
--      b. Coluna mes_envio_numero para agrupar propostas pelo mês correto
--      c. Condição OR para os 3 eventos independentes
--   2. Corrige os 4 valores de VINICIUS.26 com parsing errado (×10 ou ×100)
--   3. Garante que as linhas manuais (linha 6 R$35.337,60 e linha 13 R$1.400,00)
--      estejam presentes e com dados corretos
--   4. Adiciona índice para data_envio_orcamento
-- =============================================================================

-- ── 1. Adicionar índice para data_envio_orcamento (se ainda não existir) ─────
CREATE INDEX IF NOT EXISTS idx_registros_data_envio
  ON public.registros_comerciais(data_envio_orcamento)
  WHERE data_envio_orcamento IS NOT NULL;

-- ── 2. Garantir que data_referencia seja nullable ─────────────────────────────
-- A tabela original tem NOT NULL em data_referencia. Precisamos remover
-- para suportar linhas cuja coluna B está vazia mas têm proposta ou venda.
ALTER TABLE public.registros_comerciais
  ALTER COLUMN data_referencia DROP NOT NULL;

-- mes_referencia e ano_referencia também precisam ser nullable
ALTER TABLE public.registros_comerciais
  ALTER COLUMN mes_referencia DROP NOT NULL;

ALTER TABLE public.registros_comerciais
  ALTER COLUMN ano_referencia DROP NOT NULL;

-- ── 3. Recriar view_dashboard_consolidado ─────────────────────────────────────
-- Regra de inclusão (GOOGLE_SHEETS_LIVE): OR dos 3 eventos
--   evento_oportunidade = data_referencia >= 2026-07-01
--   evento_proposta     = data_envio_orcamento >= 2026-07-01
--   evento_venda        = status='CONTRATO FECHADO' e data_fechamento >= 2026-07-01

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
  -- Mês da oportunidade (data_referencia)
  CASE WHEN data_referencia IS NOT NULL
    THEN EXTRACT(MONTH FROM data_referencia)::INTEGER
    ELSE NULL
  END AS mes_numero,
  -- Data e mês do envio do orçamento (propostas)
  data_envio_orcamento,
  CASE WHEN data_envio_orcamento IS NOT NULL
    THEN EXTRACT(MONTH FROM data_envio_orcamento)::INTEGER
    ELSE NULL
  END AS mes_envio_numero,
  -- Data e mês do fechamento (vendas)
  data_fechamento,
  CASE WHEN data_fechamento IS NOT NULL
    THEN EXTRACT(MONTH FROM data_fechamento)::INTEGER
    ELSE NULL
  END AS mes_fechamento_numero,
  vendedor,
  quantidade_funcionarios,
  fonte_lead,
  valor_mensal,
  quantidade_parcelas,
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
    (source_type = 'EXCEL_HISTORICO'
     AND data_referencia < DATE '2026-07-01')

    -- Live jul+: evento oportunidade (data_referencia >= corte)
    OR (source_type = 'GOOGLE_SHEETS_LIVE'
        AND data_referencia >= DATE '2026-07-01')

    -- Live jul+: evento proposta (data_envio_orcamento >= corte)
    OR (source_type = 'GOOGLE_SHEETS_LIVE'
        AND data_envio_orcamento IS NOT NULL
        AND data_envio_orcamento >= DATE '2026-07-01')

    -- Live jul+: evento venda (CONTRATO FECHADO com data_fechamento >= corte)
    OR (source_type = 'GOOGLE_SHEETS_LIVE'
        AND UPPER(TRIM(COALESCE(status, ''))) = 'CONTRATO FECHADO'
        AND data_fechamento IS NOT NULL
        AND data_fechamento >= DATE '2026-07-01')
  );

-- Permissões
GRANT SELECT ON public.view_dashboard_consolidado TO anon;
GRANT SELECT ON public.view_dashboard_consolidado TO authenticated;

-- ── 4. Corrigir valores bugados de VINICIUS.26 ────────────────────────────────
-- Os source_record_ids corretos foram obtidos via SELECT na view.
-- Valores corretos baseados nos screenshots da planilha.

-- Registro ref=2026-07-01, PROPOSTA ENVIADA
-- Valor atual: 1.436.334,00 → Correto: 14.363,34
UPDATE public.registros_comerciais
SET valor_total = 14363.34,
    row_hash    = md5('fix_20260723_' || source_record_id),
    updated_at  = NOW()
WHERE source_record_id = '0c24f954-02d0-42de-b697-0c0dfb4a8efb'
  AND source_sheet = 'VINICIUS.26';

-- Registro ref=2026-07-03, PROPOSTA ENVIADA
-- Valor atual: 1.358.023,00 → Correto: 13.580,23
UPDATE public.registros_comerciais
SET valor_total = 13580.23,
    row_hash    = md5('fix_20260723_' || source_record_id),
    updated_at  = NOW()
WHERE source_record_id = '12133a8b-25f1-4b7d-91cf-f979a2adebc2'
  AND source_sheet = 'VINICIUS.26';

-- Registro ref=2026-07-10, PROPOSTA ENVIADA
-- Valor atual: 235.224,00 → Correto: 23.522,40
UPDATE public.registros_comerciais
SET valor_total = 23522.40,
    row_hash    = md5('fix_20260723_' || source_record_id),
    updated_at  = NOW()
WHERE source_record_id = '809a8603-8533-4c3d-91b7-2ff0321fc166'
  AND source_sheet = 'VINICIUS.26';

-- Registro ref=2026-07-10, CONTRATO FECHADO
-- Valor atual: 10.997,00 → Correto: 1.099,70
UPDATE public.registros_comerciais
SET valor_total = 1099.70,
    row_hash    = md5('fix_20260723_' || source_record_id),
    updated_at  = NOW()
WHERE source_record_id = '5ca4aa37-bae9-4626-930c-3129dfde38da'
  AND source_sheet = 'VINICIUS.26';

-- ── 5. Inserir linha 6 (R$35.337,60) — AUSENTE ───────────────────────────────
-- DATA=02/07/2026, DATA_FECHAMENTO=20/07/2026, STATUS=CONTRATO FECHADO
-- VALOR_MENSAL=2.944,80, PARCELAS=12, VALOR_TOTAL=35.337,60

INSERT INTO public.registros_comerciais (
  source_type, spreadsheet_id, source_sheet, source_record_id,
  data_referencia, mes_referencia, ano_referencia,
  data_fechamento, data_envio_orcamento,
  vendedor, fonte_lead, valor_mensal, quantidade_parcelas, valor_total,
  status, tipo_contrato, is_active,
  created_at, updated_at, synced_at, row_hash
)
SELECT
  'GOOGLE_SHEETS_LIVE',
  '1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE',
  'VINICIUS.26',
  'vinicius26-linha6-35337-fix-20260723',
  '2026-07-02', 7, 2026,
  '2026-07-20',  -- DATA FECHAMENTO (screenshot: 20/07/2026)
  '2026-07-02',  -- DATA ENVIO ORÇAMENTO
  'VINICIUS',
  NULL,
  2944.80, 12, 35337.60,
  'CONTRATO FECHADO',
  'Pacote SST',
  true,
  NOW(), NOW(), NOW(),
  md5('vinicius26-linha6-35337-fix-20260723')
WHERE NOT EXISTS (
  SELECT 1 FROM public.registros_comerciais
  WHERE source_record_id = 'vinicius26-linha6-35337-fix-20260723'
);

-- ── 6. Inserir linha 13 (R$1.400,00) — AUSENTE (coluna B vazia) ──────────────
-- DATA=NULL, DATA_FECHAMENTO=10/07/2026, STATUS=CONTRATO FECHADO
-- VALOR_MENSAL=280,00, PARCELAS=5, VALOR_TOTAL=1.400,00
-- Esta linha NÃO tem data_referencia (coluna B vazia na planilha)

INSERT INTO public.registros_comerciais (
  source_type, spreadsheet_id, source_sheet, source_record_id,
  data_referencia, mes_referencia, ano_referencia,
  data_fechamento, data_envio_orcamento,
  vendedor, fonte_lead, valor_mensal, quantidade_parcelas, valor_total,
  status, tipo_contrato, is_active,
  created_at, updated_at, synced_at, row_hash
)
SELECT
  'GOOGLE_SHEETS_LIVE',
  '1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE',
  'VINICIUS.26',
  'vinicius26-linha13-1400-fix-20260723',
  NULL, NULL, NULL,   -- coluna B vazia: data_referencia, mes, ano = NULL
  '2026-07-10',       -- DATA FECHAMENTO
  '2026-07-10',       -- DATA ENVIO ORÇAMENTO
  'VINICIUS',
  NULL,
  280.00, 5, 1400.00,
  'CONTRATO FECHADO',
  'Pacote SST',
  true,
  NOW(), NOW(), NOW(),
  md5('vinicius26-linha13-1400-fix-20260723')
WHERE NOT EXISTS (
  SELECT 1 FROM public.registros_comerciais
  WHERE source_record_id = 'vinicius26-linha13-1400-fix-20260723'
);

-- ── 7. Remover inserções manuais anteriores incorretas ────────────────────────
-- As migrations anteriores usavam source_record_ids genéricos que podem
-- ter causado conflito. Inativar para não duplicar.
UPDATE public.registros_comerciais
SET is_active = false, updated_at = NOW()
WHERE source_record_id IN (
  'linha6-vinicius26-manual-fix-00000001',
  'linha13-vinicius26-manual-fix-00000001'
)
AND source_sheet = 'VINICIUS.26';

-- ── 8. Validações ────────────────────────────────────────────────────────────

-- Verificar VINICIUS.26 na view após correções
-- SELECT source_record_id, data_referencia, data_fechamento, status, valor_total
-- FROM public.view_dashboard_consolidado
-- WHERE source_sheet = 'VINICIUS.26'
-- ORDER BY data_referencia;

-- Verificar 4 vendas de VINICIUS
-- SELECT data_fechamento, status, valor_total
-- FROM public.view_dashboard_consolidado
-- WHERE source_sheet = 'VINICIUS.26'
--   AND UPPER(TRIM(COALESCE(status,''))) = 'CONTRATO FECHADO'
-- ORDER BY data_fechamento;
-- Esperado: 4 linhas, total = 46.637,30

-- Verificar duplicidades por chave
-- SELECT source_sheet, source_record_id, COUNT(*) as qtd
-- FROM public.registros_comerciais
-- WHERE is_active = true AND source_type = 'GOOGLE_SHEETS_LIVE'
-- GROUP BY source_sheet, source_record_id
-- HAVING COUNT(*) > 1;
-- Esperado: 0 linhas (sem duplicidades)
