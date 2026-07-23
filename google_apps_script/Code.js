/**
 * ============================================================================
 * Google Apps Script — Web App de Leitura e Sanitização SSO
 * Planilha ID: 1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE
 * ============================================================================
 *
 * ARQUITETURA:
 *   Dashboard → Edge Function sync-sheets → Google Apps Script doPost
 *   → Google Sheets → retorna linhas sanitizadas → Edge Function → Supabase
 *
 * REGRAS DE LEITURA:
 *   - Cabeçalho na linha 4 (CONFIG.HEADER_ROW = 4)
 *   - Mapeamento dinâmico de cabeçalhos (não posições fixas)
 *   - Importar a linha quando PELO MENOS UM dos três eventos for verdadeiro:
 *
 *     evento_oportunidade = data_referencia (coluna B) válida e >= DATE_MIN
 *     evento_proposta     = data_envio_orcamento válida e >= DATE_MIN
 *     evento_venda        = STATUS = CONTRATO FECHADO
 *                           E data_fechamento válida e >= DATE_MIN
 *
 *   - Linhas com coluna B vazia → data_referencia = null (SEM inventar data)
 *   - Linha de modelo sem nenhum campo comercial → ignorar
 *   - Data > DATE_MAX → avisar no log, mas ainda importar se um evento for válido
 *   - Dois cabeçalhos "TIPO DE CONTRATO" → separar tipo_base (NOVO/ANTIGO)
 *     de tipo_contrato (Pacote SST, NR-01, Laudos, etc.)
 *   - "À vista" em VALOR MENSAL → valor_mensal = 0
 *   - Campos ausentes → null (sem deslocar outras colunas)
 *
 * IMPLANTAÇÃO:
 *   1. Extensões → Apps Script → cole este código em Code.gs
 *   2. Configurações → Propriedades → adicione 'SYNC_SECRET'
 *   3. Implantar → Nova Implantação → Web App
 *      Executar como: Eu | Acesso: Qualquer pessoa (Anyone)
 *   4. Copie a URL /exec e configure no Supabase Secret GOOGLE_APPS_SCRIPT_URL
 */

const CONFIG = {
  SPREADSHEET_ID: "1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE",
  HEADER_ROW   : 4,
  DATE_MIN     : "2026-07-01",  // Inclusive — data mínima de importação
  DATE_MAX     : "2026-12-31",  // Inclusive — data máxima de importação

  /**
   * Abas autorizadas → nome do vendedor padrão.
   * Usar os nomes EXATOS das abas da planilha.
   */
  AUTHORIZED_TABS: {
    "VINICIUS.26"      : "VINICIUS",
    "GUSTAVO.26"       : "GUSTAVO",
    "LUCAS.26"         : "LUCAS",
    "VITORIA.26"       : "VITÓRIA",
    "MIKAELLE.26"      : "MIKAELLE",
    "CAILLANE.26"      : "CAILLANE",
    "AMANDA.26"        : "AMANDA",
    "JESSICA.26"       : "JESSICA",
    "GUSTAVO LAMEGO.26": "GUSTAVO LAMEGO"
  }
};

/* ─── 1. VERIFICAÇÃO DE SAÚDE (GET) ──────────────────────────────────── */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status   : "online",
    service  : "SSO Sales Google Sheets Reader WebApp",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/* ─── 2. PONTO DE ENTRADA HTTP POST ──────────────────────────────────── */
