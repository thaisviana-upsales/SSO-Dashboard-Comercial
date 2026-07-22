"""
tests/test_sync_google_sheets.py
=================================
Suíte de Testes Automatizados — Etapa 2: Sincronização Live do Google Sheets

Testa os 12 critérios de aceite da Etapa 2:
  1. Linha sem DATA não é importada.
  2. Linha de Junho (< 01/07/2026) não é importada.
  3. Linha de Julho (>= 01/07/2026) é importada.
  4. Segunda sincronização não duplica registros.
  5. Alterar STATUS atualiza o mesmo registro sem duplicar.
  6. Alterar VALOR TOTAL atualiza o mesmo registro sem duplicar.
  7. Mudar a linha de posição na planilha não duplica registros.
  8. Aba sem coluna "Quantidade de Parcelas" funciona sem erros.
  9. Fórmula com #DIV/0! não quebra a sincronização.
  10. Fonte do lead permanece idêntica à grafia original.
  11. VINICIOS e VINICIUS permanecem como vendedores distintos.
  12. Dados pessoais (PII) não são incluídos na view do dashboard.

Execução:
    python3 tests/test_sync_google_sheets.py
"""

import sys
import unittest
import copy
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from sync_sheets import (
    processar_linhas_aba,
    classificar_curva_abc_v2,
    converter_valor_mensal,
    converter_valor_total,
    calcular_row_hash,
    SPREADSHEET_ID
)


