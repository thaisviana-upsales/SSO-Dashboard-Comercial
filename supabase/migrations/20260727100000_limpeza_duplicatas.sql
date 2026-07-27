-- =============================================================================
-- Migration: 20260727100000_limpeza_duplicatas.sql
-- Limpeza de Duplicatas — Dashboard SSO
--
-- CONTEXTO:
--   Migrations anteriores inseriram registros para VINICIUS.26 com
--   source_record_id não-UUID (strings customizadas). O sync também criou
--   registros UUID para as mesmas linhas físicas da planilha.
--   Resultado: duas entradas ativas para a mesma linha → KPIs dobrados.
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Inativa os registros manuais (IDs string) de linha 6 e linha 13
--   2. O próximo sync recria essas linhas corretamente com UUIDs estáveis
--   3. Query de auditoria: exibe duplicatas por conteúdo em todas as abas
--
-- ⚠ ATENÇÃO: Execute o sync (botão no dashboard) IMEDIATAMENTE APÓS esta migration.
--    Até o sync rodar, as linhas 6 e 13 de VINICIUS.26 ficarão ausentes da view.
-- =============================================================================

-- ── 1. Inativar registro manual — linha 6 (R$35.337,60) ─────────────────────
UPDATE public.registros_comerciais
SET    is_active  = false,
       updated_at = NOW()
WHERE  source_record_id = 'vinicius26-linha6-35337-fix-20260723'
  AND  source_sheet     = 'VINICIUS.26'
  AND  is_active        = true;

-- ── 2. Inativar registro manual — linha 13 (R$1.400,00, coluna B vazia) ──────
UPDATE public.registros_comerciais
SET    is_active  = false,
       updated_at = NOW()
WHERE  source_record_id = 'vinicius26-linha13-1400-fix-20260723'
  AND  source_sheet     = 'VINICIUS.26'
  AND  is_active        = true;

-- ── 3. Garantia — inativar IDs genéricos antigos caso ainda estejam ativos ───
UPDATE public.registros_comerciais
SET    is_active  = false,
       updated_at = NOW()
WHERE  source_record_id IN (
         'linha6-vinicius26-manual-fix-00000001',
         'linha13-vinicius26-manual-fix-00000001'
       )
  AND  source_sheet = 'VINICIUS.26'
  AND  is_active    = true;

-- ── 4. Validação — VINICIUS.26 CONTRATO FECHADO após limpeza ─────────────────
-- Após o sync, deve retornar 4 linhas e total = R$46.637,30
SELECT
  source_record_id,
  data_referencia,
  data_fechamento,
  status,
  valor_total,
  is_active
FROM public.registros_comerciais
WHERE  source_sheet = 'VINICIUS.26'
  AND  UPPER(TRIM(COALESCE(status, ''))) = 'CONTRATO FECHADO'
ORDER BY is_active DESC, data_fechamento;

-- ── 5. Auditoria geral — duplicatas por conteúdo em todas as abas ────────────
-- Qualquer linha com qtd_registros > 1 é uma duplicata a investigar.
-- Resultado esperado após esta migration + sync: 0 linhas
SELECT
  source_sheet,
  data_fechamento,
  valor_total,
  UPPER(TRIM(COALESCE(status, ''))) AS status_normalizado,
  COUNT(*)                           AS qtd_registros,
  STRING_AGG(source_record_id, ' | ' ORDER BY created_at) AS ids
FROM public.registros_comerciais
WHERE is_active    = true
  AND source_type  = 'GOOGLE_SHEETS_LIVE'
  AND UPPER(TRIM(COALESCE(status, ''))) = 'CONTRATO FECHADO'
GROUP BY
  source_sheet,
  data_fechamento,
  valor_total,
  UPPER(TRIM(COALESCE(status, '')))
HAVING COUNT(*) > 1
ORDER BY source_sheet, data_fechamento;
