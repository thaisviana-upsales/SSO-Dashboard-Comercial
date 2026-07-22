-- ============================================================================
-- MIGRATION: 20260722_sync_and_quality.sql
-- PROJETO SSO — SINCRONIZAÇÃO GOOGLE SHEETS E AUDITORIA (ETAPA 2)
-- Supabase URL: https://wutmhhqbdwslwiawqwut.supabase.co
-- ============================================================================

-- 1. GARANTIR RESTRIÇÃO ÚNICA PARA UPSERT EM REGISTROS COMERCIAIS
ALTER TABLE public.registros_comerciais
DROP CONSTRAINT IF EXISTS unique_source_record;

ALTER TABLE public.registros_comerciais
ADD CONSTRAINT unique_source_record UNIQUE (source_type, spreadsheet_id, source_record_id);

-- 2. CRIAR TABELA DE EXECUÇÕES DE SINCRONIZAÇÃO (SYNC_RUNS)
CREATE TABLE IF NOT EXISTS public.sync_runs (
    id_sync UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spreadsheet_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'ERROR', 'PARTIAL', 'RUNNING')),
    total_rows_read INTEGER DEFAULT 0,
    rows_inserted INTEGER DEFAULT 0,
    rows_updated INTEGER DEFAULT 0,
    rows_skipped INTEGER DEFAULT 0,
    rows_ignored INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 3. CRIAR TABELA DE PROBLEMAS DE QUALIDADE DE DADOS (DATA_QUALITY_ISSUES)
CREATE TABLE IF NOT EXISTS public.data_quality_issues (
    id_issue UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_sync UUID REFERENCES public.sync_runs(id_sync) ON DELETE CASCADE,
    spreadsheet_id TEXT NOT NULL,
    sheet_name TEXT,
    row_index INTEGER,
    issue_type TEXT NOT NULL,
    raw_data JSONB,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de consulta rápida para relatórios de sincronização
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON public.sync_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_issues_sync ON public.data_quality_issues(id_sync);
CREATE INDEX IF NOT EXISTS idx_quality_issues_type ON public.data_quality_issues(issue_type);
