// ============================================================================
// SUPABASE EDGE FUNCTION: sync-sheets
// Endpoint: POST /functions/v1/sync-sheets
// Recebe os dados sanitizados do Google Apps Script e realiza o UPSERT no Supabase
// Schema real em produção:
//   sync_runs:           id, spreadsheet_id, status, rows_read, rows_inserted,
//                        rows_updated, rows_rejected, error_message,
//                        started_at, finished_at
//   data_quality_issues: id, sync_run_id, source_sheet, source_row, issue_code,
//                        severity, message, raw_value, resolved, created_at
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://wutmhhqbdwslwiawqwut.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();

    const spreadsheetId = body.spreadsheet_id || "1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE";
    const rows: Record<string, unknown>[] = body.rows || [];

    // 1. Registrar início da sincronização em sync_runs
    //    Schema real: id (PK), spreadsheet_id, status, rows_read, started_at
    const { data: syncRun, error: syncError } = await supabase
      .from("sync_runs")
      .insert({
        spreadsheet_id: spreadsheetId,
        status: "RUNNING",
        rows_read: rows.length,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (syncError) {
      throw new Error(`Falha ao registrar sync_run: ${syncError.message}`);
    }

    const syncRunId: string = syncRun.id;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let ignored = 0;

    for (const r of rows) {
      const dataRef = r.data_referencia as string | null;

      // 2. Regra de corte obrigatória: somente registros >= 01/07/2026
      if (!dataRef || dataRef < "2026-07-01") {
        ignored++;
        await supabase.from("data_quality_issues").insert({
          sync_run_id: syncRunId,
          source_sheet: r.source_sheet,
          source_row: r.row_index ?? null,
          issue_code: "CORTE_DATA_IGNORADO",
          severity: "INFO",
          message: `Registro ignorado: data_referencia '${dataRef}' < 2026-07-01`,
          raw_value: JSON.stringify(r),
          resolved: false,
        });
        continue;
      }

      // 3. Verificar se o registro já existe pelo ID de origem
      const { data: existing } = await supabase
        .from("registros_comerciais")
        .select("id_registro, row_hash")
        .eq("source_type", "GOOGLE_SHEETS_LIVE")
        .eq("spreadsheet_id", spreadsheetId)
        .eq("source_record_id", r.source_record_id)
        .maybeSingle();

      if (existing) {
        if (existing.row_hash === r.row_hash) {
          skipped++; // Sem alteração → ignora update
          continue;
        }

        // Atualizar registro existente
        const { error: updateErr } = await supabase
          .from("registros_comerciais")
          .update({
            data_referencia: r.data_referencia,
            mes_referencia: r.mes_referencia,
            ano_referencia: r.ano_referencia,
            vendedor: r.vendedor,
            quantidade_funcionarios: r.quantidade_funcionarios,
            fonte_lead: r.fonte_lead,
            valor_mensal: r.valor_mensal,
            valor_total: r.valor_total,
            status: r.status,
            tipo_contrato: r.tipo_contrato,
            tipo_base: r.tipo_base,
            situacao_contrato: r.situacao_contrato,
            numero_os: r.numero_os,
            row_hash: r.row_hash,
            updated_at: new Date().toISOString(),
            synced_at: new Date().toISOString(),
          })
          .eq("id_registro", existing.id_registro);

        if (updateErr) {
          console.error("Erro ao atualizar registro:", updateErr);
          await supabase.from("data_quality_issues").insert({
            sync_run_id: syncRunId,
            source_sheet: r.source_sheet,
            issue_code: "ERRO_UPDATE",
            severity: "ERROR",
            message: updateErr.message,
            raw_value: JSON.stringify(r),
            resolved: false,
          });
        } else {
          updated++;
        }
      } else {
        // Inserir novo registro
        const { error: insertErr } = await supabase
          .from("registros_comerciais")
          .insert({
            source_type: "GOOGLE_SHEETS_LIVE",
            spreadsheet_id: spreadsheetId,
            source_sheet: r.source_sheet,
            source_record_id: r.source_record_id,
            data_referencia: r.data_referencia,
            mes_referencia: r.mes_referencia,
            ano_referencia: r.ano_referencia,
            vendedor: r.vendedor,
            quantidade_funcionarios: r.quantidade_funcionarios,
            fonte_lead: r.fonte_lead,
            valor_mensal: r.valor_mensal,
            valor_total: r.valor_total,
            status: r.status,
            tipo_contrato: r.tipo_contrato,
            tipo_base: r.tipo_base,
            situacao_contrato: r.situacao_contrato,
            numero_os: r.numero_os,
            row_hash: r.row_hash,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            synced_at: new Date().toISOString(),
          });

        if (insertErr) {
          console.error("Erro ao inserir registro:", insertErr);
          await supabase.from("data_quality_issues").insert({
            sync_run_id: syncRunId,
            source_sheet: r.source_sheet,
            issue_code: "ERRO_INSERT",
            severity: "ERROR",
            message: insertErr.message,
            raw_value: JSON.stringify(r),
            resolved: false,
          });
        } else {
          inserted++;
        }
      }
    }

    // 4. Finalizar sync_run com status final
    await supabase
      .from("sync_runs")
      .update({
        status: "SUCCESS",
        rows_inserted: inserted,
        rows_updated: updated,
        rows_rejected: ignored,
        finished_at: new Date().toISOString(),
      })
      .eq("id", syncRunId);

    return new Response(
      JSON.stringify({
        success: true,
        sync_id: syncRunId,
        summary: {
          total: rows.length,
          inserted,
          updated,
          skipped,
          ignored,
        },
      }),
      {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        status: 200,
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        status: 500,
      }
    );
  }
});
