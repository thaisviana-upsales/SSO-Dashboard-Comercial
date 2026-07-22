"""
sync_sheets.py
==============
Serviço de Sincronização Google Sheets Live — Projeto SSO (Etapa 2)

Planilha ID: 1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE
Abas autorizadas:
  - VINICIUS.26 (Default: VINICIUS)
  - GUSTAVO.26  (Default: GUSTAVO)
  - LUCAS.26    (Default: LUCAS)
  - VITORIA.26  (Default: VITÓRIA)
  - MIKAELI     (Default: MIKAELLE)
  - CAILLANE.26 (Default: CAILLANE)
  - AMANDA.26   (Default: AMANDA)
  - JESSICA.26  (Default: JESSICA)

Regras de Negócio:
  - Cabeçalho na linha 4.
  - Data de referência obrigatoriamente >= 2026-07-01 (coluna B).
  - ID_REGISTRO estável por linha.
  - Upsert baseado em source_type + spreadsheet_id + source_record_id.
  - Comparação por row_hash.
  - Preservação exata do texto de Fonte do Lead (sem unificações).
  - VINICIOS e VINICIUS preservados como vendedores distintos.
"""

import re
import json
import uuid
import hashlib
import urllib.request
import urllib.parse
import csv
from datetime import datetime, date
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

SPREADSHEET_ID = "1UH4LP1f4jPpxizwo5HzCZM8PHKdOCSo2tbs2kwD12DE"
CUTOFF_DATE = "2026-07-01"
LINHA_HEADER = 4

VENDEDORES_DEFAULT = {
    "VINICIUS.26": "VINICIUS",
    "GUSTAVO.26":  "GUSTAVO",
    "LUCAS.26":    "LUCAS",
    "VITORIA.26":  "VITÓRIA",
    "MIKAELI":     "MIKAELLE",
    "CAILLANE.26": "CAILLANE",
    "AMANDA.26":   "AMANDA",
    "JESSICA.26":  "JESSICA"
}


def classificar_curva_abc_v2(qtd_func: Optional[int]) -> str:
    """
    Classificação Curva ABC (Regras atualizadas Etapa 2):
      - A+: 120 ou mais
      - A:  80 a 119
      - B:  50 a 79
      - C:  11 a 49
      - D:  0 a 10
      - Sem classificação: vazio / None / inválido
    """
    if qtd_func is None:
        return "Sem classificação"
    if qtd_func >= 120:
        return "A+"
    if qtd_func >= 80:
        return "A"
    if qtd_func >= 50:
        return "B"
    if qtd_func >= 11:
        return "C"
    if qtd_func >= 0:
        return "D"
    return "Sem classificação"


def converter_valor_mensal(val_raw: Any) -> Optional[float]:
    """
    Trata Valor Mensal:
      - "À vista" / "A vista" -> 0.00
      - Vazio / None / #DIV/0! -> None
    """
    if val_raw is None:
        return None
    s = str(val_raw).strip().upper()
    if not s or s in {"NONE", ""}:
        return None
    if "À VISTA" in s or "A VISTA" in s:
        return 0.0
    if "#DIV/0!" in s or "#VALUE!" in s or "X" in s:
        return None

    # Tentar converter número br
    s_clean = s.replace("R$", "").strip().replace(".", "").replace(",", ".")
    try:
        return float(s_clean)
    except ValueError:
        return None


def converter_valor_total(val_raw: Any) -> Optional[float]:
    """Trata Valor Total (não transforma erros em zero)."""
    if val_raw is None:
        return None
    s = str(val_raw).strip().upper()
    if not s or s in {"NONE", "", "X", "À DEFINIR", "A DEFINIR", "#DIV/0!", "#VALUE!"}:
        return None
    s_clean = s.replace("R$", "").strip().replace(".", "").replace(",", ".")
    try:
        return float(s_clean)
    except ValueError:
        return None


def calcular_row_hash(registro: Dict[str, Any]) -> str:
    """Calcula MD5 dos campos de conteúdo do registro."""
    campos = [
        str(registro.get("data_referencia") or ""),
        str(registro.get("vendedor") or ""),
        str(registro.get("quantidade_funcionarios") or ""),
        str(registro.get("fonte_lead") or ""),
        str(registro.get("valor_mensal") or ""),
        str(registro.get("valor_total") or ""),
        str(registro.get("status") or ""),
        str(registro.get("tipo_contrato") or ""),
    ]
    raw_str = "|".join(campos)
    return hashlib.md5(raw_str.encode("utf-8")).hexdigest()