function doPost(e) {
  try {
    let requestData = {};
    if (e && e.postData && e.postData.contents) {
      try { requestData = JSON.parse(e.postData.contents); }
      catch (_) { requestData = {}; }
    }

    const scriptSecret  = PropertiesService.getScriptProperties().getProperty("SYNC_SECRET");
    const receivedSecret = requestData.secret
      || (e && e.parameter ? e.parameter.secret : null);

    if (!scriptSecret || receivedSecret !== scriptSecret) {
      return _json({ success: false,
        error: "Acesso não autorizado. Segredo incorreto ou não configurado." });
    }

    const result = lerDadosSanitizados();

    return _json({
      success       : true,
      spreadsheet_id: CONFIG.SPREADSHEET_ID,
      extracted_at  : new Date().toISOString(),
      total_rows    : result.rows.length,
      rows          : result.rows,
      log           : result.log     // por aba: lido, válido, ignorado, motivos
    });

  } catch (err) {
    return _json({ success: false, error: String(err) });
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ─── 3. TESTE MANUAL (rodar direto no Apps Script) ──────────────────── */
function testarLeitura() {
  const result = lerDadosSanitizados();
  Logger.log("=== RESUMO ===");
  result.log.forEach(function(entry) { Logger.log(JSON.stringify(entry)); });
  Logger.log("Total de registros válidos: " + result.rows.length);
  if (result.rows.length > 0) {
    Logger.log("Primeiro registro: " + JSON.stringify(result.rows[0], null, 2));
  }
  return result;
}

/* ─── 4. GERAR IDs AUSENTES NA PLANILHA ──────────────────────────────── */
function gerarIdsAusentes() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let totalGerados = 0;

  Object.keys(CONFIG.AUTHORIZED_TABS).forEach(function(tabName) {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < CONFIG.HEADER_ROW) return;

    const headerRowVals = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
    const colMap = mapHeaders(headerRowVals);

    // Garantir coluna ID_REGISTRO
    let idColIdx = colMap["id_registro"];
    if (idColIdx === undefined || idColIdx === null) {
      idColIdx = lastCol; // 0-based: próxima coluna
      sheet.getRange(CONFIG.HEADER_ROW, idColIdx + 1).setValue("ID_REGISTRO");
      try { sheet.hideColumns(idColIdx + 1); } catch(_) {}
      colMap["id_registro"] = idColIdx;
    }

    const dataRange = sheet.getRange(CONFIG.HEADER_ROW + 1, 1,
      lastRow - CONFIG.HEADER_ROW, Math.max(lastCol, idColIdx + 1)).getValues();

    for (let r = 0; r < dataRange.length; r++) {
      const rowVals = dataRange[r];

      // Verificar se há qualquer conteúdo comercial na linha
      const statusRaw  = getVal(rowVals, colMap["status"]) || "";
      const dataEnvRaw = rowVals[colMap["data_envio"]] || null;
      const dataFechRaw = rowVals[colMap["data_fechamento"]] || null;
      const dataRaw    = colMap["data"] !== undefined ? rowVals[colMap["data"]] : null;

      const dateOppObj   = parseGoogleSheetDate(dataRaw);
      const dateEnvObj   = parseGoogleSheetDate(dataEnvRaw);
      const dateFechObj  = parseGoogleSheetDate(dataFechRaw);

      const dateOppStr   = dateOppObj  ? formatDateISO(dateOppObj)  : null;
      const dateEnvStr   = dateEnvObj  ? formatDateISO(dateEnvObj)  : null;
      const dateFechStr  = dateFechObj ? formatDateISO(dateFechObj) : null;
      const ehContrato   = statusRaw.trim().toUpperCase() === "CONTRATO FECHADO";

      const evtOpp    = dateOppStr  !== null && dateOppStr  >= CONFIG.DATE_MIN && dateOppStr  <= CONFIG.DATE_MAX;
      const evtProp   = dateEnvStr  !== null && dateEnvStr  >= CONFIG.DATE_MIN && dateEnvStr  <= CONFIG.DATE_MAX;
      const evtVenda  = ehContrato  && dateFechStr !== null && dateFechStr >= CONFIG.DATE_MIN && dateFechStr <= CONFIG.DATE_MAX;

      if (!evtOpp && !evtProp && !evtVenda) continue;

      let recordId = idColIdx < rowVals.length ? String(rowVals[idColIdx]).trim() : "";
      if (!recordId || recordId === "undefined" || recordId === "null" || recordId.length < 10) {
        recordId = Utilities.getUuid();
        sheet.getRange(CONFIG.HEADER_ROW + 1 + r, idColIdx + 1).setValue(recordId);
        totalGerados++;
      }
    }
  });

  Logger.log("Total de novos IDs gerados: " + totalGerados);
  return totalGerados;
}

