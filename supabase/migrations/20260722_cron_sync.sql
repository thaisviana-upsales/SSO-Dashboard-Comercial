-- ============================================================================
-- MIGRATION: 20260722_cron_sync.sql
-- PROJETO SSO — AGENDAMENTO AUTOMÁTICO DIÁRIO DA SINCRONIZAÇÃO (ETAPA 3)
-- Horário: 06:00 BRT (09:00 UTC) todos os dias
-- ============================================================================

-- Ativar extensões pg_cron e pg_net se não estiverem ativadas
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remover agendamento anterior se existir
SELECT cron.unschedule('sync-sso-sales-daily-6am') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'sync-sso-sales-daily-6am'
);

-- Agendar a chamada HTTP POST para a Edge Function sync-sheets todos os dias às 06:00 BRT (09:00 UTC)
SELECT cron.schedule(
    'sync-sso-sales-daily-6am',
    '0 9 * * *',
    $$
    SELECT net.http_post(
        url:='https://wutmhhqbdwslwiawqwut.supabase.co/functions/v1/sync-sheets',
        headers:='{"Content-Type": "application/json"}'::jsonb,
        body:='{"trigger": "cron_daily_0600_brt"}'::jsonb
    );
    $$
);
