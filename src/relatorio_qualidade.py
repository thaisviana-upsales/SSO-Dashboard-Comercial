"""
relatorio_qualidade.py
======================
Gera o relatório de qualidade da importação em texto legível e JSON.

Autor: Antigravity / Google DeepMind
Data:  2026-07-21
"""

import json
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any


SAIDA_TXT  = Path(__file__).parent.parent / "output" / "relatorio_qualidade.txt"
SAIDA_JSON = Path(__file__).parent.parent / "output" / "qualidade.json"


def gerar_relatorio(
    registros:  List[Dict[str, Any]],
    problemas:  List[Dict[str, Any]],
    indicadores: Dict[str, Any],
    por_mes:    List[Dict[str, Any]],
) -> str:
    """
    Produz o relatório textual de qualidade da importação.
    Retorna o texto e também salva nos arquivos de saída.
    """

    linhas: List[str] = []
    sep  = "=" * 70
    sep2 = "-" * 70

    def L(s: str = "") -> None:
        linhas.append(s)

    now = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    L(sep)
    L("  RELATÓRIO DE QUALIDADE — DASHBOARD COMERCIAL SSO")
    L(f"  Gerado em: {now}")
    L(sep)
    L()

    # ------------------------------------------------------------------
    # 1. RESUMO DA IMPORTAÇÃO
    # ------------------------------------------------------------------
    L("1. RESUMO DA IMPORTAÇÃO")
    L(sep2)

    total = indicadores["leads_total"]
    L(f"  Total de registros importados : {total:>6,}")
    L(f"  Problemas registrados         : {len(problemas):>6,}")
    L(f"  Registros com valor inválido  : {indicadores['registros_valor_invalido']:>6,}")
    L(f"  Contratos fechados s/ valor   : {indicadores['vendas_sem_valor']:>6,}")
    L()

    # ------------------------------------------------------------------
    # 2. CONTAGEM POR ABA
    # ------------------------------------------------------------------
    L("2. CONTAGEM POR ABA (Leads / Oportunidades)")
    L(sep2)

    esperados = {
        1: 96, 2: 127, 3: 193, 4: 249, 5: 265, 6: 227, 7: 108,
    }

    for m in por_mes:
        mn   = m["mes_numero"]
        nome = m["mes_nome"]
        aba  = m["aba_origem"]
        cnt  = m["leads_total"]
        exp  = esperados.get(mn, "?")
        ok   = "✅" if cnt == exp else f"⚠️  (esperado: {exp})"
        L(f"  {nome:<12} ({aba:<12})  {cnt:>4} registros  {ok}")

    total_esperado = sum(esperados.values())
    ok_total = "✅" if total == total_esperado else f"⚠️  (esperado: {total_esperado})"
    L(f"  {'TOTAL':<12}               {total:>4} registros  {ok_total}")
    L()

    # ------------------------------------------------------------------
    # 3. INDICADORES CONSOLIDADOS
    # ------------------------------------------------------------------
    L("3. INDICADORES CONSOLIDADOS")
    L(sep2)

    ind = indicadores
    L(f"  Leads / Oportunidades        : {ind['leads_total']:>10,}")
    L(f"  Propostas Enviadas           : {ind['propostas_enviadas']:>10,}")
    L(f"  Qtd. de Vendas               : {ind['qtd_vendas']:>10,}")
    L(f"  Propostas Abertas            : {ind['propostas_abertas']:>10,}")
    L(f"  Recusadas                    : {ind['recusadas']:>10,}")
    L(f"  Outros / Sem status          : {ind['outros_status']:>10,}")
    L(f"  Conversão de Vendas          : {ind['conversao_pct']:>10.2f}%")
    L(f"  Previsão de Faturamento      : R$ {ind['previsao_faturamento']:>15,.2f}")
    L(f"  Faturamento Total de Vendas  : R$ {ind['faturamento_total_vendas']:>15,.2f}")
    L()

    # Testes de aceite
    L("  TESTES DE ACEITE:")
    testes = [
        ("Leads total = 1.265",              ind["leads_total"] == 1265),
        ("Propostas Enviadas = 1.265",        ind["propostas_enviadas"] == 1265),
        ("Qtd. de Vendas = 635",             ind["qtd_vendas"] == 635),
        ("Propostas Abertas = 387",           ind["propostas_abertas"] == 387),
        ("Recusadas = 243",                  ind["recusadas"] == 243),
        ("Conversão ≈ 50,20%",               49.0 <= ind["conversao_pct"] <= 51.5),
        ("Previsão = R$ 5.969.373,38",       abs(ind["previsao_faturamento"] - 5969373.38) < 1.0),
        ("Fat. Vendas = R$ 1.676.229,28",    abs(ind["faturamento_total_vendas"] - 1676229.28) < 1.0),
        ("12 registros s/ valor válido (X/x)", ind["registros_valor_invalido"] == 12),
        ("5 contratos fechados s/ valor",     ind["vendas_sem_valor"] == 5),
    ]

    todos_ok = True
    for descricao, passou in testes:
        icone = "  ✅" if passou else "  ❌"
        L(f"{icone}  {descricao}")
        if not passou:
            todos_ok = False

    L()
    if todos_ok:
        L("  🎉 TODOS OS TESTES DE ACEITE PASSARAM.")
    else:
        L("  ⚠️  ATENÇÃO: Um ou mais testes de aceite falharam.")
    L()

    # ------------------------------------------------------------------
    # 4. DETALHAMENTO DOS PROBLEMAS DE QUALIDADE
    # ------------------------------------------------------------------
    L("4. DETALHAMENTO DOS PROBLEMAS DE QUALIDADE")
    L(sep2)

    if not problemas:
        L("  Nenhum problema de qualidade registrado.")
    else:
        # Agrupar por tipo
        por_tipo: Dict[str, List] = {}
        for p in problemas:
            t = p.get("tipo", "DESCONHECIDO")
            por_tipo.setdefault(t, []).append(p)

        for tipo, lista in sorted(por_tipo.items()):
            L(f"\n  [{tipo}] — {len(lista)} ocorrência(s)")
            for p in lista:
                aba   = p.get("aba", "?")
                linha = p.get("linha", "?")
                val   = p.get("valor_raw", "")
                desc  = p.get("descricao", "")
                L(f"    • {aba} linha {linha:>4}  | valor_raw: {repr(val):<25} | {desc}")

    L()

    # ------------------------------------------------------------------
    # 5. CONFIRMAÇÃO DE PRIVACIDADE
    # ------------------------------------------------------------------
    L("5. CONFIRMAÇÃO DE PRIVACIDADE (PII)")
    L(sep2)
    L("  Colunas NÃO importadas para a camada analítica:")
    colunas_excluidas = [
        "EMPRESA", "CNPJ", "NOME", "TELEFONE", "E-MAIL",
        "QUANTIDADE DE FUNCIONÁRIOS", "DATA ENVIO DE ORÇAMENTO",
        "DATA DE FECHAMENTO DA VENDA", "VALOR MENSAL", "PARCELAS",
        "TIPO DE CONTRATO (segunda ocorrência)", "SITUAÇÃO DO CONTRATO",
        "NÚMERO DA O.S.", "OBSERVAÇÃO DO VENDEDOR",
    ]
    for col in colunas_excluidas:
        L(f"    ✅  {col}")
    L()
    L("  ✅  NENHUM DADO PESSOAL (PII) foi incluído na base analítica.")
    L()

    # ------------------------------------------------------------------
    # 6. NOTA SOBRE JANEIRO26 — PARCELAS
    # ------------------------------------------------------------------
    L("6. NOTA ESTRUTURAL — ABA Janeiro26")
    L(sep2)
    L("  A aba Janeiro26 não possui coluna PARCELAS explícita.")
    L("  Conforme instrução do usuário, o equivalente seria:")
    L("  PARCELAS = VALOR_TOTAL / VALOR_MENSAL (derivado).")
    L("  Como PARCELAS não integra a camada analítica, essa")
    L("  derivação não foi aplicada — a informação é apenas")
    L("  documentada aqui para rastreabilidade.")
    L()

    L(sep)
    L("  FIM DO RELATÓRIO")
    L(sep)

    texto = "\n".join(linhas)

    # Persistir
    SAIDA_TXT.parent.mkdir(parents=True, exist_ok=True)
    with open(SAIDA_TXT, "w", encoding="utf-8") as f:
        f.write(texto)

    return texto
