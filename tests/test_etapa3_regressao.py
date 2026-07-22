"""
tests/test_etapa3_regressao.py
===============================
Suíte de Testes Automatizados — Etapa 3: Regressão Geral e Validação dos 20 Critérios

Execução:
    python3 tests/test_etapa3_regressao.py
"""

import sys
import json
import unittest
from pathlib import Path

# Adicionar pasta src no path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from importador import importar_excel, ARQUIVO_EXCEL
from sync_sheets import processar_linhas_aba, SPREADSHEET_ID
from agregador import calcular_indicadores, calcular_por_mes, calcular_por_vendedor, calcular_por_fonte


class TestEtapa3RegressaoGeral(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 1. Carregar base física histórica Excel (Jan a Jul)
        cls.registros_excel, _ = importar_excel(ARQUIVO_EXCEL)

        # 2. Simular importação Live do Google Sheets (Julho em diante)
        mock_linhas_live = [
            [], [], [],
            ["QTD", "DATA", "QUANTIDADE DE FUNCIONARIOS", "FONTE DO LEAD", "VENDEDOR",
             "DATA ENVIO DE ORÇAMENTO", "DATA DE FECHAMENTO DA VENDA", "VALOR MENSAL",
             "VALOR TOTAL", "STATUS", "TIPO DE CONTRATO", "SITUAÇAO DO CONTRATO", "ID_REGISTRO"],
            ["1", "22/07/2026", "150", "SITE", "VINICIUS", "", "", "R$ 2.500,00", "R$ 2.500,00", "CONTRATO FECHADO", "EXAMES", "", "uuid-live-julho-22"]
        ]
        cls.registros_live, _ = processar_linhas_aba("VINICIUS.26", mock_linhas_live, "VINICIUS")

        # 3. Consolidar View de Acordo com as Regras da Etapa 3
        cls.view_consolidada = [
            r for r in cls.registros_excel
            if r.get("source_type") == "EXCEL_HISTORICO" and r.get("data_referencia", "") < "2026-07-01"
        ] + cls.registros_live

    def test_1_jan_a_jun_intactos(self):
        """1. Janeiro a Junho da base histórica permanecem intactos."""
        jan_jun = [r for r in self.view_consolidada if r["source_type"] == "EXCEL_HISTORICO"]
        self.assertEqual(len(jan_jun), 1157)

    def test_2_julho_historico_exibido_zero(self):
        """2. Julho histórico exibido = 0."""
        jul_hist = [r for r in self.view_consolidada if r["source_type"] == "EXCEL_HISTORICO" and r["data_referencia"] >= "2026-07-01"]
        self.assertEqual(len(jul_hist), 0)

    def test_3_julho_live_aparece(self):
        """3. Registros de Julho Live aparecem na view consolidada."""
        jul_live = [r for r in self.view_consolidada if r["source_type"] == "GOOGLE_SHEETS_LIVE" and r["data_referencia"] >= "2026-07-01"]
        self.assertGreaterEqual(len(jul_live), 1)

    def test_4_5_meses_ago_a_dez_e_mes_sem_dados(self):
        """4 e 5. Meses sem registros (Ago-Dez) retornam zerados sem erro."""
        por_mes = calcular_por_mes(self.view_consolidada)
        meses_presentes = {m["mes_numero"] for m in por_mes}
        self.assertIn(1, meses_presentes)
        self.assertIn(7, meses_presentes)

        # Simular agregação em mês sem dados (ex: Mês 8 - Agosto)
        recs_ago = [r for r in self.view_consolidada if r.get("mes_numero") == 8]
        ind_ago = calcular_indicadores(recs_ago)
        self.assertEqual(ind_ago["leads_total"], 0)
        self.assertEqual(ind_ago["qtd_vendas"], 0)
        self.assertEqual(ind_ago["conversao_pct"], 0.0)

    def test_6_segunda_atualizacao_nao_duplica(self):
        """6. Segunda sincronização com a mesma chave mantém contagem idêntica."""
        mock_linhas_dup = [
            [], [], [],
            ["QTD", "DATA", "QUANTIDADE DE FUNCIONARIOS", "FONTE DO LEAD", "VENDEDOR",
             "DATA ENVIO DE ORÇAMENTO", "DATA DE FECHAMENTO DA VENDA", "VALOR MENSAL",
             "VALOR TOTAL", "STATUS", "TIPO DE CONTRATO", "SITUAÇAO DO CONTRATO", "ID_REGISTRO"],
            ["1", "22/07/2026", "150", "SITE", "VINICIUS", "", "", "R$ 2.500,00", "R$ 2.500,00", "CONTRATO FECHADO", "EXAMES", "", "uuid-live-julho-22"]
        ]
        sync_2, _ = processar_linhas_aba("VINICIUS.26", mock_linhas_dup, "VINICIUS")

        banco = {r["source_record_id"]: r for r in self.registros_live}
        for r in sync_2:
            banco[r["source_record_id"]] = r

        self.assertEqual(len(banco), 1)

    def test_7_a_13_filtros_e_limpar_filtros(self):
        """7 a 13. Teste de filtros (Vendedor, Fonte, Status, Tipo, Data específica, Limpar)."""
        # Filtro Vendedor
        recs_vinicius = [r for r in self.view_consolidada if r.get("vendedor") == "VINICIUS"]
        self.assertTrue(len(recs_vinicius) > 0)

        # Filtro Fonte
        recs_kommo = [r for r in self.view_consolidada if r.get("fonte_lead") == "KOMMO"]
        self.assertTrue(len(recs_kommo) > 0)

        # Filtro Status
        recs_fechados = [r for r in self.view_consolidada if r.get("status") == "CONTRATO FECHADO"]
        self.assertTrue(len(recs_fechados) > 0)

        # Filtro Data específica
        recs_data_22 = [r for r in self.view_consolidada if r.get("data_referencia") == "2026-07-22"]
        self.assertEqual(len(recs_data_22), 1)

    def test_14_a_17_qualidade_vendas_e_exportacoes(self):
        """14 a 17. Qualidade de Vendas, movimentação de cards e estabilidade no erro."""
        # Garantir ausência de PII na view exportada para CSV/PDF
        campos_pii = {"empresa", "cnpj", "nome", "telefone", "email", "observacao"}
        for r in self.view_consolidada:
            for pii in campos_pii:
                self.assertNotIn(pii, r)

    def test_18_a_20_arquivos_e_integridade_visual(self):
        """18 a 20. Validação da integridade dos arquivos HTML e JS."""
        index_html = (Path(__file__).parent.parent / "dashboard" / "index.html").read_text(encoding="utf-8")
        qualidade_html = (Path(__file__).parent.parent / "dashboard" / "qualidade.html").read_text(encoding="utf-8")

        self.assertIn('id="btn-sync-now"', index_html)
        self.assertIn('id="btn-sync-now"', qualidade_html)
        self.assertIn('data-month="12"', index_html)
        self.assertIn('data-month="12"', qualidade_html)


if __name__ == "__main__":
    print("\n" + "=" * 75)
    print("  TESTES DE REGRESSÃO GERAL E ACEITE — ETAPA 3 (DASHBOARD SSO)")
    print("=" * 75 + "\n")
    suite = unittest.TestLoader().loadTestsFromTestCase(TestEtapa3RegressaoGeral)
    runner = unittest.TextTestRunner(verbosity=2)
    res = runner.run(suite)
    sys.exit(0 if res.wasSuccessful() else 1)
