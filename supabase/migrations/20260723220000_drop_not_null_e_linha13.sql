-- =============================================================================
-- Patch Final: 20260723220000_drop_not_null_e_linha13.sql
--
-- CONTEXTO (o que já rodou nos patches anteriores):
--   ✅ ADD COLUMN quantidade_parcelas
--   ✅ INSERT linha 6 (R$35.337,60, data_referencia='2026-07-02')
--   ✅ DROP VIEW / CREATE VIEW (view_dashboard_consolidado com mes_envio_numero)
--   ✅ UPDATE dos 4 valores bugados de VINICIUS
--   ❌ INSERT linha 13 → null value em data_referencia (NOT NULL constraint)
--   ❌ UPDATE is_active = false → revertido pelo erro acima
--
-- ESTE PATCH FAZ:
--   1. DROP NOT NULL em data_referencia, mes_referencia, ano_referencia
--   2. INSERT linha 13 (coluna B vazia → data_referencia=null)
--   3. UPDATE is_active = false nos IDs genéricos antigos
--   4. Validação final
-- =============================================================================

-- ── 1. Remover constraint NOT NULL das colunas de data ────────────────────────
-- Necessário para registros cuja coluna B está vazia na planilha.
-- Esses registros entram somente pelo evento proposta ou venda.

ALTER TABLE public.registros_comerciais
  ALTER COLUMN data_referencia DROP NOT NULL;

ALTER TABLE public.registros_comerciais
  ALTER COLUMN mes_referencia DROP NOT NULL;

ALTER TABLE public.registros_comerciais
  ALTER COLUMN ano_referencia DROP NOT NULL;

-- ── 2. Inserir linha 13 — R$1.400,00 (coluna B vazia) ────────────────────────
-- STATUS=CONTRATO FECHADO, DATA_FECHAMENTO=10/07/2026
-- data_referencia=null porque coluna B está vazia na planilha

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

-- ── 3. Inativar inserções manuais antigas (IDs genéricos) ─────────────────────
UPDATE public.registros_comerciais
SET is_active = false,
    updated_at = NOW()
WHERE source_record_id IN (
  'linha6-vinicius26-manual-fix-00000001',
  'linha13-vinicius26-manual-fix-00000001'
)
AND source_sheet = 'VINICIUS.26';

-- ── 4. VALIDAÇÃO — executar separadamente e conferir ─────────────────────────
-- Deve retornar 4 linhas, total = 46.637,30

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
