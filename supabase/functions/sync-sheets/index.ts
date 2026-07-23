// ============================================================================
// SUPABASE EDGE FUNCTION: sync-sheets
// Endpoint: POST /functions/v1/sync-sheets
//
// Fluxo:
//   1. Recebe trigger do Dashboard (ou chamada direta com rows)
//   2. Chama Google Apps Script para extrair linhas sanitizadas
//   3. Insere / atualiza em registros_comerciais
//   4. Inativa registros GOOGLE_SHEETS_LIVE que sumiram da planilha
//   5. Retorna resumo completo com apps_script_log
//
// Secrets necessários (Supabase → Project Settings → Edge Functions):
//   SUPABASE_URL                 (automático)
//   SUPABASE_SERVICE_ROLE_KEY    (automático)
//   GOOGLE_APPS_SCRIPT_URL       URL /exec do Web App (https://script.google.com/macros/s/.../exec)
//   GOOGLE_APPS_SCRIPT_SECRET    SYNC_SECRET configurado no Apps Script
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APPS_SCRIPT_URL           = Deno.env.get("GOOGLE_APPS_SCRIPT_URL") ?? "";
const APPS_SCRIPT_SECRET        = Deno.env.get("GOOGLE_APPS_SCRIPT_SECRET") ?? "";