/* ─── 5. EXTRATOR PRINCIPAL ───────────────────────────────────────────── */
function lerDadosSanitizados() {
  const ss   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const rows = [];
  const log  = [];

  Object.keys(CONFIG.AUTHORIZED_TABS).forEach(function(tabName) {
    const sheet = ss.getSheetByName(tabName);
    const entry = {
      aba         : tabName,
      lido        : 0,
      valido      : 0,
      ignorado    : 0,
      evt_opp     : 0,
      evt_proposta: 0,
      evt_venda   : 0,
      motivos     : []
    };

    if (!sheet) {
      entry.motivos.push("Aba não encontrada na planilha");
      log.push(entry);
      return;
    }

    const defaultVendedor = CONFIG.AUTHORIZED_TABS[tabName];
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow < CONFIG.HEADER_ROW) {
      entry.motivos.push("Aba sem dados (lastRow < HEADER_ROW)");
      log.push(entry);
      return;
    }

    const dataRange     = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headerRowVals = dataRange[CONFIG.HEADER_ROW - 1];
    const colMap        = mapHeaders(headerRowVals);

    // Garantir coluna ID_REGISTRO na aba
    let idColIdx = colMap["id_registro"];
    if (idColIdx === undefined || idColIdx === null) {
      idColIdx = lastCol;
      sheet.getRange(CONFIG.HEADER_ROW, idColIdx + 1).setValue("ID_REGISTRO");
      try { sheet.hideColumns(idColIdx + 1); } catch(_) {}
      colMap["id_registro"] = idColIdx;
    }

    for (let r = CONFIG.HEADER_ROW; r < lastRow; r++) {
      const rowVals = dataRange[r];
      entry.lido++;

      // ── PASSO 1: Ler todos os campos comerciais relevantes ──────────────
      const dataRaw         = colMap["data"]          !== undefined ? rowVals[colMap["data"]]          : null;
      const dataEnvioRaw    = colMap["data_envio"]    !== undefined ? rowVals[colMap["data_envio"]]    : null;
      const dataFechRaw     = colMap["data_fechamento"] !== undefined ? rowVals[colMap["data_fechamento"]] : null;
      const statusRaw       = getVal(rowVals, colMap["status"]) || "";
      const tipoContratoVal = getVal(rowVals, colMap["tipo_contrato"]);
      const tipoBaseVal     = getVal(rowVals, colMap["tipo_base"]);
      const valorTotalVal   = parseValorTotal(getVal(rowVals, colMap["valor_total"]));
      const valorMensalVal  = parseValorMensal(getVal(rowVals, colMap["valor_mensal"]));
      const fonteLeadVal    = getVal(rowVals, colMap["fonte_lead"]);
      const vendedorVal     = getVal(rowVals, colMap["vendedor"]) || defaultVendedor;
      const qtdFuncVal      = parseFunc(getVal(rowVals, colMap["qtd_func"]));
      const parcelasVal     = parseFunc(getVal(rowVals, colMap["parcelas"]));
      const situacaoVal     = getVal(rowVals, colMap["situacao_contrato"]);
      const numeroOsVal     = getVal(rowVals, colMap["numero_os"]);
      const qtdVal          = getVal(rowVals, colMap["qtd"]);

      // ── PASSO 2: Parsear datas ──────────────────────────────────────────
      const dateOppObj   = parseGoogleSheetDate(dataRaw);
      const dateEnvObj   = parseGoogleSheetDate(dataEnvioRaw);
      const dateFechObj  = parseGoogleSheetDate(dataFechRaw);

      const dateOppStr   = dateOppObj  ? formatDateISO(dateOppObj)  : null;
      const dateEnvStr   = dateEnvObj  ? formatDateISO(dateEnvObj)  : null;
      const dateFechStr  = dateFechObj ? formatDateISO(dateFechObj) : null;

      const ehContrato = statusRaw.trim().toUpperCase() === "CONTRATO FECHADO";

      // ── PASSO 3: Determinar três eventos independentes ──────────────────
      //
      //   evento_oportunidade = data_referencia válida e dentro do período
      //   evento_proposta     = data_envio_orcamento válida e dentro do período
      //   evento_venda        = CONTRATO FECHADO e data_fechamento válida e dentro do período
      //
      const evtOpp   = dateOppStr  !== null
                        && dateOppStr  >= CONFIG.DATE_MIN
                        && dateOppStr  <= CONFIG.DATE_MAX;
      const evtProp  = dateEnvStr  !== null
                        && dateEnvStr  >= CONFIG.DATE_MIN
                        && dateEnvStr  <= CONFIG.DATE_MAX;
      const evtVenda = ehContrato
                        && dateFechStr !== null
                        && dateFechStr >= CONFIG.DATE_MIN
                        && dateFechStr <= CONFIG.DATE_MAX;

      // ── PASSO 4: Importar se pelo menos um evento for verdadeiro ─────────
      if (!evtOpp && !evtProp && !evtVenda) {
        // Nenhum evento relevante → ignorar silenciosamente
        entry.ignorado++;
        continue;
      }

      // Contabilizar eventos
      if (evtOpp)   entry.evt_opp++;
      if (evtProp)  entry.evt_proposta++;
      if (evtVenda) entry.evt_venda++;

      // Avisar data_referencia além de DATE_MAX (dado anormal)
      if (dateOppStr && dateOppStr > CONFIG.DATE_MAX) {
        entry.motivos.push("Linha " + (r + 1) + ": data_referencia '" + dateOppStr
          + "' após " + CONFIG.DATE_MAX + " — PROBLEMA DE QUALIDADE");
      }

      // ── PASSO 5: Ignorar linhas modelo (sem nenhum conteúdo comercial) ───
      if (!tipoContratoVal && !statusRaw
          && valorTotalVal === null && valorMensalVal === null && !fonteLeadVal) {
        entry.ignorado++;
        entry.motivos.push("Linha " + (r + 1) + ": linha de modelo sem conteúdo comercial");
        continue;
      }

      // ── PASSO 6: ID_REGISTRO estável ────────────────────────────────────
      // Prioridade 1: UUID já gravado na coluna ID_REGISTRO da planilha
      // Prioridade 2: ID determinístico derivado de posição estável da linha
      let recordId = (idColIdx < rowVals.length)
        ? String(rowVals[idColIdx]).trim() : "";

      const deterministicId = makeDeterministicId(
        CONFIG.SPREADSHEET_ID, tabName, r + 1  // número real da linha (1-based)
      );

      if (!recordId || recordId === "undefined" || recordId === "null"
          || recordId.length < 10) {
        recordId = deterministicId;
        try { sheet.getRange(r + 1, idColIdx + 1).setValue(recordId); } catch(_) {}
      }

      // ── PASSO 7: Row hash completo (todos os campos relevantes) ──────────
      // Qualquer mudança em qualquer campo dispara atualização no Supabase.
      const rowHash = computeRowHash([
        recordId,
        dateOppStr,
        dateEnvStr,
        dateFechStr,
        vendedorVal,
        fonteLeadVal,
        qtdFuncVal,
        valorMensalVal,
        parcelasVal,
        valorTotalVal,
        statusRaw,
        tipoContratoVal,
        tipoBaseVal,
        situacaoVal,
        numeroOsVal
      ]);

      // ── PASSO 8: Montar registro ─────────────────────────────────────────
      rows.push({
        source_type             : "GOOGLE_SHEETS_LIVE",
        spreadsheet_id          : CONFIG.SPREADSHEET_ID,
        source_sheet            : tabName,
        source_record_id        : recordId,
        qtd_original            : qtdVal,
        // data_referencia = null quando coluna B vazia (não inventar data)
        data_referencia         : dateOppStr,
        mes_referencia          : dateOppObj ? (dateOppObj.getMonth() + 1) : null,
        ano_referencia          : dateOppObj ? dateOppObj.getFullYear()    : null,
        vendedor                : vendedorVal,
        quantidade_funcionarios : qtdFuncVal,
        fonte_lead              : fonteLeadVal,
        data_envio_orcamento    : dateEnvStr,
        data_fechamento         : dateFechStr,
        valor_mensal            : valorMensalVal,
        quantidade_parcelas     : parcelasVal,
        valor_total             : valorTotalVal,
        status                  : statusRaw || null,
        tipo_contrato           : tipoContratoVal,
        tipo_base               : tipoBaseVal,
        situacao_contrato       : situacaoVal,
        numero_os               : numeroOsVal,
        // Flags de evento para auditoria
        evento_oportunidade     : evtOpp,
        evento_proposta         : evtProp,
        evento_venda            : evtVenda,
        row_hash                : rowHash
      });
      entry.valido++;
    }

    // Confirmar escritas pendentes (IDs gravados nas células)
    try { SpreadsheetApp.flush(); } catch(_) {}

    log.push(entry);
  });

  return { rows: rows, log: log };
}

