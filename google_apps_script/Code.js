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
 *   - Coluna B = DATA é a única data oficial
 *   - Importar somente DATA entre 01/07/2026 e 31/12/2026 (inclusive)
 *   - Linhas com coluna B vazia → ignoradas
 *   - Linhas sem conteúdo comercial → ignoradas
 *   - Data 30/06/2027 (e qualquer data > 31/12/2026) → rejeitada e logada
 *   - Mapeamento dinâmico de cabeçalhos (não posições fixas)
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
      const dataRaw = colMap["data"] !== undefined ? rowVals[colMap["data"]] : null;
      const dateObj = parseGoogleSheetDate(dataRaw);
      if (!dateObj) continue;

      const dateStr = formatDateISO(dateObj);
      if (dateStr < CONFIG.DATE_MIN || dateStr > CONFIG.DATE_MAX) continue;

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
      aba     : tabName,
      lido    : 0,
      valido  : 0,
      ignorado: 0,
      motivos : []
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

    const dataRange    = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headerRowVals = dataRange[CONFIG.HEADER_ROW - 1];
    const colMap       = mapHeaders(headerRowVals);

    // Garantir coluna ID_REGISTRO na aba
    let idColIdx = colMap["id_registro"];
    if (idColIdx === undefined || idColIdx === null) {
      idColIdx = lastCol; // 0-based: próxima coluna (lastCol é 1-based, mas 0-based = lastCol)
      sheet.getRange(CONFIG.HEADER_ROW, idColIdx + 1).setValue("ID_REGISTRO");
      try { sheet.hideColumns(idColIdx + 1); } catch(_) {}
      colMap["id_registro"] = idColIdx;
    }

    for (let r = CONFIG.HEADER_ROW; r < lastRow; r++) {
      const rowVals = dataRange[r];
      entry.lido++;

      // ── Validar DATA na coluna B ──
      const dataRaw = colMap["data"] !== undefined ? rowVals[colMap["data"]] : null;
      if (!dataRaw || String(dataRaw).trim() === "") {
        entry.ignorado++;
        entry.motivos.push("Linha " + (r + 1) + ": coluna B vazia");
        continue;
      }

      const dateObj = parseGoogleSheetDate(dataRaw);
      if (!dateObj) {
        entry.ignorado++;
        entry.motivos.push("Linha " + (r + 1) + ": data inválida '" + String(dataRaw) + "'");
        continue;
      }

      const dateStr = formatDateISO(dateObj);

      // Rejeitar datas fora do intervalo [DATE_MIN, DATE_MAX]
      if (dateStr < CONFIG.DATE_MIN) {
        entry.ignorado++;
        // silencioso para datas históricas (esperado)
        continue;
      }
      if (dateStr > CONFIG.DATE_MAX) {
        entry.ignorado++;
        entry.motivos.push("Linha " + (r + 1) + ": data '" + dateStr
          + "' após " + CONFIG.DATE_MAX + " — PROBLEMA DE QUALIDADE");
        continue;
      }

      // ── ID_REGISTRO estável ──
      let recordId = (idColIdx < rowVals.length)
        ? String(rowVals[idColIdx]).trim() : "";
      if (!recordId || recordId === "undefined" || recordId === "null"
          || recordId.length < 10) {
        recordId = Utilities.getUuid();
        sheet.getRange(r + 1, idColIdx + 1).setValue(recordId);
      }

      // ── Extrair campos comerciais (SEM PII) ──
      const qtdVal          = getVal(rowVals, colMap["qtd"]);
      const vendedorVal     = getVal(rowVals, colMap["vendedor"]) || defaultVendedor;
      const qtdFuncVal      = parseFunc(getVal(rowVals, colMap["qtd_func"]));
      const fonteLeadVal    = getVal(rowVals, colMap["fonte_lead"]);
      const dataEnvioVal    = parseDateField(rowVals, colMap["data_envio"]);
      const dataFechVal     = parseDateField(rowVals, colMap["data_fechamento"]);
      const valorMensalVal  = parseValorMensal(getVal(rowVals, colMap["valor_mensal"]));
      const parcelasVal     = parseFunc(getVal(rowVals, colMap["parcelas"]));
      const valorTotalVal   = parseValorTotal(getVal(rowVals, colMap["valor_total"]));
      const statusVal       = getVal(rowVals, colMap["status"]);
      const tipoContratoVal = getVal(rowVals, colMap["tipo_contrato"]);
      const tipoBaseVal     = getVal(rowVals, colMap["tipo_base"]);
      const situacaoVal     = getVal(rowVals, colMap["situacao_contrato"]);
      const numeroOsVal     = getVal(rowVals, colMap["numero_os"]);

      // ── Ignorar linhas modelo (sem conteúdo comercial real) ──
      if (!tipoContratoVal && !statusVal
          && valorTotalVal === null && valorMensalVal === null && !fonteLeadVal) {
        entry.ignorado++;
        entry.motivos.push("Linha " + (r + 1) + ": linha de modelo sem conteúdo comercial");
        continue;
      }

      const rowHash = computeRowHash([
        dateStr, recordId, vendedorVal, qtdFuncVal, fonteLeadVal,
        valorMensalVal, valorTotalVal, statusVal, tipoContratoVal
      ]);

      rows.push({
        source_type          : "GOOGLE_SHEETS_LIVE",
        spreadsheet_id       : CONFIG.SPREADSHEET_ID,
        source_sheet         : tabName,
        source_record_id     : recordId,
        qtd_original         : qtdVal,
        data_referencia      : dateStr,
        mes_referencia       : dateObj.getMonth() + 1,
        ano_referencia       : dateObj.getFullYear(),
        vendedor             : vendedorVal,
        quantidade_funcionarios: qtdFuncVal,
        fonte_lead           : fonteLeadVal,
        data_envio_orcamento : dataEnvioVal,
        data_fechamento      : dataFechVal,
        valor_mensal         : valorMensalVal,
        quantidade_parcelas  : parcelasVal,
        valor_total          : valorTotalVal,
        status               : statusVal,
        tipo_contrato        : tipoContratoVal,
        tipo_base            : tipoBaseVal,
        situacao_contrato    : situacaoVal,
        numero_os            : numeroOsVal,
        row_hash             : rowHash
      });
      entry.valido++;
    }

    log.push(entry);
  });

  return { rows: rows, log: log };
}

