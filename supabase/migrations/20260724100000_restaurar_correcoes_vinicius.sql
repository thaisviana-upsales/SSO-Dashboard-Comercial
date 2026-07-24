-- =============================================================================
-- PATCH RESTAURACAO — 20260724100000_restaurar_correcoes_vinicius.sql
-- Restaura as correções que foram revertidas pela sincronização automática.
--
-- PROBLEMA: A cada sync, o Apps Script reenviava os valores originais (bugados)
-- da planilha e a Edge Function sobrescrevia as correções manuais.
-- Além disso, a lógica de inativação desativava as linhas 6 e 13 (inseridas
-- manualmente, com IDs não-UUID).
--
-- SOLUÇÃO APLICADA NA EDGE FUNCTION (já deployada):
--   1. Valores > R$500.000 são ignorados (guard de sanidade)
--   2. Registros com source_record_id não-UUID não são inativados
--
-- ESTE SQL: Restaura o estado correto no banco de dados
-- =============================================================================

-- ── 1. Reativar linha 6 (inativada pelo sync) ─────────────────────────────────
UPDATE public.registros_comerciais
SET is_active  = true,
    updated_at = NOW()
WHERE source_record_id = 'vinicius26-linha6-35337-fix-20260723'
  AND source_sheet = 'VINICIUS.26';

-- ── 2. Reativar linha 13 (inativada pelo sync) ────────────────────────────────
UPDATE public.registros_comerciais
SET is_active  = true,
    updated_at = NOW()
WHERE source_record_id = 'vinicius26-linha13-1400-fix-20260723'
  AND source_sheet = 'VINICIUS.26';

-- ── 3. Corrigir os 4 valores bugados (sobrescritos pelo sync) ─────────────────
-- Os values foram revertidos para os valores originais da planilha.
-- Após a correção da Edge Function (guard de 500k), estes valores não serão
-- sobrescritos novamente em sincronizações futuras.

-- Registro ref=2026-07-01, PROPOSTA ENVIADA (1.436.334 → 14.363,34)
UPDATE public.registros_comerciais
SET valor_total = 14363.34,
    updated_at  = NOW()
WHERE source_record_id = '0c24f954-02d0-42de-b697-0c0dfb4a8efb'
  AND source_sheet = 'VINICIUS.26';

-- Registro ref=2026-07-03, PROPOSTA ENVIADA (1.358.023 → 13.580,23)
UPDATE public.registros_comerciais
SET valor_total = 13580.23,
    updated_at  = NOW()
WHERE source_record_id = '12133a8b-25f1-4b7d-91cf-f979a2adebc2'
  AND source_sheet = 'VINICIUS.26';

-- Registro ref=2026-07-10, PROPOSTA ENVIADA (235.224 → 23.522,40)
UPDATE public.registros_comerciais
SET valor_total = 23522.40,
    updated_at  = NOW()
WHERE source_record_id = '809a8603-8533-4c3d-91b7-2ff0321fc166'
  AND source_sheet = 'VINICIUS.26';

-- Registro ref=2026-07-10, CONTRATO FECHADO (10.997 → 1.099,70)
UPDATE public.registros_comerciais
SET valor_total = 1099.70,
    updated_at  = NOW()
WHERE source_record_id = '5ca4aa37-bae9-4626-930c-3129dfde38da'
  AND source_sheet = 'VINICIUS.26';

-- ── 4. VALIDAÇÃO ──────────────────────────────────────────────────────────────
-- Deve retornar 4 linhas com CONTRATO FECHADO, total = R$46.637,30

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

-- Resultado esperado:
-- 2026-07-08 | 8.800,00
-- 2026-07-10 | 1.099,70
-- 2026-07-10 | 1.400,00
-- 2026-07-20 | 35.337,60
-- TOTAL = 46.637,30
