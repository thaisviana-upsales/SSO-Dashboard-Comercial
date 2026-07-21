"""
curva_abc.py
============
Classificação de porte de cliente (Curva ABC) e agregação de indicadores.
Módulo standalone — pode ser importado pelo importador e testado independentemente.

Autor: Antigravity / Google DeepMind
Data:  2026-07-21
"""

from typing import Any, Optional, List, Dict
from collections import defaultdict

# ── Ordem canônica das classificações ──────────────────────────────────
CURVAS_ORDENADAS = ['A+', 'A', 'B', 'C', 'D', 'Sem classificação']

# ── Intervalos (para documentação e testes) ────────────────────────────
LIMITES = {
    'A+': (120, None),
    'A':  (80,  119),
    'B':  (50,  79),
    'C':  (11,  49),
    'D':  (0,   10),
}

# ---------------------------------------------------------------------------
# CONVERSÃO
# ---------------------------------------------------------------------------

def converter_qtd_funcionarios(raw: Any) -> Optional[int]:
    """
    Converte a quantidade de funcionários para int ou None.

    Aceita: inteiros, floats (arredondados), strings numéricas.
    Retorna None para: None, '', 'X', textos, erros, valores negativos.
    NUNCA substitui inválido por zero.
    """
    if raw is None:
        return None

    # Numérico direto do Excel
    if isinstance(raw, (int, float)):
        if isinstance(raw, float) and raw != raw:   # NaN check
            return None
        v = int(raw)
        return None if v < 0 else v

    # String
    s = str(raw).strip()
    if not s:
        return None

    INVALIDOS = {'X', 'ERRO', '#VALUE!', '#REF!', '#N/A', '#NAME?',
                 '#DIV/0!', '#NULL!', 'NULL', 'NONE', 'N/A', '-'}
    if s.upper() in INVALIDOS:
        return None

    try:
        v = int(float(s))
        return None if v < 0 else v
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# CLASSIFICAÇÃO (CASE exato conforme especificação)
# ---------------------------------------------------------------------------

def classificar_curva(qtd: Optional[int]) -> str:
    """
    Classifica o porte do cliente conforme Curva ABC.

    CASE
      WHEN quantidade_funcionarios IS NULL       THEN 'Sem classificação'
      WHEN quantidade_funcionarios < 0           THEN 'Sem classificação'
      WHEN quantidade_funcionarios >= 120        THEN 'A+'
      WHEN quantidade_funcionarios BETWEEN 80 AND 119  THEN 'A'
      WHEN quantidade_funcionarios BETWEEN 50 AND 79   THEN 'B'
      WHEN quantidade_funcionarios BETWEEN 11 AND 49   THEN 'C'
      WHEN quantidade_funcionarios BETWEEN 0  AND 10   THEN 'D'
      ELSE 'Sem classificação'
    END
    """
    if qtd is None:
        return 'Sem classificação'
    if qtd < 0:
        return 'Sem classificação'
    if qtd >= 120:
        return 'A+'
    if 80 <= qtd <= 119:
        return 'A'
    if 50 <= qtd <= 79:
        return 'B'
    if 11 <= qtd <= 49:
        return 'C'
    if 0 <= qtd <= 10:
        return 'D'
    return 'Sem classificação'


# ---------------------------------------------------------------------------
# AGREGAÇÃO POR CURVA
# ---------------------------------------------------------------------------

def _norm_status(s: Any) -> str:
    return (s or '').strip().upper()


def _tem_contrato(r: Dict) -> bool:
    tc = r.get('tipo_contrato')
    return bool(tc and str(tc).strip())


def _valor_ok(r: Dict) -> bool:
    return (r.get('valor_total') is not None
            and not r.get('flag_valor_invalido', False))


def agregar_por_curva(records: List[Dict]) -> List[Dict]:
    """
    Agrega os indicadores por classificação Curva ABC.

    Indicadores calculados por curva:
      - registros           : total de registros
      - propostas           : COUNT onde tipo_contrato preenchido
      - vendas              : COUNT onde status = CONTRATO FECHADO
      - conversao           : vendas / propostas * 100
      - fat_vendas          : SUM(valor_total) onde CONTRATO FECHADO + valor válido
      - ticket_medio        : fat_vendas / vendas_com_valor
      - prev_faturamento    : SUM(valor_total) onde proposta + valor válido
    """
    grupos: Dict[str, List[Dict]] = defaultdict(list)
    for r in records:
        grupos[r.get('curva_abc_cliente', 'Sem classificação')].append(r)

    resultado = []
    for curva in CURVAS_ORDENADAS:
        regs = grupos.get(curva, [])

        propostas       = sum(1 for r in regs if _tem_contrato(r))
        vendas          = sum(1 for r in regs if _norm_status(r.get('status')) == 'CONTRATO FECHADO')
        fat_vendas      = sum(r['valor_total'] for r in regs
                              if _norm_status(r.get('status')) == 'CONTRATO FECHADO' and _valor_ok(r))
        prev_fat        = sum(r['valor_total'] for r in regs
                              if _tem_contrato(r) and _valor_ok(r))
        vendas_c_valor  = sum(1 for r in regs
                              if _norm_status(r.get('status')) == 'CONTRATO FECHADO' and _valor_ok(r))
        ticket_medio    = (fat_vendas / vendas_c_valor) if vendas_c_valor > 0 else None
        conversao       = (vendas / propostas * 100) if propostas > 0 else 0.0

        resultado.append({
            'curva':           curva,
            'registros':       len(regs),
            'propostas':       propostas,
            'vendas':          vendas,
            'conversao':       round(conversao, 4),
            'fat_vendas':      round(fat_vendas, 2),
            'ticket_medio':    round(ticket_medio, 2) if ticket_medio is not None else None,
            'prev_faturamento': round(prev_fat, 2),
        })

    return resultado


def resumo_curva_texto(resultado: List[Dict]) -> str:
    """Formata a tabela de resumo por curva em texto legível."""
    lines = [
        f"{'Curva':<20} {'Registros':>10} {'Propostas':>10} {'Vendas':>8} "
        f"{'Conversão':>10} {'Fat.Vendas':>16} {'Ticket Médio':>14} {'Prev.Fat.':>16}",
        "-" * 110,
    ]
    for r in resultado:
        tm = f"R$ {r['ticket_medio']:>10,.2f}" if r['ticket_medio'] is not None else "         N/A"
        lines.append(
            f"{r['curva']:<20} {r['registros']:>10,} {r['propostas']:>10,} {r['vendas']:>8,} "
            f"{r['conversao']:>9.2f}% R$ {r['fat_vendas']:>13,.2f} {tm} R$ {r['prev_faturamento']:>13,.2f}"
        )
    return "\n".join(lines)
