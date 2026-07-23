-- =============================================================================
-- Patch: 20260723210000_patch_quantidade_parcelas_e_inserts.sql
-- Corrige o erro "column quantidade_parcelas does not exist"
-- e reexecuta os INSERTs que falharam na migration anterior.
--
-- CONTEXTO:
--   A migration 20260723200000 rodou parcialmente:
--   ✅ CREATE INDEX idx_registros_data_envio
--   ✅ ALTER TABLE DROP NOT NULL (data_referencia, mes_referencia, ano_referencia)
--   ✅ DROP VIEW / CREATE VIEW view_dashboard_consolidado
--   ✅ GRANT SELECT
--   ✅ UPDATE dos 4 valores bugados de VINICIUS
--   ❌ INSERT linha 6 → erro: "column quantidade_parcelas does not exist"
--   ❌ INSERT linha 13 → não chegou a executar
--   ❌ UPDATE is_active = false nos registros manuais antigos → não executou
-- =============================================================================

-- ── 1. Adicionar coluna quantidade_parcelas (não existia na tabela original) ─
ALTER TABLE public.registros_comerciais
  ADD COLUMN IF NOT EXISTS quantidade_parcelas INTEGER;

-- ── 2. Inserir linha 6 (R$35.337,60) — CONTRATO FECHADO ──────────────────────
-- DATA=02/07/2026, DATA_FECHAMENTO=20/07/2026
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
  '2026-07-20',
  '2026-07-02',
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

-- ── 3. Inserir linha 13 (R$1.400,00) — coluna B vazia ────────────────────────
-- data_referencia=NULL (coluna B vazia na planilha)
-- DATA_FECHAMENTO=10/07/2026, STATUS=CONTRATO FECHADO

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
  NULL, NULL, NULL,
  '2026-07-10',
  '2026-07-10',
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

-- ── 4. Inativar inserções manuais anteriores (IDs genéricos da migration antiga) ─
UPDATE public.registros_comerciais
SET is_active = false, updated_at = NOW()
WHERE source_record_id IN (
  'linha6-vinicius26-manual-fix-00000001',
  'linha13-vinicius26-manual-fix-00000001'
)
AND source_sheet = 'VINICIUS.26';

-- ── 5. Validação ──────────────────────────────────────────────────────────────
-- Resultado esperado: 4 linhas com status CONTRATO FECHADO para VINICIUS
-- e total faturamento = 46.637,30

SELECT
  source_record_id,
  data_referencia,
  data_fechamento,
  status,
  valor_total,
  is_active
FROM public.registros_comerciais
WHERE source_sheet = 'VINICIUS.26'
  AND UPPER(TRIM(COALESCE(status, ''))) = 'CONTRATO FECHADO'
  AND is_active = true
ORDER BY data_fechamento;

-- Deve retornar:
-- data_fechamento=2026-07-08  valor=8800.00
-- data_fechamento=2026-07-10  valor=1099.70
-- data_fechamento=2026-07-10  valor=1400.00
-- data_fechamento=2026-07-20  valor=35337.60
-- TOTAL = 46637.30