/* ─── MAPEAMENTO DINÂMICO DE CABEÇALHOS ──────────────────────────────── */
/**
 * Localiza colunas pelos textos dos cabeçalhos (case-insensitive, normalizado).
 *
 * Regra para TIPO DE CONTRATO duplo (regra 11):
 *   - Coluna cujo valor de exemplo contém NOVO ou ANTIGO → tipo_base
 *   - Coluna cujo valor contém nomes de pacotes (SST, NR, LAUDOS, etc.) → tipo_contrato
 *
 * Como os cabeçalhos têm o mesmo texto, usamos a POSIÇÃO:
 *   - Primeira ocorrência de "TIPO DE CONTRATO" → tipo_contrato (pacote)
 *   - Segunda ocorrência de "TIPO DE CONTRATO" → tipo_base (novo/antigo)
 *
 * (Em algumas abas a segunda coluna TIPO DE CONTRATO é realmente tipo_base)
 */
function mapHeaders(headerRowVals) {
  const map    = {};
  let tipoContratoCount = 0;

  headerRowVals.forEach(function(val, idx) {
    if (val === null || val === undefined || val === "") return;
    const str = String(val).trim().toUpperCase()
      // Normalizar acentos para facilitar matching
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
        // Primeira ocorrência → tipo de pacote comercial
        map["tipo_contrato"] = idx;
      } else if (tipoContratoCount === 2 && map["tipo_base"] === undefined) {
        // Segunda ocorrência → NOVO / ANTIGO
        map["tipo_base"] = idx;
      }
    } else if (str.indexOf("TIPO DE BASE") !== -1 && map["tipo_base"] === undefined) {
      map["tipo_base"] = idx;
    } else if ((str.indexOf("BASE") !== -1 && str.indexOf("TIPO") !== -1)
               && map["tipo_base"] === undefined) {
      map["tipo_base"] = idx;
    } else if (str.indexOf("SITUAC") !== -1 && map["situacao_contrato"] === undefined) {
      map["situacao_contrato"] = idx;
    } else if ((str.indexOf("NUMERO O.S") !== -1 || str.indexOf("NUMERO O.S") !== -1
               || str.indexOf("N. O.S") !== -1 || str.indexOf("OS") === 0)
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
    // Objetos Date do Sheets vêm em UTC; ajustar para data local correta
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
  return null;
}

function parseDateField(rowVals, idx) {
  const raw = getVal(rowVals, idx);
  if (!raw) return null;
  // Tentar como objeto Date da célula original
  if (idx !== undefined && idx !== null && idx < rowVals.length) {
    const cellVal = rowVals[idx];
    const dt = parseGoogleSheetDate(cellVal);
    return dt ? formatDateISO(dt) : null;
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
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (s.indexOf("A VISTA") !== -1 || s.indexOf("À VISTA") !== -1) return 0.0;
  if (s.indexOf("#DIV") !== -1 || s.indexOf("#VALUE") !== -1
      || s === "X" || s === "-") return null;
  const num = parseFloat(s.replace(/R\$\s*/g, "").replace(/\./g, "").replace(",", "."));
  return isNaN(num) ? null : num;
}

function parseValorTotal(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (s.indexOf("#DIV") !== -1 || s.indexOf("#VALUE") !== -1
      || s === "X" || s === "À DEFINIR" || s === "A DEFINIR" || s === "-") return null;
  const num = parseFloat(s.replace(/R\$\s*/g, "").replace(/\./g, "").replace(",", "."));
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
