// ============================================================================
// SUPABASE EDGE FUNCTION: sync-sheets
// Endpoint: POST /functions/v1/sync-sheets
//
// Fluxo:
//   1. Recebe trigger do Dashboard (ou chamada direta com rows)
//   2. Chama Google Apps Script para extrair linhas sanitizadas
//   3. Insere / atualiza em registros_comerciais
//   4. Inativa registros GOOGLE_SHEETS_LIVE que sumiram da planilha
//   5. Retorna resumo completo
//
// Secrets necessários (Supabase → Project Settings → Edge Functions):
//   SUPABASE_URL                 (automático)
//   SUPABASE_SERVICE_ROLE_KEY    (automático)
//   GOOGLE_APPS_SCRIPT_URL       URL /exec do Web App
//   GOOGLE_APPS_SCRIPT_SECRET    SYNC_SECRET configurado no Apps Script
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL             = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APPS_SCRIPT_URL          = Deno.env.get("GOOGLE_APPS_SCRIPT_URL") ?? "";
const APPS_SCRIPT_SECRET       = Deno.env.get("GOOGLE_APPS_SCRIPT_SECRET") ?? "";

const TABLE   = "registros_comerciais";
const DATE_MIN = "2026-07-01";
const DATE_MAX = "2026-12-31";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin" : "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ── Parse do body ──────────────────────────────────────────────────
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) { body = {}; }

    // ── Obter linhas: via Apps Script (trigger manual) ou corpo direto ─
    let rows: Record<string, unknown>[] = [];
    let appsScriptLog: unknown[] = [];
    let spreadsheetId = "1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE";
    let appsScriptError: string | null = null;

    if (body.rows && Array.isArray(body.rows) && (body.rows as unknown[]).length > 0) {
      // Modo direto: linhas já fornecidas no body (testes / pipeline externo)
      rows = body.rows as Record<string, unknown>[];
      if (body.spreadsheet_id) spreadsheetId = body.spreadsheet_id as string;
    } else {
      // Modo normal: chamar Apps Script para extrair dados
      if (!APPS_SCRIPT_URL) {
        throw new Error("GOOGLE_APPS_SCRIPT_URL não configurada nos Secrets do Supabase");
      }

      const appsResp = await fetch(APPS_SCRIPT_URL, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({ secret: APPS_SCRIPT_SECRET }),
      });

      if (!appsResp.ok) {
        throw new Error(`Apps Script retornou HTTP ${appsResp.status}: ${await appsResp.text()}`);
      }

      const appsData = await appsResp.json();

      if (!appsData.success) {
        throw new Error(`Apps Script retornou erro: ${appsData.error}`);
      }

      rows          = appsData.rows ?? [];
      appsScriptLog = appsData.log  ?? [];
      if (appsData.spreadsheet_id) spreadsheetId = appsData.spreadsheet_id;
    }

    // ── Registrar início em sync_runs ──────────────────────────────────
    const { data: syncRun, error: syncError } = await supabase
      .from("sync_runs")
      .insert({
        spreadsheet_id: spreadsheetId,
        status        : "RUNNING",
        rows_read     : rows.length,
        started_at    : new Date().toISOString(),
      })
      .select()
      .single();

    if (syncError) {
      throw new Error(`Falha ao registrar sync_run: ${syncError.message}`);
    }

    const syncRunId: string = syncRun.id;
    let inserted   = 0;
    let updated    = 0;
    let skipped    = 0;
    let ignored    = 0;

    // IDs de source_record_id vistos nesta sincronização (para reconciliação)
    const seenSourceIds = new Set<string>();

    // ── Processar cada linha ───────────────────────────────────────────
    for (const r of rows) {
      const dataRef       = r.data_referencia as string | null;
      const sourceRecordId = r.source_record_id as string | null;
      const sourceSheet   = r.source_sheet as string | null;

      // Validação de data — regra de corte
      if (!dataRef || dataRef < DATE_MIN || dataRef > DATE_MAX) {
        ignored++;
        await supabase.from("data_quality_issues").insert({
          sync_run_id : syncRunId,
          source_sheet: sourceSheet,
          source_row  : r.row_index ?? null,
          issue_code  : dataRef && dataRef > DATE_MAX
            ? "DATA_ALEM_DO_PERIODO"
            : "DATA_FORA_DO_CORTE",
          severity    : dataRef && dataRef > DATE_MAX ? "WARNING" : "INFO",
          message     : `Registro ignorado: data_referencia '${dataRef}' fora do intervalo [${DATE_MIN}, ${DATE_MAX}]`,
          raw_value   : JSON.stringify(r),
          resolved    : false,
        });
        continue;
      }

      if (!sourceRecordId) {
        ignored++;
        await supabase.from("data_quality_issues").insert({
          sync_run_id : syncRunId,
          source_sheet: sourceSheet,
          issue_code  : "SOURCE_RECORD_ID_AUSENTE",
          severity    : "ERROR",
          message     : "source_record_id ausente — linha não pode ser reconciliada",
          raw_value   : JSON.stringify(r),
          resolved    : false,
        });
        continue;
      }

      seenSourceIds.add(sourceRecordId);

      // Verificar existência pelo source_record_id (chave estável da planilha)
      const { data: existing } = await supabase
        .from(TABLE)
        .select("id_registro, row_hash, is_active")
        .eq("source_type", "GOOGLE_SHEETS_LIVE")
        .eq("spreadsheet_id", spreadsheetId)
        .eq("source_record_id", sourceRecordId)
        .maybeSingle();

      if (existing) {
        // Registro já existe
        if (existing.row_hash === r.row_hash && existing.is_active) {
          skipped++; // Sem alteração
          continue;
        }

        // Atualizar (inclui reativação se estava inativo)
        const { error: updateErr } = await supabase
          .from(TABLE)
          .update({
            data_referencia       : r.data_referencia,
            mes_referencia        : r.mes_referencia,
            ano_referencia        : r.ano_referencia,
            vendedor              : r.vendedor,
            quantidade_funcionarios: r.quantidade_funcionarios,
            fonte_lead            : r.fonte_lead,
            valor_mensal          : r.valor_mensal,
            valor_total           : r.valor_total,
            status                : r.status,
            tipo_contrato         : r.tipo_contrato,
            tipo_base             : r.tipo_base,
            situacao_contrato     : r.situacao_contrato,
            numero_os             : r.numero_os,
            row_hash              : r.row_hash,
            is_active             : true,
            updated_at            : new Date().toISOString(),
            synced_at             : new Date().toISOString(),
          })
          .eq("id_registro", existing.id_registro);

        if (updateErr) {
          console.error("Erro ao atualizar:", updateErr);
          await supabase.from("data_quality_issues").insert({
            sync_run_id : syncRunId,
            source_sheet: sourceSheet,
            issue_code  : "ERRO_UPDATE",
            severity    : "ERROR",
            message     : updateErr.message,
            raw_value   : JSON.stringify(r),
            resolved    : false,
          });
        } else {
          updated++;
        }

      } else {
        // Inserir novo registro
        const { error: insertErr } = await supabase
          .from(TABLE)
          .insert({
            source_type           : "GOOGLE_SHEETS_LIVE",
            spreadsheet_id        : spreadsheetId,
            source_sheet          : sourceSheet,
            source_record_id      : sourceRecordId,
            data_referencia       : r.data_referencia,
            mes_referencia        : r.mes_referencia,
            ano_referencia        : r.ano_referencia,
            vendedor              : r.vendedor,
            quantidade_funcionarios: r.quantidade_funcionarios,
            fonte_lead            : r.fonte_lead,
            valor_mensal          : r.valor_mensal,
            valor_total           : r.valor_total,
            status                : r.status,
            tipo_contrato         : r.tipo_contrato,
            tipo_base             : r.tipo_base,
            situacao_contrato     : r.situacao_contrato,
            numero_os             : r.numero_os,
            row_hash              : r.row_hash,
            is_active             : true,
            created_at            : new Date().toISOString(),
            updated_at            : new Date().toISOString(),
            synced_at             : new Date().toISOString(),
          });

        if (insertErr) {
          console.error("Erro ao inserir:", insertErr);
          await supabase.from("data_quality_issues").insert({
            sync_run_id : syncRunId,
            source_sheet: sourceSheet,
            issue_code  : "ERRO_INSERT",
            severity    : "ERROR",
            message     : insertErr.message,
            raw_value   : JSON.stringify(r),
            resolved    : false,
          });
        } else {
          inserted++;
        }
      }
    }

    // ── Reconciliação: inativar registros que sumiram da planilha ──────
    // Buscar todos os GOOGLE_SHEETS_LIVE ativos desta planilha
    let inactivated = 0;

    if (seenSourceIds.size > 0) {
      const { data: activeRecords } = await supabase
        .from(TABLE)
        .select("id_registro, source_record_id")
        .eq("source_type", "GOOGLE_SHEETS_LIVE")
        .eq("spreadsheet_id", spreadsheetId)
        .eq("is_active", true);

      if (activeRecords && activeRecords.length > 0) {
        const toInactivate = activeRecords.filter(
          (rec: { source_record_id: string }) => !seenSourceIds.has(rec.source_record_id)
        );

        for (const rec of toInactivate) {
          const { error: inactErr } = await supabase
            .from(TABLE)
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("id_registro", rec.id_registro);

          if (!inactErr) {
            inactivated++;
            await supabase.from("data_quality_issues").insert({
              sync_run_id : syncRunId,
              source_sheet: null,
              issue_code  : "REGISTRO_INATIVADO",
              severity    : "INFO",
              message     : `source_record_id '${rec.source_record_id}' não encontrado na planilha — inativado`,
              resolved    : false,
            });
          }
        }
      }
    }

    // ── Finalizar sync_run ─────────────────────────────────────────────
    await supabase
      .from("sync_runs")
      .update({
        status       : "SUCCESS",
        rows_inserted: inserted,
        rows_updated : updated,
        rows_rejected: ignored,
        finished_at  : new Date().toISOString(),
      })
      .eq("id", syncRunId);

    return new Response(
      JSON.stringify({
        success : true,
        sync_id : syncRunId,
        summary : {
          total      : rows.length,
          inserted,
          updated,
          skipped,
          ignored,
          inactivated,
        },
        apps_script_log: appsScriptLog,
        apps_script_error: appsScriptError,
      }),
      {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        status : 200,
      }
    );

  } catch (err) {
    console.error("[sync-sheets] Erro:", err);

    // Tentar atualizar sync_run com falha (best-effort)
    try {
      await supabase
        .from("sync_runs")
        .update({ status: "ERROR", error_message: String(err), finished_at: new Date().toISOString() })
        .eq("status", "RUNNING");
    } catch (_) { /* ignorar */ }

    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        status : 500,
      }
    );
  }
});
