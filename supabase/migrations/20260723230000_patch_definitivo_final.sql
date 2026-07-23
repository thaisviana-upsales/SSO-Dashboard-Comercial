-- =============================================================================
-- PATCH DEFINITIVO — Execute este script completo de uma vez.
-- Inclui TUDO que os scripts anteriores tentaram fazer e falharam.
-- Todos os steps são idempotentes (WHERE NOT EXISTS / IF NOT EXISTS).
-- =============================================================================

-- STEP 1: Adicionar coluna que estava faltando
ALTER TABLE public.registros_comerciais
  ADD COLUMN IF NOT EXISTS quantidade_parcelas INTEGER;

-- STEP 2: Remover NOT NULL das colunas de data
-- (necessário para linha 13 que tem coluna B vazia)
ALTER TABLE public.registros_comerciais
  ALTER COLUMN data_referencia DROP NOT NULL;

ALTER TABLE public.registros_comerciais
  ALTER COLUMN mes_referencia DROP NOT NULL;

ALTER TABLE public.registros_comerciais
  ALTER COLUMN ano_referencia DROP NOT NULL;

-- STEP 3: Corrigir 4 valores com parsing errado (x10 ou x100)
-- IDs confirmados via SELECT na view_dashboard_consolidado

UPDATE public.registros_comerciais
SET valor_total = 14363.34, updated_at = NOW()
WHERE source_record_id = '0c24f954-02d0-42de-b697-0c0dfb4a8efb'
  AND source_sheet = 'VINICIUS.26';

UPDATE public.registros_comerciais
SET valor_total = 13580.23, updated_at = NOW()
WHERE source_record_id = '12133a8b-25f1-4b7d-91cf-f979a2adebc2'
  AND source_sheet = 'VINICIUS.26';

UPDATE public.registros_comerciais
SET valor_total = 23522.40, updated_at = NOW()
WHERE source_record_id = '809a8603-8533-4c3d-91b7-2ff0321fc166'
  AND source_sheet = 'VINICIUS.26';

UPDATE public.registros_comerciais
SET valor_total = 1099.70, updated_at = NOW()
WHERE source_record_id = '5ca4aa37-bae9-4626-930c-3129dfde38da'
  AND source_sheet = 'VINICIUS.26';

-- STEP 4: Inserir linha 6 — R$35.337,60
-- DATA=02/07/2026, DATA_FECHAMENTO=20/07/2026, STATUS=CONTRATO FECHADO

INSERT INTO public.registros_comerciais (
  source_type, spreadsheet_id, source_sheet, source_record_id,
  data_referencia, mes_referencia, ano_referencia,
  data_fechamento, data_envio_orcamento,
  vendedor, fonte_lead,
  valor_mensal, quantidade_parcelas, valor_total,
  status, tipo_contrato, is_active,
  created_at, updated_at, synced_at, row_hash
)
SELECT
  'GOOGLE_SHEETS_LIVE',
  '1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE',
  'VINICIUS.26',
  'vinicius26-linha6-35337-fix-20260723',
  '2026-07-02', 7, 2026,
  '2026-07-20', '2026-07-02',
  'VINICIUS', NULL,
  2944.80, 12, 35337.60,
  'CONTRATO FECHADO', 'Pacote SST', true,
  NOW(), NOW(), NOW(),
  md5('vinicius26-linha6-35337-fix-20260723')
WHERE NOT EXISTS (
  SELECT 1 FROM public.registros_comerciais
  WHERE source_record_id = 'vinicius26-linha6-35337-fix-20260723'
);

-- STEP 5: Inserir linha 13 — R$1.400,00 (coluna B VAZIA = data_referencia NULL)

INSERT INTO public.registros_comerciais (
  source_type, spreadsheet_id, source_sheet, source_record_id,
  data_referencia, mes_referencia, ano_referencia,
  data_fechamento, data_envio_orcamento,
  vendedor, fonte_lead,
  valor_mensal, quantidade_parcelas, valor_total,
  status, tipo_contrato, is_active,
  created_at, updated_at, synced_at, row_hash
)
SELECT
  'GOOGLE_SHEETS_LIVE',
  '1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE',
  'VINICIUS.26',
  'vinicius26-linha13-1400-fix-20260723',
  NULL, NULL, NULL,
  '2026-07-10', '2026-07-10',
  'VINICIUS', NULL,
  280.00, 5, 1400.00,
  'CONTRATO FECHADO', 'Pacote SST', true,
  NOW(), NOW(), NOW(),
  md5('vinicius26-linha13-1400-fix-20260723')
WHERE NOT EXISTS (
  SELECT 1 FROM public.registros_comerciais
  WHERE source_record_id = 'vinicius26-linha13-1400-fix-20260723'
);

-- STEP 6: Inativar registros manuais antigos com IDs genéricos

UPDATE public.registros_comerciais
SET is_active = false, updated_at = NOW()
WHERE source_record_id IN (
  'linha6-vinicius26-manual-fix-00000001',
  'linha13-vinicius26-manual-fix-00000001'
)
AND source_sheet = 'VINICIUS.26';

-- STEP 7: Validação — deve retornar 4 linhas, total = R$46.637,30

SELECT
  source_record_id,
  data_referencia,
  data_fechamento,
  status,
  valor_total
FROM public.registros_comerciais
WHERE source_sheet = 'VINICIUS.26'
  AND UPPER(TRIM(COALESCE(status, ''))) = 'CONTRATO FECHADO'
  AND is_active = true
ORDER BY data_fechamento;
