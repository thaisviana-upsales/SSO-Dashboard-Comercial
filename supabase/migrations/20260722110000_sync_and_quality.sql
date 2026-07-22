-- ============================================================================
-- MIGRATION: 20260722110000_sync_and_quality.sql
-- PROJETO SSO — SINCRONIZAÇÃO GOOGLE SHEETS E AUDITORIA (ETAPA 2)
-- Supabase URL: https://wutmhhqbdwslwiawqwut.supabase.co
-- ============================================================================

-- 1. GARANTIR RESTRIÇÃO ÚNICA PARA UPSERT EM registros_comerciais
-- Protegida por DO $$ para ser idempotente (tabela existe desde migration 20260722090000).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_source_record'
          AND conrelid = 'public.registros_comerciais'::regclass
    ) THEN
        ALTER TABLE public.registros_comerciais
            ADD CONSTRAINT unique_source_record
            UNIQUE (source_type, spreadsheet_id, source_record_id);
    END IF;
EXCEPTION
    -- Caso a tabela não exista no ambiente de destino (segurança extra)
    WHEN undefined_table THEN
        RAISE NOTICE 'Tabela registros_comerciais não encontrada — constraint unique_source_record ignorada.';
END;
$$;

-- 2. CRIAR TABELA DE EXECUÇÕES DE SINCRONIZAÇÃO (SYNC_RUNS)
CREATE TABLE IF NOT EXISTS public.sync_runs (
    id_sync         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    spreadsheet_id  TEXT        NOT NULL,
    status          TEXT        NOT NULL CHECK (status IN ('SUCCESS', 'ERROR', 'PARTIAL', 'RUNNING')),
    total_rows_read INTEGER     DEFAULT 0,
    rows_inserted   INTEGER     DEFAULT 0,
    rows_updated    INTEGER     DEFAULT 0,
    rows_skipped    INTEGER     DEFAULT 0,
    rows_ignored    INTEGER     DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

-- 3. CRIAR TABELA DE PROBLEMAS DE QUALIDADE DE DADOS (DATA_QUALITY_ISSUES)
-- Criada SEM a FK inline para garantir idempotência caso a tabela já exista
-- sem a coluna id_sync. A coluna e a FK são adicionadas nos passos 4 e 5.
CREATE TABLE IF NOT EXISTS public.data_quality_issues (
    id_issue       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    spreadsheet_id TEXT        NOT NULL,
    sheet_name     TEXT,
    row_index      INTEGER,
    issue_type     TEXT        NOT NULL,
    raw_data       JSONB,
    description    TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 4. GARANTIR COLUNAS EM data_quality_issues (ANTES DE QUALQUER ÍNDICE)
-- A tabela pode já existir no banco remoto sem estas colunas; ADD COLUMN IF NOT EXISTS
-- é seguro e idempotente em ambos os cenários (tabela nova ou pré-existente).
ALTER TABLE public.data_quality_issues
    ADD COLUMN IF NOT EXISTS id_sync UUID;

ALTER TABLE public.data_quality_issues
    ADD COLUMN IF NOT EXISTS issue_type TEXT;

-- 5. ADICIONAR FOREIGN KEY id_sync → sync_runs(id_sync) COM SEGURANÇA
-- Executado somente após id_sync e issue_type serem garantidas acima.
-- Condições verificadas: tabela sync_runs existe, coluna id_sync existe em sync_runs,
-- e a constraint ainda não existe em data_quality_issues.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sync_runs'
    )
    AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'sync_runs'
          AND column_name  = 'id_sync'
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname  = 'data_quality_issues_id_sync_fkey'
          AND conrelid = 'public.data_quality_issues'::regclass
    )
    THEN
        ALTER TABLE public.data_quality_issues
            ADD CONSTRAINT data_quality_issues_id_sync_fkey
            FOREIGN KEY (id_sync)
            REFERENCES public.sync_runs(id_sync)
            ON DELETE SET NULL;
    END IF;
END;
$$;

-- 6. ÍNDICES — criados somente após id_sync e issue_type serem garantidas (passos 4a e 4b)
CREATE INDEX IF NOT EXISTS idx_sync_runs_started
    ON public.sync_runs(started_at DESC);

-- id_sync existe em data_quality_issues (passo 4) — índice seguro
CREATE INDEX IF NOT EXISTS idx_quality_issues_sync
    ON public.data_quality_issues(id_sync);

CREATE INDEX IF NOT EXISTS idx_quality_issues_type
    ON public.data_quality_issues(issue_type);