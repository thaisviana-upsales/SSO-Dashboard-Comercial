"""
agregador.py
============
Serviço de Agregação — Dashboard Comercial Executivo SSO
Etapa 1: Camada de dados

Calcula todos os indicadores do dashboard a partir da base analítica
normalizada produzida pelo importador.py.

REGRAS DOS INDICADORES (conforme especificação):
  - Leads/Oportunidades   : COUNT de linhas comerciais válidas
  - Propostas Enviadas    : COUNT de registros com tipo_contrato preenchido
  - Previsão Faturamento  : SUM(valor_total) onde tipo_contrato preenchido
                            e valor numérico válido
  - Qtd. de Vendas        : COUNT onde status normalizado == 'CONTRATO FECHADO'
  - Faturamento de Vendas : SUM(valor_total) onde status == 'CONTRATO FECHADO'
  - Conversão de Vendas   : Qtd_Vendas / Propostas_Enviadas × 100
  - Propostas Abertas     : COUNT onde status normalizado == 'PROPOSTA ENVIADA'
  - Recusadas             : COUNT onde status normalizado == 'RECUSADO'

IMPORTANTE:
  - Nunca usar SUM(qtd_original)
  - Registros com flag_valor_invalido=True permanecem na contagem de
    propostas e vendas, mas NÃO entram nas somas financeiras
  - Conversão = Vendas ÷ Propostas (nunca Propostas ÷ Vendas)

Autor: Antigravity / Google DeepMind
Data:  2026-07-21
"""

from typing import List, Dict, Any, Optional
from collections import defaultdict


# ---------------------------------------------------------------------------
# CONSTANTES DE NEGÓCIO
# ---------------------------------------------------------------------------

STATUS_CONTRATO_FECHADO = "CONTRATO FECHADO"
STATUS_PROPOSTA_ENVIADA = "PROPOSTA ENVIADA"
STATUS_RECUSADO         = "RECUSADO"


def _norm_status(s: Optional[str]) -> str:
    """Normaliza status para comparação: strip + upper."""
    if s is None:
        return ""
    return s.strip().upper()


def _tem_contrato(r: Dict[str, Any]) -> bool:
    """True se tipo_contrato estiver preenchido."""
    tc = r.get("tipo_contrato")
    return bool(tc and str(tc).strip())


def _valor_valido(r: Dict[str, Any]) -> bool:
    """True se valor_total for numérico e flag_valor_invalido=False."""
    return (
        r.get("valor_total") is not None
        and not r.get("flag_valor_invalido", False)
    )


# ---------------------------------------------------------------------------
# INDICADORES GLOBAIS
# ---------------------------------------------------------------------------

