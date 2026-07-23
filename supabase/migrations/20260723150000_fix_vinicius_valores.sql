-- =============================================================================
-- Migration: 20260723150000_fix_vinicius_valores.sql
-- Corrige valor_total com parsing errado do Apps Script antigo
-- e adiciona os registros CONTRATO FECHADO faltantes manualmente.
--
-- Bug: getValues() retorna float 14363.34 → String → remove ponto decimal
-- → 1436334 (errado). Correto: 14363.34
-- =============================================================================

-- ── 1. Corrigir valor_total com bug de parsing ────────────────────────────────

-- a0ee7527: data_ref=07-01, PROPOSTA ENVIADA, valor=1436334 → deveria ser 14363.34
UPDATE public.registros_comerciais
SET valor_total = 14363.34,
    updated_at  = NOW()
WHERE source_record_id = 'a0ee7527-001c-4847-ad89-4855f75109c3'
  AND source_sheet = 'VINICIUS.26';

-- cdef8357: data_ref=07-03, PROPOSTA ENVIADA, valor=1358023 → deveria ser 13580.23
UPDATE public.registros_comerciais
SET valor_total = 13580.23,
    updated_at  = NOW()
WHERE source_record_id = 'cdef8357-849b-4172-a5cc-92b14ec33ebe'
  AND source_sheet = 'VINICIUS.26';

-- 7dedee9f: data_ref=07-10, PROPOSTA ENVIADA, valor=235224 → deveria ser 23522.40
UPDATE public.registros_comerciais
SET valor_total = 23522.40,
    updated_at  = NOW()
WHERE source_record_id = '7dedee9f-2513-4b26-a1f4-1c0fa0ea56b3'
  AND source_sheet = 'VINICIUS.26';

-- 45c0eebb: data_ref=07-10, CONTRATO FECHADO, valor=10997 → deveria ser 1099.70
UPDATE public.registros_comerciais
SET valor_total = 1099.70,
    updated_at  = NOW()
WHERE source_record_id = '45c0eebb-692f-4b59-a240-338efa673af9'
  AND source_sheet = 'VINICIUS.26';

-- ── 2. Inserir linhas 6 e 13 (CONTRATO FECHADO faltantes) ────────────────────
-- Esses registros existem na planilha mas o Apps Script antigo não os importou.
-- Dados extraídos diretamente da planilha confirmados pelo usuário:
--
-- Linha 6:  DATA=02/07/2026, DATA_FECHAMENTO=20/07/2026, STATUS=CONTRATO FECHADO
--           VALOR_MENSAL=2944.80, PARCELAS=12, VALOR_TOTAL=35337.60
--
-- Linha 13: DATA=10/07/2026, DATA_FECHAMENTO=10/07/2026, STATUS=CONTRATO FECHADO
--           VALOR_MENSAL=280.00, PARCELAS=5, VALOR_TOTAL=1400.00

INSERT INTO public.registros_comerciais (
  source_type, spreadsheet_id, source_sheet, source_record_id,
  data_referencia, mes_referencia, ano_referencia,
  data_fechamento, data_envio_orcamento,
  vendedor, fonte_lead, valor_mensal, valor_total,
  status, tipo_contrato, is_active,
  created_at, updated_at, synced_at,
  row_hash
)
SELECT
  'GOOGLE_SHEETS_LIVE',
  '1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE',
  'VINICIUS.26',
  -- ID gerado como UUID v4 estável para este registro manual
  'linha6-vinicius26-manual-fix-00000001',
  '2026-07-02',  -- DATA coluna B (confirmado pelo usuário)
  7, 2026,
  '2026-07-20',  -- DATA DE FECHAMENTO DA VENDA (screenshot: 20/07/2026)
  '2026-07-02',  -- DATA ENVIO DE ORÇAMENTO
  'VINICIUS',
  NULL,
  2944.80,
  35337.60,
  'CONTRATO FECHADO',
  'Pacote SST',
  true,
  NOW(), NOW(), NOW(),
  md5('linha6-manual-fix')
WHERE NOT EXISTS (
  SELECT 1 FROM public.registros_comerciais
  WHERE source_record_id = 'linha6-vinicius26-manual-fix-00000001'
);

INSERT INTO public.registros_comerciais (
  source_type, spreadsheet_id, source_sheet, source_record_id,
  data_referencia, mes_referencia, ano_referencia,
  data_fechamento, data_envio_orcamento,
  vendedor, fonte_lead, valor_mensal, valor_total,
  status, tipo_contrato, is_active,
  created_at, updated_at, synced_at,
  row_hash
)
SELECT
  'GOOGLE_SHEETS_LIVE',
  '1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE',
  'VINICIUS.26',
  'linha13-vinicius26-manual-fix-00000001',
  '2026-07-10',  -- DATA coluna B
  7, 2026,
  '2026-07-10',  -- DATA DE FECHAMENTO DA VENDA
  '2026-07-10',  -- DATA ENVIO
  'VINICIUS',
  NULL,
  280.00,
  1400.00,
  'CONTRATO FECHADO',
  'Pacote SST',
  true,
  NOW(), NOW(), NOW(),
  md5('linha13-manual-fix')
WHERE NOT EXISTS (
  SELECT 1 FROM public.registros_comerciais
  WHERE source_record_id = 'linha13-vinicius26-manual-fix-00000001'
);