/* ─── MAPEAMENTO DINÂMICO DE CABEÇALHOS ──────────────────────────────── */
/**
 * Localiza colunas pelos textos dos cabeçalhos (case-insensitive, normalizado).
 *
 * Regra para TIPO DE CONTRATO duplo:
 *   - Primeira ocorrência de "TIPO DE CONTRATO" → tipo_contrato (pacote)
 *   - Segunda ocorrência de "TIPO DE CONTRATO" → tipo_base (novo/antigo)
 *
 * Alternativa: cabeçalho "TIPO DE BASE" → tipo_base
 */
function mapHeaders(headerRowVals) {
  const map    = {};
  let tipoContratoCount = 0;

  headerRowVals.forEach(function(val, idx) {
    if (val === null || val === undefined || val === "") return;
    const str = String(val).trim().toUpperCase()
      .replace(/[ÀÁÂÃÄ]/g, "A")
      .replace(/[ÈÉÊË]/g, "E")
      .replace(/[ÌÍÎÏ]/g, "I")
      .replace(/[ÒÓÔÕÖ]/g, "O")
      .replace(/[ÙÚÛÜ]/g, "U")
      .replace(/Ç/g, "C")
      .replace(/Ã/g, "A");

    if (str === "QTD" && map["qtd"] === undefined) {
      map["qtd"] = idx;
    } else if (str === "DATA" && map["data"] === undefined) {
      map["data"] = idx;
    } else if ((str.indexOf("FUNCIONARIO") !== -1 || str.indexOf("FUNCIONARIOS") !== -1)
               && map["qtd_func"] === undefined) {
      map["qtd_func"] = idx;
    } else if (str.indexOf("FONTE") !== -1 && map["fonte_lead"] === undefined) {
      map["fonte_lead"] = idx;
    } else if (str === "VENDEDOR" && map["vendedor"] === undefined) {
      map["vendedor"] = idx;
    } else if (str.indexOf("ENVIO") !== -1 && map["data_envio"] === undefined) {
      map["data_envio"] = idx;
    } else if (str.indexOf("FECHAMENTO") !== -1 && map["data_fechamento"] === undefined) {
      map["data_fechamento"] = idx;
    } else if (str.indexOf("VALOR MENSAL") !== -1 && map["valor_mensal"] === undefined) {
      map["valor_mensal"] = idx;
    } else if (str.indexOf("VALOR TOTAL") !== -1 && map["valor_total"] === undefined) {
      map["valor_total"] = idx;
    } else if (str === "STATUS" && map["status"] === undefined) {
      map["status"] = idx;
    } else if (str.indexOf("TIPO DE CONTRATO") !== -1) {
      tipoContratoCount++;
      if (tipoContratoCount === 1 && map["tipo_contrato"] === undefined) {
        map["tipo_contrato"] = idx;
      } else if (tipoContratoCount === 2 && map["tipo_base"] === undefined) {
        map["tipo_base"] = idx;
      }
    } else if (str.indexOf("TIPO DE BASE") !== -1 && map["tipo_base"] === undefined) {
      map["tipo_base"] = idx;
    } else if ((str.indexOf("BASE") !== -1 && str.indexOf("TIPO") !== -1)
               && map["tipo_base"] === undefined) {
      map["tipo_base"] = idx;
    } else if (str.indexOf("SITUAC") !== -1 && map["situacao_contrato"] === undefined) {
      map["situacao_contrato"] = idx;
    } else if ((str.indexOf("NUMERO O.S") !== -1 || str.indexOf("N. O.S") !== -1
               || str.indexOf("OS") === 0)
               && map["numero_os"] === undefined) {
      map["numero_os"] = idx;
    } else if (str.indexOf("PARCELAS") !== -1 && map["parcelas"] === undefined) {
      map["parcelas"] = idx;
    } else if (str === "ID_REGISTRO" && map["id_registro"] === undefined) {
      map["id_registro"] = idx;
    }
  });

  return map;
}