def calcular_indicadores(registros: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Recebe a lista completa de registros normalizados e retorna
    um dicionário com todos os indicadores do dashboard.
    """
    leads              = len(registros)
    propostas_enviadas = 0
    qtd_vendas         = 0
    propostas_abertas  = 0
    recusadas          = 0
    outros_status      = 0
    faturamento_prev   = 0.0   # Previsão: propostas com contrato + valor válido
    faturamento_vendas = 0.0   # Fechados com valor válido
    valor_invalido_total    = 0
    vendas_sem_valor        = 0

    for r in registros:
        status_norm = _norm_status(r.get("status"))

        # Propostas Enviadas: tipo_contrato preenchido
        if _tem_contrato(r):
            propostas_enviadas += 1

            # Previsão de Faturamento: propostas com valor válido
            if _valor_valido(r):
                faturamento_prev += r["valor_total"]

        # Contagens por status
        if status_norm == STATUS_CONTRATO_FECHADO:
            qtd_vendas += 1
            if _valor_valido(r):
                faturamento_vendas += r["valor_total"]
            else:
                vendas_sem_valor += 1

        elif status_norm == STATUS_PROPOSTA_ENVIADA:
            propostas_abertas += 1

        elif status_norm == STATUS_RECUSADO:
            recusadas += 1

        else:
            outros_status += 1

        # Flags de qualidade
        if r.get("flag_valor_invalido"):
            valor_invalido_total += 1

    # Conversão: Vendas ÷ Propostas × 100
    conversao = (
        (qtd_vendas / propostas_enviadas * 100)
        if propostas_enviadas > 0
        else 0.0
    )

    return {
        "leads_total":              leads,
        "propostas_enviadas":       propostas_enviadas,
        "qtd_vendas":               qtd_vendas,
        "propostas_abertas":        propostas_abertas,
        "recusadas":                recusadas,
        "outros_status":            outros_status,
        "conversao_pct":            round(conversao, 4),
        "previsao_faturamento":     round(faturamento_prev, 2),
        "faturamento_total_vendas": round(faturamento_vendas, 2),
        "registros_valor_invalido": valor_invalido_total,
        "vendas_sem_valor":         vendas_sem_valor,
    }


# ---------------------------------------------------------------------------
# INDICADORES POR MÊS
# ---------------------------------------------------------------------------

def calcular_por_mes(registros: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Agrega os indicadores mês a mês.
    Retorna lista ordenada por mes_numero.
    """
    grupos: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for r in registros:
        grupos[r["mes_numero"]].append(r)

    resultado = []
    for mes_num in sorted(grupos.keys()):
        regs = grupos[mes_num]
        ind  = calcular_indicadores(regs)
        ind["mes_numero"] = mes_num
        ind["mes_nome"]   = regs[0]["mes_nome"]
        ind["ano"]        = regs[0]["ano"]
        ind["aba_origem"] = regs[0]["aba_origem"]
        resultado.append(ind)

    return resultado


# ---------------------------------------------------------------------------
# INDICADORES POR VENDEDOR
# ---------------------------------------------------------------------------

def calcular_por_vendedor(registros: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Agrega por vendedor (preservando texto original — VINICIOS ≠ VINICIUS).
    """
    grupos: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in registros:
        nome = r.get("vendedor") or "(sem vendedor)"
        grupos[nome].append(r)

    resultado = []
    for vendedor, regs in sorted(grupos.items()):
        ind = calcular_indicadores(regs)
        ind["vendedor"] = vendedor
        resultado.append(ind)

    # Ordenar por qtd_vendas desc
    resultado.sort(key=lambda x: x["qtd_vendas"], reverse=True)
    return resultado


# ---------------------------------------------------------------------------
# INDICADORES POR FONTE DO LEAD
# ---------------------------------------------------------------------------

def calcular_por_fonte(registros: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Agrega por fonte_lead (preservando texto original — sem unificações).
    Ex: SSOMED/SITE ≠ SSOMED / SITE
    """
    grupos: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in registros:
        fonte = r.get("fonte_lead") or "(sem fonte)"
        grupos[fonte].append(r)

    resultado = []
    for fonte, regs in sorted(grupos.items()):
        ind = calcular_indicadores(regs)
        ind["fonte_lead"] = fonte
        resultado.append(ind)

    resultado.sort(key=lambda x: x["leads_total"], reverse=True)
    return resultado


# ---------------------------------------------------------------------------
# INDICADORES POR TIPO DE CONTRATO
# ---------------------------------------------------------------------------

def calcular_por_tipo_contrato(registros: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Agrega por tipo_contrato (preservando texto original — sem categorias artificiais).
    """
    grupos: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in registros:
        tipo = r.get("tipo_contrato") or "(sem contrato)"
        grupos[tipo].append(r)

    resultado = []
    for tipo, regs in sorted(grupos.items()):
        ind = calcular_indicadores(regs)
        ind["tipo_contrato"] = tipo
        resultado.append(ind)

    resultado.sort(key=lambda x: x["leads_total"], reverse=True)
    return resultado


# ---------------------------------------------------------------------------
# RESUMO EXECUTIVO COMPLETO
# ---------------------------------------------------------------------------

def gerar_resumo_completo(registros: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Retorna o resumo executivo completo com todas as dimensões de análise.
    """
    return {
        "consolidado":       calcular_indicadores(registros),
        "por_mes":           calcular_por_mes(registros),
        "por_vendedor":      calcular_por_vendedor(registros),
        "por_fonte":         calcular_por_fonte(registros),
        "por_tipo_contrato": calcular_por_tipo_contrato(registros),
    }