const TABLE    = "registros_comerciais";
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

  // ── Parse body ────────────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { body = {}; }

  // ── Obter linhas ──────────────────────────────────────────────────────
  let rows: Record<string, unknown>[] = [];
  let appsScriptLog: unknown[] = [];
  let spreadsheetId = "1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE";

  try {
    if (body.rows && Array.isArray(body.rows) && (body.rows as unknown[]).length > 0) {
      // Modo direto: linhas fornecidas no body
      rows = body.rows as Record<string, unknown>[];
      if (body.spreadsheet_id) spreadsheetId = body.spreadsheet_id as string;

    } else {
      // ── Validação do secret obrigatório ───────────────────────────────
      if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.trim() === "") {
        return new Response(
          JSON.stringify({
            success: false,
            error  : "GOOGLE_APPS_SCRIPT_URL não configurada nos Secrets da Edge Function. Acesse: Supabase Dashboard → Project Settings → Edge Functions → Secrets → adicione GOOGLE_APPS_SCRIPT_URL com a URL /exec do Apps Script.",
          }),
          { headers: { "Content-Type": "application/json", ...CORS_HEADERS }, status: 400 }
        );
      }

      // ── Chamar Apps Script ────────────────────────────────────────────
      console.log("[sync-sheets] Chamando Apps Script:", APPS_SCRIPT_URL.slice(0, 60) + "...");

      let appsResp: Response;
      try {
        appsResp = await fetch(APPS_SCRIPT_URL, {
          method : "POST",
          headers: { "Content-Type": "application/json" },
          body   : JSON.stringify({ secret: APPS_SCRIPT_SECRET }),
          // Apps Script pode demorar; timeout de 55s (limite Deno Edge Function = 60s)
          signal : AbortSignal.timeout(55_000),
        });
      } catch (fetchErr) {
        return new Response(
          JSON.stringify({
            success: false,
            error  : `Falha ao contatar Apps Script: ${String(fetchErr)}. Verifique se a URL /exec está correta e se o Web App está implantado como "Qualquer pessoa".`,
          }),
          { headers: { "Content-Type": "application/json", ...CORS_HEADERS }, status: 502 }
        );
      }

      if (!appsResp.ok) {
        const errText = await appsResp.text().catch(() => "");
        return new Response(
          JSON.stringify({
            success: false,
            error  : `Apps Script retornou HTTP ${appsResp.status}: ${errText}`,
          }),
          { headers: { "Content-Type": "application/json", ...CORS_HEADERS }, status: 502 }
        );
      }

      let appsData: Record<string, unknown>;
      try {
        appsData = await appsResp.json();
      } catch (jsonErr) {
        const rawText = await appsResp.text().catch(() => "");
        return new Response(
          JSON.stringify({
            success: false,
            error  : `Apps Script não retornou JSON válido: ${String(jsonErr)}. Resposta: ${rawText.slice(0, 300)}`,
          }),
          { headers: { "Content-Type": "application/json", ...CORS_HEADERS }, status: 502 }
        );
      }

      if (!appsData.success) {
        return new Response(
          JSON.stringify({
            success: false,
            error  : `Apps Script retornou erro: ${appsData.error ?? JSON.stringify(appsData)}`,
          }),
          { headers: { "Content-Type": "application/json", ...CORS_HEADERS }, status: 502 }
        );
      }

      rows          = (appsData.rows as Record<string, unknown>[]) ?? [];
      appsScriptLog = (appsData.log  as unknown[]) ?? [];

      if (appsData.spreadsheet_id) {
        spreadsheetId = appsData.spreadsheet_id as string;
      }

      console.log(`[sync-sheets] Apps Script retornou ${rows.length} linhas`);
    }
  } catch (outerErr) {
    return new Response(
      JSON.stringify({ success: false, error: `Erro ao obter dados: ${String(outerErr)}` }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS }, status: 500 }
    );
  }

  // ── Registrar início em sync_runs ──────────────────────────────────────
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
    return new Response(
      JSON.stringify({ success: false, error: `Falha ao registrar sync_run: ${syncError.message}` }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS }, status: 500 }
    );
  }

  const syncRunId: string = syncRun.id;
  let inserted    = 0;
  let updated     = 0;
  let skipped     = 0;
  let ignored     = 0;
  let errors      = 0;

  // IDs vistos nesta sincronização (para reconciliação de inativos)
  const seenSourceIds = new Set<string>();

  // ── Processar cada linha ───────────────────────────────────────────────
  for (const r of rows) {
    const dataRef        = r.data_referencia as string | null;
    const sourceRecordId = r.source_record_id as string | null;
    const sourceSheet    = r.source_sheet as string | null;

    // Validação de data — regra de corte [DATE_MIN, DATE_MAX]
    if (!dataRef || dataRef < DATE_MIN || dataRef > DATE_MAX) {
      ignored++;
      await supabase.from("data_quality_issues").insert({
        sync_run_id : syncRunId,
        source_sheet: sourceSheet,
        issue_code  : dataRef && dataRef > DATE_MAX ? "DATA_ALEM_DO_PERIODO" : "DATA_FORA_DO_CORTE",
        severity    : dataRef && dataRef > DATE_MAX ? "WARNING" : "INFO",
        message     : `data_referencia '${dataRef}' fora de [${DATE_MIN}, ${DATE_MAX}]`,
        raw_value   : JSON.stringify(r).slice(0, 500),
        resolved    : false,
      });
      continue;
    }

    // source_record_id obrigatório para reconciliação
    if (!sourceRecordId) {
      ignored++;
      await supabase.from("data_quality_issues").insert({
        sync_run_id : syncRunId,
        source_sheet: sourceSheet,
        issue_code  : "SOURCE_RECORD_ID_AUSENTE",
        severity    : "ERROR",
        message     : "source_record_id ausente — linha não pode ser reconciliada",
        raw_value   : JSON.stringify(r).slice(0, 500),
        resolved    : false,
      });
      continue;
    }

    seenSourceIds.add(sourceRecordId);

    // Verificar existência
    const { data: existing } = await supabase
      .from(TABLE)
      .select("id_registro, row_hash, is_active")
      .eq("source_type", "GOOGLE_SHEETS_LIVE")
      .eq("spreadsheet_id", spreadsheetId)
      .eq("source_record_id", sourceRecordId)
      .maybeSingle();

    if (existing) {
      // Sem mudança e já ativo → pular
      if (existing.row_hash === r.row_hash && existing.is_active) {
        skipped++;
        continue;
      }

      // Atualizar (inclui reativação se is_active=false)
      const { error: updateErr } = await supabase
        .from(TABLE)
        .update({
          data_referencia         : r.data_referencia,
          mes_referencia          : r.mes_referencia,
          ano_referencia          : r.ano_referencia,
          data_fechamento         : r.data_fechamento ?? null,
          data_envio_orcamento    : r.data_envio_orcamento ?? null,
          vendedor                : r.vendedor,
          quantidade_funcionarios : r.quantidade_funcionarios,
          fonte_lead              : r.fonte_lead,
          valor_mensal            : r.valor_mensal,
          valor_total             : r.valor_total,
          status                  : r.status,
          tipo_contrato           : r.tipo_contrato,
          tipo_base               : r.tipo_base,
          situacao_contrato       : r.situacao_contrato,
          numero_os               : r.numero_os,
          row_hash                : r.row_hash,
          is_active               : true,
          updated_at              : new Date().toISOString(),
          synced_at               : new Date().toISOString(),
        })
        .eq("id_registro", existing.id_registro);

      if (updateErr) {
        errors++;
        console.error("[sync-sheets] Erro update:", updateErr.message);
        await supabase.from("data_quality_issues").insert({
          sync_run_id : syncRunId,
          source_sheet: sourceSheet,
          issue_code  : "ERRO_UPDATE",
          severity    : "ERROR",
          message     : updateErr.message,
          raw_value   : JSON.stringify(r).slice(0, 500),
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
          source_type             : "GOOGLE_SHEETS_LIVE",
          spreadsheet_id          : spreadsheetId,
          source_sheet            : sourceSheet,
          source_record_id        : sourceRecordId,
          data_referencia         : r.data_referencia,
          mes_referencia          : r.mes_referencia,
          ano_referencia          : r.ano_referencia,
          data_fechamento         : r.data_fechamento ?? null,
          data_envio_orcamento    : r.data_envio_orcamento ?? null,
          vendedor                : r.vendedor,
          quantidade_funcionarios : r.quantidade_funcionarios,
          fonte_lead              : r.fonte_lead,
          valor_mensal            : r.valor_mensal,
          valor_total             : r.valor_total,
          status                  : r.status,
          tipo_contrato           : r.tipo_contrato,
          tipo_base               : r.tipo_base,
          situacao_contrato       : r.situacao_contrato,
          numero_os               : r.numero_os,
          row_hash                : r.row_hash,
          is_active               : true,
          created_at              : new Date().toISOString(),
          updated_at              : new Date().toISOString(),
          synced_at               : new Date().toISOString(),
        });

      if (insertErr) {
        errors++;
        console.error("[sync-sheets] Erro insert:", insertErr.message);
        await supabase.from("data_quality_issues").insert({
          sync_run_id : syncRunId,
          source_sheet: sourceSheet,
          issue_code  : "ERRO_INSERT",
          severity    : "ERROR",
          message     : insertErr.message,
          raw_value   : JSON.stringify(r).slice(0, 500),
          resolved    : false,
        });
      } else {
        inserted++;
      }
    }
  }

  // ── Reconciliação: inativar registros que sumiram da planilha ──────────
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
            issue_code  : "REGISTRO_INATIVADO",
            severity    : "INFO",
            message     : `source_record_id '${rec.source_record_id}' ausente na planilha — inativado`,
            resolved    : false,
          });
        }
      }
    }
  }

  // ── Finalizar sync_run ─────────────────────────────────────────────────
  await supabase
    .from("sync_runs")
    .update({
      status       : errors > 0 && inserted + updated === 0 ? "ERROR" : "SUCCESS",
      rows_inserted: inserted,
      rows_updated : updated,
      rows_rejected: ignored + errors,
      finished_at  : new Date().toISOString(),
    })
    .eq("id", syncRunId);

  console.log(`[sync-sheets] Concluído: inseridos=${inserted} atualizados=${updated} ignorados=${ignored} erros=${errors} inativados=${inactivated}`);

  return new Response(
    JSON.stringify({
      success         : true,
      sync_id         : syncRunId,
      summary         : { total: rows.length, inserted, updated, skipped, ignored, errors, inactivated },
      apps_script_log : appsScriptLog,
    }),
    { headers: { "Content-Type": "application/json", ...CORS_HEADERS }, status: 200 }
  );
});
