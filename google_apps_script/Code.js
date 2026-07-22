/**
 * Google Apps Script — Sincronização Live SSO (Etapa 2)
 * Planilha: 1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE
 * 
 * Instalação:
 *   1. Na planilha Google Sheets, abra Extensões -> Apps Script.
 *   2. Cole este código no arquivo Code.gs.
 *   3. Configure o acionador (Trigger) para rodar periodicamente ou no evento ao Editar (onEdit/onChange).
 */

const CONFIG = {
  SPREADSHEET_ID: "1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE",
  EDGE_FUNCTION_URL: "https://wutmhhqbdwslwiawqwut.supabase.co/functions/v1/sync-sheets",
  HEADER_ROW: 4,
  CUTOFF_DATE: "2026-07-01",
  AUTHORIZED_TABS: {
    "VINICIUS.26": "VINICIUS",
    "GUSTAVO.26":  "GUSTAVO",
    "LUCAS.26":    "LUCAS",
    "VITORIA.26":  "VITÓRIA",
    "MIKAELI":     "MIKAELLE",
    "CAILLANE.26": "CAILLANE",
    "AMANDA.26":   "AMANDA",
    "JESSICA.26":  "JESSICA"
  }
};

/**
 * Função principal disparada via menu ou trigger.
 */
function syncSheetsToSupabase() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const payload = {
    spreadsheet_id: CONFIG.SPREADSHEET_ID,
    synced_at: new Date().toISOString(),
    rows: []
  };

  const sheets = ss.getSheets();

  sheets.forEach(sheet => {
    const tabName = sheet.getName().trim();
    if (!CONFIG.AUTHORIZED_TABS[tabName]) {
      return;
    }

    const defaultVendedor = CONFIG.AUTHORIZED_TABS[tabName];
    processSheet(sheet, tabName, defaultVendedor, payload.rows);
  });

  Logger.log("Total de linhas válidas preparadas para sync: " + payload.rows.length);

  // Enviar payload para o Supabase Edge Function
  if (payload.rows.length > 0) {
    sendToSupabase(payload);
  }
}

/**
 * Processa uma aba da planilha.
 */
function processSheet(sheet, tabName, defaultVendedor, rowsBuffer) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < CONFIG.HEADER_ROW) return;

  const dataRange = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headerRowVals = dataRange[CONFIG.HEADER_ROW - 1];

  // Localizar colunas dinamicamente pelo texto do cabeçalho
  const colMap = mapHeaders(headerRowVals);

  // Garantir coluna ID_REGISTRO no cabeçalho
  let idColIdx = colMap["id_registro"];
  if (idColIdx === undefined || idColIdx === null) {
    idColIdx = lastCol;
    sheet.getRange(CONFIG.HEADER_ROW, idColIdx + 1).setValue("ID_REGISTRO");
    colMap["id_registro"] = idColIdx;
  }

  // Iterar pelas linhas de dados (linha 5 em diante)
  for (let r = CONFIG.HEADER_ROW; r < lastRow; r++) {
    const rowVals = dataRange[r];
    const dataRaw = colMap["data"] !== undefined ? rowVals[colMap["data"]] : null;

    // Converter e validar data
    const dateObj = parseGoogleSheetDate(dataRaw);
    if (!dateObj) continue;

    const dateStr = formatDateISO(dateObj);
    if (dateStr < CONFIG.CUTOFF_DATE) continue; // Corte obrigatorio 01/07/2026

    // Garantir ID_REGISTRO estável
    let recordId = colMap["id_registro"] !== undefined ? String(rowVals[colMap["id_registro"]]).trim() : "";
    if (!recordId || recordId === "undefined" || recordId.length < 10) {
      recordId = Utilities.getUuid();
      sheet.getRange(r + 1, idColIdx + 1).setValue(recordId); // Grava celula oculta/técnica
    }

    // Extrair valores dos demais campos
    const qtdVal          = getVal(rowVals, colMap["qtd"]);
    const vendedorVal     = getVal(rowVals, colMap["vendedor"]) || defaultVendedor;
    const qtdFuncVal      = parseFunc(getVal(rowVals, colMap["qtd_func"]));
    const fonteLeadVal    = getVal(rowVals, colMap["fonte_lead"]);
    const valorMensalVal  = parseValor(getVal(rowVals, colMap["valor_mensal"]));
    const valorTotalVal   = parseValor(getVal(rowVals, colMap["valor_total"]));
    const statusVal       = getVal(rowVals, colMap["status"]);
    const tipoContratoVal = getVal(rowVals, colMap["tipo_contrato"]);
    const tipoBaseVal     = getVal(rowVals, colMap["tipo_base"]);
    const situacaoVal     = getVal(rowVals, colMap["situacao_contrato"]);
    const numeroOsVal     = getVal(rowVals, colMap["numero_os"]);
    const parcelasVal     = getVal(rowVals, colMap["parcelas"]);

    const rowHash = computeRowHash([
      dateStr, recordId, vendedorVal, qtdFuncVal, fonteLeadVal,
      valorMensalVal, valorTotalVal, statusVal, tipoContratoVal
    ]);

    rowsBuffer.push({
      source_type: "GOOGLE_SHEETS_LIVE",
      spreadsheet_id: CONFIG.SPREADSHEET_ID,
      source_sheet: tabName,
      source_record_id: recordId,
      data_referencia: dateStr,
      mes_referencia: dateObj.getMonth() + 1,
      ano_referencia: dateObj.getFullYear(),
      vendedor: vendedorVal,
      quantidade_funcionarios: qtdFuncVal,
      fonte_lead: fonteLeadVal,
      valor_mensal: valorMensalVal,
      valor_total: valorTotalVal,
      status: statusVal,
      tipo_contrato: tipoContratoVal,
      tipo_base: tipoBaseVal,
      situacao_contrato: situacaoVal,
      numero_os: numeroOsVal,
      row_hash: rowHash
    });
  }
}

