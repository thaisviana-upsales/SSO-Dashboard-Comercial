-- ============================================================================
-- MIGRATION: 20260722_corte_fonte_dados.sql
-- PROJETO SSO — CORTE DE FONTE DE DADOS EM 01/07/2026 (ETAPA 1)
-- Supabase URL: https://wutmhhqbdwslwiawqwut.supabase.co
-- ============================================================================

-- 1. CRIAR/ATUALIZAR TABELA PRINCIPAL DE REGISTROS COMERCIAIS
CREATE TABLE IF NOT EXISTS public.registros_comerciais (
    id_registro UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('EXCEL_HISTORICO', 'GOOGLE_SHEETS_LIVE')),
    spreadsheet_id TEXT,
    source_sheet TEXT NOT NULL,
    source_record_id TEXT,
    data_referencia DATE NOT NULL,
    mes_referencia INTEGER NOT NULL CHECK (mes_referencia BETWEEN 1 AND 12),
    ano_referencia INTEGER NOT NULL,
    vendedor TEXT,
    quantidade_funcionarios INTEGER,
    fonte_lead TEXT,
    valor_mensal NUMERIC(15, 2),
    valor_total NUMERIC(15, 2),
    status TEXT,
    tipo_contrato TEXT,
    tipo_base TEXT,
    situacao_contrato TEXT,
    numero_os TEXT,
    -- Campos PII armazenados na tabela base para auditoria (ocultos da view)
    empresa TEXT,
    cnpj TEXT,
    nome TEXT,
    telefone TEXT,
    email TEXT,
    observacao TEXT,
    -- Metadados de integridade e sincronização
    row_hash TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para otimização de consultas e filtros do dashboard
CREATE INDEX IF NOT EXISTS idx_registros_source_data ON public.registros_comerciais(source_type, data_referencia);
CREATE INDEX IF NOT EXISTS idx_registros_vendedor ON public.registros_comerciais(vendedor);
CREATE INDEX IF NOT EXISTS idx_registros_status ON public.registros_comerciais(status);
CREATE INDEX IF NOT EXISTS idx_registros_is_active ON public.registros_comerciais(is_active);

-- 2. CRIAR VIEW CONSOLIDADA DO DASHBOARD (COM PRIVACIDADE E REGRA DE CORTE)
-- Esta view é a ÚNICA FONTE DE VERDADE consumida pelo Dashboard Comercial e Qualidade de Vendas.
CREATE OR REPLACE VIEW public.view_dashboard_consolidado AS
SELECT
    id_registro,
    source_type,
    spreadsheet_id,
    source_sheet,
    source_record_id,
    data_referencia,
    mes_referencia,
    ano_referencia,
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
WHERE
    is_active = TRUE
    AND (
        (source_type = 'EXCEL_HISTORICO' AND data_referencia < DATE '2026-07-01')
        OR
        (source_type = 'GOOGLE_SHEETS_LIVE' AND data_referencia >= DATE '2026-07-01')
    );

-- 3. CONSULTAS DE VALIDAÇÃO DA MIGRATION

-- Validação 1: Histórico de julho mantido fisicamente para auditoria
-- SELECT source_type, DATE_TRUNC('month', data_referencia)::date AS mes, COUNT(*) AS registros
-- FROM public.registros_comerciais
-- WHERE source_type = 'EXCEL_HISTORICO' AND data_referencia >= DATE '2026-07-01'
-- GROUP BY 1, 2 ORDER BY 2;

-- Validação 2: Histórico de julho exibido na view consolidada (Deve ser 0)
-- SELECT COUNT(*) AS historico_julho_exibido
-- FROM public.view_dashboard_consolidado
-- WHERE source_type = 'EXCEL_HISTORICO' AND data_referencia >= DATE '2026-07-01';

-- Validação 3: Registros live anteriores a julho na view consolidada (Deve ser 0)
-- SELECT COUNT(*) AS live_antes_do_corte
-- FROM public.view_dashboard_consolidado
-- WHERE source_type = 'GOOGLE_SHEETS_LIVE' AND data_referencia < DATE '2026-07-01';

-- Validação 4: Origem dos dados exibidos na view consolidada por mês
-- SELECT source_type, DATE_TRUNC('month', data_referencia)::date AS mes, COUNT(*) AS registros
-- FROM public.view_dashboard_consolidado
-- GROUP BY 1, 2 ORDER BY 2, 1;