/* ─── HELPERS ─────────────────────────────────────────────────────────── */

function getVal(rowVals, idx) {
  if (idx === undefined || idx === null || idx >= rowVals.length) return null;
  const v = rowVals[idx];
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim();
}

/**
 * Converte células de data do Google Sheets (objeto Date ou string dd/mm/aaaa).
 * Retorna objeto Date ou null.
 */
function parseGoogleSheetDate(raw) {
  if (!raw) return null;
  if (Object.prototype.toString.call(raw) === "[object Date]") {
    if (isNaN(raw.getTime())) return null;
    return raw;
  }
  const s = String(raw).trim();
  if (!s || s === "" || s === "0") return null;

  // Formato dd/mm/aaaa
  const parts = s.split("/");
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y) && y >= 2020 && y <= 2099) {
      return new Date(y, m, d);
    }
  }

  // Formato aaaa-mm-dd (ISO)
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    if (y >= 2020 && y <= 2099) return new Date(y, m, d);
  }

  return null;
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function parseValorMensal(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return isNaN(raw) ? null : raw;

  const s = String(raw).trim().toUpperCase();
  if (s === "") return null;
  if (s.indexOf("A VISTA") !== -1 || s.indexOf("À VISTA") !== -1) return 0.0;
  if (s.indexOf("#DIV") !== -1 || s.indexOf("#VALUE") !== -1
      || s === "X" || s === "-") return null;

  let cleaned = s.replace(/R\$\s*/g, "").trim();
  const hasBrFormat = /^[\d\.]+,[\d]{2}$/.test(cleaned) ||
                      /^[\d]{1,3}(\.[\d]{3})+,[\d]{2}$/.test(cleaned);
  if (hasBrFormat) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseValorTotal(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return isNaN(raw) ? null : raw;

  const s = String(raw).trim().toUpperCase();
  if (s === "") return null;
  if (s.indexOf("#DIV") !== -1 || s.indexOf("#VALUE") !== -1
      || s === "X" || s === "À DEFINIR" || s === "A DEFINIR" || s === "-") return null;

  let cleaned = s.replace(/R\$\s*/g, "").trim();
  const hasBrFormat = /^[\d\.]+,[\d]{2}$/.test(cleaned) ||
                      /^[\d]{1,3}(\.[\d]{3})+,[\d]{2}$/.test(cleaned);
  if (hasBrFormat) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseFunc(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  const num = parseInt(digits, 10);
  return isNaN(num) ? null : num;
}

function computeRowHash(arr) {
  const text = arr.map(function(v) {
    return (v === null || v === undefined) ? "" : String(v);
  }).join("|");
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text);
  return bytes.map(function(b) {
    return (b < 0 ? b + 256 : b).toString(16).padStart(2, "0");
  }).join("");
}

/**
 * Gera ID estável e determinístico para uma linha da planilha.
 * Baseado em: spreadsheet_id + "|" + tabName + "|" + rowNum (1-based)
 */
function makeDeterministicId(spreadsheetId, tabName, rowNum) {
  const key = spreadsheetId + "|" + tabName + "|" + String(rowNum);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key);
  const hex = bytes.map(function(b) {
    return (b < 0 ? b + 256 : b).toString(16).padStart(2, "0");
  }).join("");
  // Formatar como UUID v4 (sem randomness, apenas estrutura visual)
  return hex.slice(0,8) + "-" + hex.slice(8,12) + "-4" + hex.slice(13,16) +
         "-a" + hex.slice(17,20) + "-" + hex.slice(20,32);
}