/**
 * Mapeia os índices de coluna a partir do texto do cabeçalho.
 */
function mapHeaders(headerRowVals) {
  const map = {};
  headerRowVals.forEach((val, idx) => {
    if (!val) return;
    const str = String(val).trim().toUpperCase();

    if (str === "QTD" && map["qtd"] === undefined) map["qtd"] = idx;
    else if (str === "DATA" && map["data"] === undefined) map["data"] = idx;
    else if ((str.indexOf("FUNCIONARIO") !== -1 || str.indexOf("FUNCIONÁRIO") !== -1) && map["qtd_func"] === undefined) map["qtd_func"] = idx;
    else if (str.indexOf("FONTE") !== -1 && map["fonte_lead"] === undefined) map["fonte_lead"] = idx;
    else if (str === "VENDEDOR" && map["vendedor"] === undefined) map["vendedor"] = idx;
    else if (str.indexOf("VALOR MENSAL") !== -1 && map["valor_mensal"] === undefined) map["valor_mensal"] = idx;
    else if (str.indexOf("VALOR TOTAL") !== -1 && map["valor_total"] === undefined) map["valor_total"] = idx;
    else if (str === "STATUS" && map["status"] === undefined) map["status"] = idx;
    else if (str.indexOf("TIPO DE CONTRATO") !== -1 && map["tipo_contrato"] === undefined) map["tipo_contrato"] = idx;
    else if (str.indexOf("TIPO DE BASE") !== -1 && map["tipo_base"] === undefined) map["tipo_base"] = idx;
    else if (str.indexOf("SITUAÇ") !== -1 && map["situacao_contrato"] === undefined) map["situacao_contrato"] = idx;
    else if ((str.indexOf("NUMERO O.S") !== -1 || str.indexOf("NÚMERO O.S") !== -1) && map["numero_os"] === undefined) map["numero_os"] = idx;
    else if (str.indexOf("PARCELAS") !== -1 && map["parcelas"] === undefined) map["parcelas"] = idx;
    else if (str === "ID_REGISTRO" && map["id_registro"] === undefined) map["id_registro"] = idx;
  });
  return map;
}

function getVal(rowVals, idx) {
  if (idx === undefined || idx === null || idx >= rowVals.length) return null;
  const v = rowVals[idx];
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim();
}

function parseGoogleSheetDate(raw) {
  if (!raw) return null;
  if (Object.prototype.toString.call(raw) === "[object Date]") return raw;
  const s = String(raw).trim();
  const parts = s.split("/");
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m, d);
  }
  return null;
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + "-" + m + "-" + d;
}

function parseValor(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (s.indexOf("À VISTA") !== -1 || s.indexOf("A VISTA") !== -1) return 0.0;
  if (s.indexOf("#DIV/0!") !== -1 || s.indexOf("#VALUE!") !== -1 || s === "X") return null;

  const num = parseFloat(s.replace("R$", "").replace(/\./g, "").replace(",", "."));
  return isNaN(num) ? null : num;
}

function parseFunc(raw) {
  if (!raw) return null;
  const num = parseInt(String(raw).replace(/\D/g, ""), 10);
  return isNaN(num) ? null : num;
}

function computeRowHash(arr) {
  const text = arr.map(v => (v === null || v === undefined ? "" : String(v))).join("|");
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text);
  return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function sendToSupabase(payload) {
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(CONFIG.EDGE_FUNCTION_URL, options);
  Logger.log("Supabase Resposta: " + response.getResponseCode() + " " + response.getContentText());
}