def processar_linhas_aba(
    aba_nome: str,
    linhas_raw: List[List[Any]],
    vendedor_default: str
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Processa as linhas brutas de uma aba a partir da linha 4.
    Retorna (registros_validos, problemas_qualidade).
    """
    if len(linhas_raw) < LINHA_HEADER:
        return [], []

    header = [str(cell).strip().upper() if cell is not None else "" for cell in linhas_raw[LINHA_HEADER - 1]]

    # Mapear índices dos cabeçalhos
    idx_map = {}
    for i, h in enumerate(header):
        if h == "QTD" and "qtd" not in idx_map: idx_map["qtd"] = i
        elif h == "DATA" and "data" not in idx_map: idx_map["data"] = i
        elif ("FUNCIONARIO" in h or "FUNCIONÁRIO" in h) and "qtd_func" not in idx_map: idx_map["qtd_func"] = i
        elif "FONTE" in h and "fonte_lead" not in idx_map: idx_map["fonte_lead"] = i
        elif h == "VENDEDOR" and "vendedor" not in idx_map: idx_map["vendedor"] = i
        elif "VALOR MENSAL" in h and "valor_mensal" not in idx_map: idx_map["valor_mensal"] = i
        elif "VALOR TOTAL" in h and "valor_total" not in idx_map: idx_map["valor_total"] = i
        elif h == "STATUS" and "status" not in idx_map: idx_map["status"] = i
        elif "TIPO DE CONTRATO" in h and "tipo_contrato" not in idx_map: idx_map["tipo_contrato"] = i
        elif "TIPO DE BASE" in h and "tipo_base" not in idx_map: idx_map["tipo_base"] = i
        elif "SITUAÇ" in h and "situacao_contrato" not in idx_map: idx_map["situacao_contrato"] = i
        elif ("NUMERO O.S" in h or "NÚMERO O.S" in h) and "numero_os" not in idx_map: idx_map["numero_os"] = i
        elif "PARCELAS" in h and "parcelas" not in idx_map: idx_map["parcelas"] = i
        elif h == "ID_REGISTRO" and "id_registro" not in idx_map: idx_map["id_registro"] = i

    registros = []
    problemas = []

    for line_num, row in enumerate(linhas_raw[LINHA_HEADER:], start=LINHA_HEADER + 1):
        def _g(key):
            idx = idx_map.get(key)
            if idx is None or idx >= len(row): return None
            val = row[idx]
            return str(val).strip() if val is not None and str(val).strip() != "" else None

        data_raw = _g("data")
        if not data_raw:
            continue # Sem DATA -> Ignora

        # Validar data
        data_ref = None
        m_iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", data_raw)
        m_br  = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", data_raw)
        if m_iso:
            data_ref = f"{m_iso.group(1)}-{m_iso.group(2)}-{m_iso.group(3)}"
        elif m_br:
            data_ref = f"{int(m_br.group(3)):04d}-{int(m_br.group(2)):02d}-{int(m_br.group(1)):02d}"

        if not data_ref or data_ref < CUTOFF_DATE:
            continue # Data invalida ou anterior a 01/07/2026 -> Ignora

        dt_obj = datetime.strptime(data_ref, "%Y-%m-%d").date()

        # ID_REGISTRO estavel
        record_id = _g("id_registro")
        if not record_id or len(record_id) < 10:
            # Gerar UUID determinístico se não existir para testes locais reproduzíveis
            seed_str = f"{aba_nome}:{line_num}:{data_ref}"
            record_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, seed_str))

        vendedor_final = _g("vendedor") or vendedor_default
        fonte_lead_final = _g("fonte_lead") # Preserva original exato

        qtd_func_str = _g("qtd_func")
        qtd_func = None
        if qtd_func_str:
            digits = re.sub(r"\D", "", qtd_func_str)
            if digits:
                qtd_func = int(digits)

        curva_abc = classificar_curva_abc_v2(qtd_func)

        v_mensal = converter_valor_mensal(_g("valor_mensal"))
        v_total  = converter_valor_total(_g("valor_total"))
        status_armazenado = _g("status")

        rec = {
            "id_registro":            record_id,
            "source_type":            "GOOGLE_SHEETS_LIVE",
            "spreadsheet_id":         SPREADSHEET_ID,
            "source_sheet":           aba_nome,
            "source_record_id":       record_id,
            "data_referencia":        data_ref,
            "mes_referencia":         dt_obj.month,
            "ano_referencia":         dt_obj.year,
            "mes_numero":             dt_obj.month,
            "mes_nome":               ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"][dt_obj.month - 1],
            "ano":                    dt_obj.year,
            "aba_origem":             aba_nome,
            "linha_origem":           line_num,
            "qtd_original":           _g("qtd"),
            "vendedor":               vendedor_final,
            "quantidade_funcionarios":qtd_func,
            "quantidade_funcionarios_original": qtd_func_str,
            "curva_abc_cliente":      curva_abc,
            "fonte_lead":             fonte_lead_final,
            "valor_mensal":           v_mensal,
            "valor_total":            v_total,
            "status":                 status_armazenado,
            "tipo_contrato":          _g("tipo_contrato"),
            "tipo_base":              _g("tipo_base"),
            "situacao_contrato":      _g("situacao_contrato"),
            "numero_os":              _g("numero_os"),
            "is_active":              True,
            "created_at":             datetime.now().isoformat(),
            "updated_at":             datetime.now().isoformat(),
            "synced_at":              datetime.now().isoformat(),
        }
        rec["row_hash"] = calcular_row_hash(rec)
        registros.append(rec)

    return registros, problemas
