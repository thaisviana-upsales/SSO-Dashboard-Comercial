"""
pipeline.py
===========
Orquestrador principal da Etapa 1 — executa toda a cadeia:
  1. Importação do Excel
  2. Agregação dos indicadores
  3. Persistência da base analítica
  4. Geração do relatório de qualidade
  5. Exportação do resumo executivo JSON

Uso:
    python3 src/pipeline.py

Autor: Antigravity / Google DeepMind
Data:  2026-07-21
"""

import json
import sys
from pathlib import Path

# Garantir que src/ está no path
sys.path.insert(0, str(Path(__file__).parent))

from importador           import importar_excel, salvar_base, salvar_qualidade, ARQUIVO_EXCEL, SAIDA_JSON, LOG_QUALIDADE
from agregador            import gerar_resumo_completo, calcular_por_mes, calcular_indicadores
from relatorio_qualidade  import gerar_relatorio
from curva_abc            import agregar_por_curva, resumo_curva_texto

SAIDA_RESUMO = Path(__file__).parent.parent / "output" / "resumo_executivo.json"


def main() -> None:
    print("\n" + "=" * 60)
    print("  PIPELINE SSO — ETAPA 1: IMPORTAÇÃO E VALIDAÇÃO")
    print("=" * 60)

    # ------------------------------------------------------------------
    # 1. IMPORTAR
    # ------------------------------------------------------------------
    print("\n[1/4] Importando Excel...")
    registros, problemas = importar_excel(ARQUIVO_EXCEL)
    print(f"      → {len(registros)} registros | {len(problemas)} problemas")

    # ------------------------------------------------------------------
    # 2. PERSISTIR BASE FÍSICA E BASE CONSOLIDADA DA VIEW
    # ------------------------------------------------------------------
    print("\n[2/4] Aplicando regra de corte (view_dashboard_consolidado)...")
    base_fisica_json = Path(__file__).parent.parent / "output" / "base_registros_comerciais.json"
    salvar_base(registros, base_fisica_json)

    # Filtrar registros exibidos na view consolidada
    view_registros = [
        r for r in registros
        if r.get("is_active", True) and (
            (r.get("source_type") == "EXCEL_HISTORICO" and r.get("data_referencia", "") < "2026-07-01")
            or
            (r.get("source_type") == "GOOGLE_SHEETS_LIVE" and r.get("data_referencia", "") >= "2026-07-01")
        )
    ]

    salvar_base(view_registros, SAIDA_JSON)
    salvar_qualidade(problemas, LOG_QUALIDADE)
    print(f"      → Base física completa (auditoria): {len(registros)} registros")
    print(f"      → Base view consolidada (dashboard): {len(view_registros)} registros")

    # ------------------------------------------------------------------
    # 3. AGREGAR INDICADORES DA VIEW CONSOLIDADA
    # ------------------------------------------------------------------
    print("\n[3/4] Calculando indicadores da view consolidada...")
    resumo      = gerar_resumo_completo(view_registros)
    indicadores = resumo["consolidado"]
    por_mes     = resumo["por_mes"]

    SAIDA_RESUMO.parent.mkdir(parents=True, exist_ok=True)
    with open(SAIDA_RESUMO, "w", encoding="utf-8") as f:
        json.dump(resumo, f, ensure_ascii=False, indent=2, default=str)
    print(f"      → {SAIDA_RESUMO}")

    # ------------------------------------------------------------------
    # 4. RELATÓRIO DE QUALIDADE
    # ------------------------------------------------------------------
    print("\n[4/4] Gerando relatório de qualidade...")
    relatorio = gerar_relatorio(registros, problemas, indicadores, por_mes)
    print("\n" + relatorio)

    # ------------------------------------------------------------------
    # RESUMO FINAL NO CONSOLE
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("  RESUMO FINAL")
    print("=" * 60)

    ind = indicadores
    print(f"  Leads/Oportunidades        : {ind['leads_total']:>8,}")
    print(f"  Propostas Enviadas         : {ind['propostas_enviadas']:>8,}")
    print(f"  Qtd. de Vendas             : {ind['qtd_vendas']:>8,}")
    print(f"  Propostas Abertas          : {ind['propostas_abertas']:>8,}")
    print(f"  Recusadas                  : {ind['recusadas']:>8,}")
    print(f"  Conversão de Vendas        : {ind['conversao_pct']:>7.2f}%")
    print(f"  Previsão de Faturamento    : R$ {ind['previsao_faturamento']:>14,.2f}")
    print(f"  Faturamento Total Vendas   : R$ {ind['faturamento_total_vendas']:>14,.2f}")
    print(f"  Registros c/ valor inválido: {ind['registros_valor_invalido']:>8,}")
    print(f"  Vendas s/ valor válido     : {ind['vendas_sem_valor']:>8,}")
    print()

    # ------------------------------------------------------------------
    # CURVA ABC — tabela de porte
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("  CURVA ABC — CLASSIFICAÇÃO DE PORTE DE CLIENTES")
    print("=" * 60)
    curva_resultado = agregar_por_curva(view_registros)
    print("\n" + resumo_curva_texto(curva_resultado))

    # Salvar curva no resumo
    resumo["curva_abc"] = curva_resultado
    with open(SAIDA_RESUMO, "w", encoding="utf-8") as f:
        json.dump(resumo, f, ensure_ascii=False, indent=2, default=str)

    sem_class = next((r for r in curva_resultado if r['curva'] == 'Sem classificação'), {})
    print(f"\n  Registros sem classificação: {sem_class.get('registros', 0):,}")
    print()


if __name__ == "__main__":
    main()
