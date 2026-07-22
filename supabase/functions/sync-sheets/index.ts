// ============================================================================
// SUPABASE EDGE FUNCTION: sync-sheets
// Endpoint: POST /functions/v1/sync-sheets
// Recebe os dados sanitizados do Google Apps Script e realiza o UPSERT no Supabase
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://wutmhhqbdwslwiawqwut.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();

    const spreadsheetId = body.spreadsheet_id || "1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE";
    const rows = body.rows || [];

    // Registrar início da sincronização em sync_runs
    const { data: syncRun, error: syncError } = await supabase
      .from("sync_runs")
      .insert({
        spreadsheet_id: spreadsheetId,
        status: "RUNNING",
        total_rows_read: rows.length,
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (syncError) {
      throw new Error(`Falha ao registrar sync_run: ${syncError.message}`);
    }

    const syncId = syncRun.id_sync;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let ignored = 0;

    for (const r of rows) {
      // 1. Regra de corte obrigatoria
      if (!r.data_referencia || r.data_referencia < "2026-07-01") {
        ignored++;
        await supabase.from("data_quality_issues").insert({
          id_sync: syncId,
          spreadsheet_id: spreadsheetId,
          sheet_name: r.source_sheet,
          issue_type: "CORTE_DATA_IGNORADO",
          raw_data: r,
          description: `Registro ignorado: data_referencia '${r.data_referencia}' < 2026-07-01`
        });
        continue;
      }

      // 2. Verificar se o registro ja existe pelo ID de origem
      const { data: existing } = await supabase
        .from("registros_comerciais")
        .select("id_registro, row_hash")
        .eq("source_type", "GOOGLE_SHEETS_LIVE")
        .eq("spreadsheet_id", spreadsheetId)
        .eq("source_record_id", r.source_record_id)
        .maybeSingle();

      if (existing) {
        if (existing.row_hash === r.row_hash) {
          skipped++;
          continue; // Sem alteracao -> ignora update
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
            synced_at: new Date().toISOString()
          })
          .eq("id_registro", existing.id_registro);

        if (updateErr) {
          console.error("Erro ao atualizar registro:", updateErr);
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
            synced_at: new Date().toISOString()
          });

        if (insertErr) {
          console.error("Erro ao inserir registro:", insertErr);
        } else {
          inserted++;
        }
      }
    }

    // Finalizar registro de sync_run com sucesso
    await supabase
      .from("sync_runs")
      .update({
        status: "SUCCESS",
        rows_inserted: inserted,
        rows_updated: updated,
        rows_skipped: skipped,
        rows_ignored: ignored,
        completed_at: new Date().toISOString()
      })
      .eq("id_sync", syncId);

    return new Response(
      JSON.stringify({
        success: true,
        sync_id: syncId,
        summary: {
          inserted,
          updated,
          skipped,
          ignored,
          total: rows.length
        }
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      {
        headers: { "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
