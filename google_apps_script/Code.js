/**
 * ============================================================================
 * Google Apps Script — Web App de Leitura e Sanitização SSO
 * Planilha ID: 1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE
 * ============================================================================
 * 
 * ARQUITETURA OBRIGATÓRIA:
 *   Dashboard → Edge Function (sync-sso-sales) → Google Apps Script Web App (doPost) → Google Sheets → Supabase
 * 
 * INSTRUÇÕES DE IMPLANTAÇÃO NO GOOGLE APPS SCRIPT:
 *   1. Na planilha Google Sheets, acesse Extensões -> Apps Script.
 *   2. Cole este código no arquivo Code.gs.
 *   3. Acesse Configurações do Projeto (ícone engrenagem) -> Propriedades do script.
 *   4. Adicione a propriedade 'SYNC_SECRET' com o seu token/segredo de sincronização.
 *   5. Clique em Implantar -> Nova Implantação -> Tipo: Web App.
 *      - Executar como: Eu (seu e-mail)
 *      - Quem tem acesso: Qualquer pessoa (Anyone)
 *   6. Copie a URL do Web App gerada e configure-a na Edge Function do Supabase.
 */

const CONFIG = {
  SPREADSHEET_ID: "1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE",
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
 * 1. PONTO DE ENTRADA HTTP GET — VERIFICAÇÃO DE SAÚDE
 * Retorna apenas status de funcionamento sem expor dados comerciais.
 */
function doGet(e) {
  const output = {
    status: "online",
    service: "SSO Sales Google Sheets Reader WebApp",
    timestamp: new Date().toISOString()
  };
  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 2. PONTO DE ENTRADA HTTP POST — EXTRAÇÃO SEGURA DE DADOS PARA EDGE FUNCTION
 * Autentica o token SYNC_SECRET recebido e retorna os registros em JSON.
 */
function doPost(e) {
  try {
    let requestData = {};
    if (e && e.postData && e.postData.contents) {
      try {
        requestData = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        requestData = {};
      }
    }

    const scriptSecret = PropertiesService.getScriptProperties().getProperty("SYNC_SECRET");
    const receivedSecret = requestData.secret || (e && e.parameter ? e.parameter.secret : null);

    if (!scriptSecret || receivedSecret !== scriptSecret) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "Acesso não autorizado. Segredo incorreto ou não configurado."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Executar a extração dos dados sanitizados
    const result = lerDadosSanitizados();

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      spreadsheet_id: CONFIG.SPREADSHEET_ID,
      extracted_at: new Date().toISOString(),
      total_rows: result.rows.length,
      rows: result.rows
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: String(err)
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 3. FUNÇÃO AUXILIAR — TESTAR LEITURA NO APPS SCRIPT
 */
function testarLeitura() {
  const result = lerDadosSanitizados();
  Logger.log("Total de registros lidos: " + result.rows.length);
  if (result.rows.length > 0) {
    Logger.log("Primeiro registro: " + JSON.stringify(result.rows[0], null, 2));
  }
  return result;
}

/**
 * 4. FUNÇÃO AUXILIAR — GERAR IDs REGISTRO AUSENTES NA PLANILHA
 */
function gerarIdsAusentes() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let totalGerados = 0;

  Object.keys(CONFIG.AUTHORIZED_TABS).forEach(tabName => {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < CONFIG.HEADER_ROW) return;

    const headerRowVals = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
    const colMap = mapHeaders(headerRowVals);

    let idColIdx = colMap["id_registro"];
    if (idColIdx === undefined || idColIdx === null) {
      idColIdx = lastCol;
      sheet.getRange(CONFIG.HEADER_ROW, idColIdx + 1).setValue("ID_REGISTRO");
    }

    const dataRange = sheet.getRange(CONFIG.HEADER_ROW + 1, 1, lastRow - CONFIG.HEADER_ROW, lastCol).getValues();

    for (let r = 0; r < dataRange.length; r++) {
      const rowVals = dataRange[r];
      const dataRaw = colMap["data"] !== undefined ? rowVals[colMap["data"]] : null;
      const dateObj = parseGoogleSheetDate(dataRaw);

      if (!dateObj) continue;
      const dateStr = formatDateISO(dateObj);
      if (dateStr < CONFIG.CUTOFF_DATE) continue;

      let recordId = idColIdx < rowVals.length ? String(rowVals[idColIdx]).trim() : "";
      if (!recordId || recordId === "undefined" || recordId.length < 10) {
        recordId = Utilities.getUuid();
        sheet.getRange(CONFIG.HEADER_ROW + 1 + r, idColIdx + 1).setValue(recordId);
        totalGerados++;
      }
    }
  });

  Logger.log("Total de novos IDs gerados: " + totalGerados);
}

/**
 * 5. FUNÇÃO AUXILIAR — CONFIGURAR MODELO DE CABEÇALHO NA PLANILHA
 */
function configurarModelo() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  Object.keys(CONFIG.AUTHORIZED_TABS).forEach(tabName => {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) return;

    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;

    const headerRowVals = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
    const colMap = mapHeaders(headerRowVals);

    if (colMap["id_registro"] === undefined) {
      sheet.getRange(CONFIG.HEADER_ROW, lastCol + 1).setValue("ID_REGISTRO");
      Logger.log("Coluna ID_REGISTRO adicionada na aba: " + tabName);
    }
  });
}

/**
 * EXTRATOR E SANITIZADOR DE DADOS DA PLANILHA (SEM PII)
 */