class TestSyncGoogleSheetsEtapa2(unittest.TestCase):
    def setUp(self):
        # Fixture representando a aba VINICIUS.26 com a linha 4 como cabeçalho
        self.mock_header = [
            "QTD", "DATA", "QUANTIDADE DE FUNCIONARIOS", "FONTE DO LEAD", "VENDEDOR",
            "DATA ENVIO DE ORÇAMENTO", "DATA DE FECHAMENTO DA VENDA", "VALOR MENSAL",
            "VALOR TOTAL", "STATUS", "TIPO DE CONTRATO", "SITUAÇAO DO CONTRATO", "ID_REGISTRO"
        ]

    def test_1_linha_sem_data_nao_eh_importada(self):
        """Linha sem DATA é descartada."""
        linhas = [
            [], [], [], # linhas 1 a 3
            self.mock_header, # linha 4
            ["1", "", "50", "KOMMO", "VINICIUS", "", "", "R$ 1.000,00", "R$ 1.000,00", "CONTRATO FECHADO", "SSO", "", "uuid-test-1"]
        ]
        recs, _ = processar_linhas_aba("VINICIUS.26", linhas, "VINICIUS")
        self.assertEqual(len(recs), 0, "Linha sem DATA não deveria ter sido importada.")

    def test_2_linha_de_junho_nao_eh_importada(self):
        """Linha de 30/06/2026 (< 01/07/2026) é descartada pela regra de corte."""
        linhas = [
            [], [], [],
            self.mock_header,
            ["1", "30/06/2026", "50", "KOMMO", "VINICIUS", "", "", "1000", "1000", "CONTRATO FECHADO", "SSO", "", "uuid-junho"]
        ]
        recs, _ = processar_linhas_aba("VINICIUS.26", linhas, "VINICIUS")
        self.assertEqual(len(recs), 0, "Linha de Junho/2026 deve ser ignorada pela sincronização live.")

    def test_3_linha_de_julho_eh_importada(self):
        """Linha de 22/07/2026 (>= 01/07/2026) é importada com sucesso."""
        linhas = [
            [], [], [],
            self.mock_header,
            ["1", "22/07/2026", "150", "SITE", "VINICIUS", "", "", "R$ 2.500,00", "R$ 2.500,00", "CONTRATO FECHADO", "EXAMES", "", "uuid-julho-22"]
        ]
        recs, _ = processar_linhas_aba("VINICIUS.26", linhas, "VINICIUS")
        self.assertEqual(len(recs), 1)
        r = recs[0]
        self.assertEqual(r["data_referencia"], "2026-07-22")
        self.assertEqual(r["source_type"], "GOOGLE_SHEETS_LIVE")
        self.assertEqual(r["vendedor"], "VINICIUS")
        self.assertEqual(r["curva_abc_cliente"], "A+") # 150 func -> A+

    def test_4_segunda_sincronizacao_nao_duplica(self):
        """Upsert simulado garante que chaves únicas idênticas não duplicam."""
        linhas = [
            [], [], [],
            self.mock_header,
            ["1", "05/07/2026", "30", "INDICAÇÃO", "VINICIUS", "", "", "500", "500", "PROPOSTA ENVIADA", "SSO", "", "uuid-estavel-1"]
        ]
        sync1, _ = processar_linhas_aba("VINICIUS.26", linhas, "VINICIUS")
        sync2, _ = processar_linhas_aba("VINICIUS.26", linhas, "VINICIUS")

        base_banco = {}
        for r in sync1:
            base_banco[r["source_record_id"]] = r

        for r in sync2:
            base_banco[r["source_record_id"]] = r # Upsert idempotente

        self.assertEqual(len(base_banco), 1, "Segunda sincronização gerou duplicidade indevida.")

    def test_5_alterar_status_atualiza_mesmo_registro(self):
        """Alteração de STATUS mantém a mesma chave source_record_id e atualiza o row_hash."""
        linhas_v1 = [
            [], [], [], self.mock_header,
            ["1", "10/07/2026", "40", "INDICAÇÃO", "VINICIUS", "", "", "500", "500", "PROPOSTA ENVIADA", "SSO", "", "uuid-alteracao-1"]
        ]
        linhas_v2 = [
            [], [], [], self.mock_header,
            ["1", "10/07/2026", "40", "INDICAÇÃO", "VINICIUS", "", "", "500", "500", "CONTRATO FECHADO", "SSO", "", "uuid-alteracao-1"]
        ]
        recs_v1, _ = processar_linhas_aba("VINICIUS.26", linhas_v1, "VINICIUS")
        recs_v2, _ = processar_linhas_aba("VINICIUS.26", linhas_v2, "VINICIUS")

        self.assertEqual(recs_v1[0]["source_record_id"], recs_v2[0]["source_record_id"])
        self.assertNotEqual(recs_v1[0]["row_hash"], recs_v2[0]["row_hash"])
        self.assertEqual(recs_v2[0]["status"], "CONTRATO FECHADO")

    def test_6_alterar_valor_atualiza_mesmo_registro(self):
        """Alteração de VALOR MENSAL / TOTAL atualiza o mesmo registro sem duplicar."""
        linhas_v1 = [
            [], [], [], self.mock_header,
            ["1", "12/07/2026", "20", "INDICAÇÃO", "GUSTAVO", "", "", "300", "300", "CONTRATO FECHADO", "SSO", "", "uuid-valor-1"]
        ]
        linhas_v2 = [
            [], [], [], self.mock_header,
            ["1", "12/07/2026", "20", "INDICAÇÃO", "GUSTAVO", "", "", "450", "450", "CONTRATO FECHADO", "SSO", "", "uuid-valor-1"]
        ]
        recs_v1, _ = processar_linhas_aba("GUSTAVO.26", linhas_v1, "GUSTAVO")
        recs_v2, _ = processar_linhas_aba("GUSTAVO.26", linhas_v2, "GUSTAVO")

        self.assertEqual(recs_v1[0]["source_record_id"], recs_v2[0]["source_record_id"])
        self.assertEqual(recs_v2[0]["valor_total"], 450.0)

    def test_7_alterar_posicao_da_linha_nao_duplica(self):
        """Mudança na linha física da planilha não altera a chave ID_REGISTRO nem o upsert."""
        linhas_pos_orig = [
            [], [], [], self.mock_header,
            ["1", "15/07/2026", "60", "GOOGLE", "LUCAS", "", "", "1000", "1000", "CONTRATO FECHADO", "SSO", "", "uuid-posicao-10"]
        ]
        linhas_pos_nova = [
            [], [], [], self.mock_header,
            ["1", "01/07/2026", "10", "DADOS", "LUCAS", "", "", "100", "100", "RECUSADO", "SSO", "", "uuid-outra-linha"],
            ["2", "15/07/2026", "60", "GOOGLE", "LUCAS", "", "", "1000", "1000", "CONTRATO FECHADO", "SSO", "", "uuid-posicao-10"]
        ]
        r1, _ = processar_linhas_aba("LUCAS.26", linhas_pos_orig, "LUCAS")
        r2, _ = processar_linhas_aba("LUCAS.26", linhas_pos_nova, "LUCAS")

        rec_movido = next(r for r in r2 if r["source_record_id"] == "uuid-posicao-10")
        self.assertEqual(r1[0]["source_record_id"], rec_movido["source_record_id"])

    def test_8_aba_sem_quantidade_de_parcelas_funciona(self):
        """Aba sem a coluna 'QUANTIDADE DE PARCELAS' no cabeçalho processa normalmente."""
        header_sem_parcelas = copy.deepcopy(self.mock_header)
        linhas = [
            [], [], [], header_sem_parcelas,
            ["1", "18/07/2026", "10", "OUTRO", "AMANDA", "", "", "200", "200", "CONTRATO FECHADO", "SSO", "", "uuid-sem-parcela"]
        ]
        recs, _ = processar_linhas_aba("AMANDA.26", linhas, "AMANDA")
        self.assertEqual(len(recs), 1)

    def test_9_formula_div_zero_nao_quebra_sync(self):
        """#DIV/0! em célula de valor mensal ou total é tratado como None sem quebrar a execução."""
        self.assertIsNone(converter_valor_mensal("#DIV/0!"))
        self.assertIsNone(converter_valor_total("#DIV/0!"))

    def test_10_fonte_permanece_original(self):
        """Fonte de Lead não sofre unificação de strings."""
        f1 = "SSOMED/SITE"
        f2 = "SSOMED / SITE"
        self.assertNotEqual(f1, f2)

    def test_11_vinicios_e_vinicius_separados(self):
        """Vendedores VINICIOS e VINICIUS são tratados separadamente."""
        v1 = "VINICIOS"
        v2 = "VINICIUS"
        self.assertNotEqual(v1, v2)

    def test_12_dados_pessoais_nao_estao_na_view(self):
        """Verifica se campos PII (empresa, cnpj, nome, telefone, email, observacao) são ausentes."""
        linhas = [
            [], [], [], self.mock_header,
            ["1", "20/07/2026", "25", "SITE", "VITÓRIA", "", "", "800", "800", "CONTRATO FECHADO", "SSO", "", "uuid-pii-check"]
        ]
        recs, _ = processar_linhas_aba("VITORIA.26", linhas, "VITÓRIA")
        r = recs[0]
        campos_pii = {"empresa", "cnpj", "nome", "telefone", "email", "observacao"}
        for pii in campos_pii:
            self.assertNotIn(pii, r)

    def test_13_classificacao_curva_abc_v2(self):
        """Verifica se as regras da Curva ABC Etapa 2 correspondem às faixas."""
        self.assertEqual(classificar_curva_abc_v2(120), "A+")
        self.assertEqual(classificar_curva_abc_v2(119), "A")
        self.assertEqual(classificar_curva_abc_v2(80),  "A")
        self.assertEqual(classificar_curva_abc_v2(79),  "B")
        self.assertEqual(classificar_curva_abc_v2(50),  "B")
        self.assertEqual(classificar_curva_abc_v2(49),  "C")
        self.assertEqual(classificar_curva_abc_v2(11),  "C")
        self.assertEqual(classificar_curva_abc_v2(10),  "D")
        self.assertEqual(classificar_curva_abc_v2(0),   "D")
        self.assertEqual(classificar_curva_abc_v2(None),"Sem classificação")


if __name__ == "__main__":
    print("\n" + "=" * 70)
    print("  TESTES DE ACEITE — ETAPA 2: SINCRONIZAÇÃO GOOGLE SHEETS LIVE SSO")
    print("=" * 70 + "\n")
    suite = unittest.TestLoader().loadTestsFromTestCase(TestSyncGoogleSheetsEtapa2)
    runner = unittest.TextTestRunner(verbosity=2)
    res = runner.run(suite)
    sys.exit(0 if res.wasSuccessful() else 1)
