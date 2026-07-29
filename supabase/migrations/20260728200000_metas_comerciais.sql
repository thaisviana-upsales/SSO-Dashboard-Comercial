-- =============================================================================
-- Migration: 20260728200000_metas_comerciais.sql
-- Tabela de Metas Comerciais — Dashboard SSO
--
-- FONTE: aba "Metas" da planilha 1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE
-- PREENCHIDA: pelo Apps Script (lerMetasSanitizadas) via Edge Function sync-sheets
--
-- CONSTRAINT ÚNICA: (ano, mes, vendedor)
--   vendedor = "GERAL" para meta global do mês
--   vendedor = nome normalizado (maiúsculas, sem espaços extras) para cada consultor
--
-- REGRA DE EXIBIÇÃO NO DASHBOARD:
--   - Mês selecionado sem vendedor → usa meta do registro GERAL
--   - Mês selecionado com vendedor → usa meta do vendedor
--   - Mês ausente da tabela → "Meta não cadastrada" (não zerar)
--   - Vendedor sem meta cadastrada → "Meta não cadastrada" (não zerar)
-- =============================================================================

-- Tabela principal de metas
CREATE TABLE IF NOT EXISTS metas_comerciais (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  ano             integer     NOT NULL,
  mes             integer     NOT NULL CHECK (mes BETWEEN 1 AND 12),

  -- "GERAL" = meta global do mês | nome normalizado = meta individual
  vendedor        text        NOT NULL,

  -- percentual que esse vendedor representa da meta geral (ex: 0.35 = 35%)
  -- null quando não informado na planilha
  percentual_meta numeric(8, 4),

  -- valor absoluto da meta mensal em R$
  meta_mensal     numeric(14, 2),

  -- total de dias úteis do mês conforme a aba Metas
  dias_uteis_mes  integer,

  -- rastreabilidade
  spreadsheet_id  text        DEFAULT '1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE',
  source_sheet    text        DEFAULT 'Metas',
  synced_at       timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  -- garante que cada (ano, mês, vendedor) seja único
  CONSTRAINT uq_metas_ano_mes_vendedor UNIQUE (ano, mes, vendedor)
);

-- Índices para consultas frequentes pelo dashboard
CREATE INDEX IF NOT EXISTS idx_metas_ano_mes     ON metas_comerciais (ano, mes);
CREATE INDEX IF NOT EXISTS idx_metas_vendedor    ON metas_comerciais (vendedor);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION atualizar_updated_at_metas()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_metas_updated_at ON metas_comerciais;
CREATE TRIGGER trig_metas_updated_at
  BEFORE UPDATE ON metas_comerciais
  FOR EACH ROW EXECUTE FUNCTION atualizar_updated_at_metas();

-- RLS: somente leitura pública (anon key), escrita apenas via service_role
ALTER TABLE metas_comerciais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "metas_select_anon" ON metas_comerciais;
CREATE POLICY "metas_select_anon"
  ON metas_comerciais FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "metas_write_service" ON metas_comerciais;
CREATE POLICY "metas_write_service"
  ON metas_comerciais FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- QUERIES DE AUDITORIA (executar após sincronização)
-- =============================================================================

-- 1. Ver todas as metas cadastradas
-- SELECT ano, mes, vendedor, meta_mensal, dias_uteis_mes, synced_at
-- FROM metas_comerciais
-- ORDER BY ano, mes, vendedor;

-- 2. Validar agosto (valores esperados):
--    GERAL    : 450825.69
--    VINICIUS : 157788.99
--    LUCAS    :  67623.85
--    VITÓRIA  :  45082.57
--    AMANDA   :  22541.28
-- SELECT vendedor, meta_mensal FROM metas_comerciais WHERE ano=2026 AND mes=8 ORDER BY vendedor;