function lerDadosSanitizados() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const rows = [];

  Object.keys(CONFIG.AUTHORIZED_TABS).forEach(tabName => {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) return;

    const defaultVendedor = CONFIG.AUTHORIZED_TABS[tabName];
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < CONFIG.HEADER_ROW) return;

    const dataRange = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headerRowVals = dataRange[CONFIG.HEADER_ROW - 1];
    const colMap = mapHeaders(headerRowVals);

    let idColIdx = colMap["id_registro"];
    if (idColIdx === undefined || idColIdx === null) {
      idColIdx = lastCol;
      sheet.getRange(CONFIG.HEADER_ROW, idColIdx + 1).setValue("ID_REGISTRO");
      colMap["id_registro"] = idColIdx;
    }

    for (let r = CONFIG.HEADER_ROW; r < lastRow; r++) {
      const rowVals = dataRange[r];
      const dataRaw = colMap["data"] !== undefined ? rowVals[colMap["data"]] : null;

      // Validar data da coluna B
      const dateObj = parseGoogleSheetDate(dataRaw);
      if (!dateObj) continue;

      const dateStr = formatDateISO(dateObj);
      if (dateStr < CONFIG.CUTOFF_DATE) continue; // Filtro de corte >= 01/07/2026

      // ID_REGISTRO estável
      let recordId = idColIdx < rowVals.length ? String(rowVals[idColIdx]).trim() : "";
      if (!recordId || recordId === "undefined" || recordId.length < 10) {
        recordId = Utilities.getUuid();
        sheet.getRange(r + 1, idColIdx + 1).setValue(recordId);
      }

      // Extração de campos sanitizados (SEM PII)
      const qtdVal          = getVal(rowVals, colMap["qtd"]);
      const vendedorVal     = getVal(rowVals, colMap["vendedor"]) || defaultVendedor;
      const qtdFuncVal      = parseFunc(getVal(rowVals, colMap["qtd_func"]));
      const fonteLeadVal    = getVal(rowVals, colMap["fonte_lead"]); // Preserva grafia original exata
      const dataEnvioVal    = parseDateString(getVal(rowVals, colMap["data_envio"]));
      const dataFechVal     = parseDateString(getVal(rowVals, colMap["data_fechamento"]));
      const valorMensalVal  = parseValorMensal(getVal(rowVals, colMap["valor_mensal"]));
      const parcelasVal     = parseFunc(getVal(rowVals, colMap["parcelas"]));
      const valorTotalVal   = parseValorTotal(getVal(rowVals, colMap["valor_total"]));
      const statusVal       = getVal(rowVals, colMap["status"]);
      const tipoContratoVal = getVal(rowVals, colMap["tipo_contrato"]);
      const tipoBaseVal     = getVal(rowVals, colMap["tipo_base"]);
      const situacaoVal     = getVal(rowVals, colMap["situacao_contrato"]);
      const numeroOsVal     = getVal(rowVals, colMap["numero_os"]);

      // Ignorar linhas sem conteúdo comercial (apenas QTD ou vendedor pré-preenchido)
      if (!tipoContratoVal && !statusVal && valorTotalVal === null && valorMensalVal === null) {
        continue;
      }

      const rowHash = computeRowHash([
        dateStr, recordId, vendedorVal, qtdFuncVal, fonteLeadVal,
        valorMensalVal, valorTotalVal, statusVal, tipoContratoVal
      ]);

      rows.push({
        source_type: "GOOGLE_SHEETS_LIVE",
        spreadsheet_id: CONFIG.SPREADSHEET_ID,
        source_sheet: tabName,
        source_record_id: recordId,
        qtd_original: qtdVal,
        data_referencia: dateStr,
        mes_referencia: dateObj.getMonth() + 1,
        ano_referencia: dateObj.getFullYear(),
        vendedor: vendedorVal,
        quantidade_funcionarios: qtdFuncVal,
        fonte_lead: fonteLeadVal,
        data_envio_orcamento: dataEnvioVal,
        data_fechamento: dataFechVal,
        valor_mensal: valorMensalVal,
        quantidade_parcelas: parcelasVal,
        valor_total: valorTotalVal,
        status: statusVal,
        tipo_contrato: tipoContratoVal,
        tipo_base: tipoBaseVal,
        situacao_contrato: situacaoVal,
        numero_os: numeroOsVal,
        row_hash: rowHash
      });
    }
  });

  return { rows: rows };
}

/**
 * MAPEAMENTO DINÂMICO DE CABEÇALHOS PELO TEXTO (CASE-INSENSITIVE)
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
    else if (str.indexOf("ENVIO") !== -1 && map["data_envio"] === undefined) map["data_envio"] = idx;
    else if (str.indexOf("FECHAMENTO") !== -1 && map["data_fechamento"] === undefined) map["data_fechamento"] = idx;
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

function parseDateString(raw) {
  if (!raw) return null;
  const dt = parseGoogleSheetDate(raw);
  return dt ? formatDateISO(dt) : null;
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + "-" + m + "-" + d;
}

function parseValorMensal(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (s.indexOf("À VISTA") !== -1 || s.indexOf("A VISTA") !== -1) return 0.0;
  if (s.indexOf("#DIV/0!") !== -1 || s.indexOf("#VALUE!") !== -1 || s === "X") return null;

  const num = parseFloat(s.replace("R$", "").replace(/\./g, "").replace(",", "."));
  return isNaN(num) ? null : num;
}

function parseValorTotal(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (s.indexOf("#DIV/0!") !== -1 || s.indexOf("#VALUE!") !== -1 || s === "X" || s === "À DEFINIR" || s === "A DEFINIR") return null;

  const num = parseFloat(s.replace("R$", "").replace(/\./g, "").replace(",", "."));
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
  const text = arr.map(v => (v === null || v === undefined ? "" : String(v))).join("|");
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text);
  return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}
