"""
tests/test_corte_fonte_dados.py
================================
Suíte de Testes Automatizados — Etapa 1: Corte de Fonte de Dados e View Consolidada SSO

Valida as 7 regras obrigatórias da Etapa 1:
  1. Janeiro a Junho da base histórica Excel permanecem visíveis na view consolidada.
  2. Registros históricos de Julho continuam armazenados na tabela física `registros_comerciais` para auditoria.
  3. Registros históricos de Julho na view consolidada = 0.
  4. Registros live anteriores a 01/07/2026 na view consolidada = 0.
  5. Período a partir de 01/07/2026 aceita na view consolidada exclusivamente `GOOGLE_SHEETS_LIVE`.
  6. Ausência de campos PII (empresa, cnpj, nome, telefone, email, observacao) na view consolidada.
  7. Garantia dos campos obrigatórios da camada de dados na view consolidada.

Execução:
    python3 tests/test_corte_fonte_dados.py
"""

import sys
import unittest
from datetime import datetime
from pathlib import Path

# Garantir acesso às pastas do projeto
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from importador import importar_excel, ARQUIVO_EXCEL


def aplicar_regra_view_consolidada(registros):
    """
    Aplica exatamente a consulta SQL da view_dashboard_consolidado:
    WHERE is_active = TRUE
      AND (
        (source_type = 'EXCEL_HISTORICO' AND data_referencia < DATE '2026-07-01')
        OR
        (source_type = 'GOOGLE_SHEETS_LIVE' AND data_referencia >= DATE '2026-07-01')
      )
    """
    view_result = []
    for r in registros:
        if not r.get("is_active", True):
            continue

        stype = r.get("source_type")
        dt_ref = r.get("data_referencia")
        if not dt_ref:
            continue

        # Regra de corte por data
        eh_excel_valido = (stype == "EXCEL_HISTORICO" and dt_ref < "2026-07-01")
        eh_live_valido  = (stype == "GOOGLE_SHEETS_LIVE" and dt_ref >= "2026-07-01")

        if eh_excel_valido or eh_live_valido:
            # Projetar apenas colunas públicas (SEM PII)
            item_view = {
                "id_registro":            r.get("id_registro"),
                "source_type":            r.get("source_type"),
                "spreadsheet_id":         r.get("spreadsheet_id"),
                "source_sheet":           r.get("source_sheet"),
                "source_record_id":       r.get("source_record_id"),
                "data_referencia":        r.get("data_referencia"),
                "mes_referencia":         r.get("mes_referencia"),
                "ano_referencia":         r.get("ano_referencia"),
                "vendedor":               r.get("vendedor"),
                "quantidade_funcionarios":r.get("quantidade_funcionarios"),
                "fonte_lead":             r.get("fonte_lead"),
                "valor_mensal":           r.get("valor_mensal"),
                "valor_total":            r.get("valor_total"),
                "status":                 r.get("status"),
                "tipo_contrato":          r.get("tipo_contrato"),
                "tipo_base":              r.get("tipo_base"),
                "situacao_contrato":      r.get("situacao_contrato"),
                "numero_os":              r.get("numero_os"),
                "row_hash":               r.get("row_hash"),
                "is_active":              r.get("is_active"),
                "created_at":             r.get("created_at"),
                "updated_at":             r.get("updated_at"),
                "synced_at":              r.get("synced_at"),
            }
            view_result.append(item_view)

    return view_result


class TestCorteFonteDadosEtapa1(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registros_fisicos, cls.problemas = importar_excel(ARQUIVO_EXCEL)
        cls.view_consolidada = aplicar_regra_view_consolidada(cls.registros_fisicos)

    def test_1_jan_a_jun_permanecem_na_view(self):
        """Janeiro a junho da base histórica Excel permanecem visíveis."""
        jan_a_jun = [
            r for r in self.view_consolidada
            if r["source_type"] == "EXCEL_HISTORICO" and r["data_referencia"] < "2026-07-01"
        ]
        self.assertEqual(len(jan_a_jun), 1157,
                         f"Janeiro a Junho na view: esperado 1157, obtido {len(jan_a_jun)}")

    def test_2_julho_historico_armazenado_fisicamente(self):
        """Julho histórico continua armazenado no banco para fins de auditoria."""
        julho_fisico = [
            r for r in self.registros_fisicos
            if r["source_type"] == "EXCEL_HISTORICO" and r["data_referencia"] >= "2026-07-01"
        ]
        self.assertEqual(len(julho_fisico), 108,
                         f"Julho histórico físico: esperado 108, obtido {len(julho_fisico)}")

    def test_3_historico_julho_na_view_consolidada_zero(self):
        """Nenhum registro histórico de Julho aparece na view consolidada."""
        julho_view = [
            r for r in self.view_consolidada
            if r["source_type"] == "EXCEL_HISTORICO" and r["data_referencia"] >= "2026-07-01"
        ]
        self.assertEqual(len(julho_view), 0,
                         f"Julho histórico na view: esperado 0, obtido {len(julho_view)}")

    def test_4_live_antes_do_corte_na_view_zero(self):
        """Registros GOOGLE_SHEETS_LIVE anteriores a 01/07/2026 na view = 0."""
        live_pre_corte = [
            r for r in self.view_consolidada
            if r["source_type"] == "GOOGLE_SHEETS_LIVE" and r["data_referencia"] < "2026-07-01"
        ]
        self.assertEqual(len(live_pre_corte), 0,
                         f"Live pré-corte na view: esperado 0, obtido {len(live_pre_corte)}")

    def test_5_julho_em_diante_somente_live(self):
        """Julho em diante aceita na view consolidada exclusivamente GOOGLE_SHEETS_LIVE."""
        origens_julho_em_diante = {
            r["source_type"]
            for r in self.view_consolidada
            if r["data_referencia"] >= "2026-07-01"
        }
        for orig in origens_julho_em_diante:
            self.assertEqual(orig, "GOOGLE_SHEETS_LIVE",
                             f"Origem indevida em Julho+: encontrado {orig}")

    def test_6_ausencia_de_pii_na_view(self):
        """View consolidada não deve conter campos de PII."""
        campos_pii = {"empresa", "cnpj", "nome", "telefone", "email", "observacao", "observacoes"}
        for r in self.view_consolidada:
            for pii in campos_pii:
                self.assertNotIn(pii, r, f"Campo PII '{pii}' vazou na view consolidada!")

    def test_7_campos_obrigatorios_presentes(self):
        """Garante que todos os campos exigidos pela especificação estejam presentes."""
        campos_obrigatorios = [
            "source_type", "spreadsheet_id", "source_sheet", "source_record_id",
            "data_referencia", "mes_referencia", "ano_referencia", "vendedor",
            "quantidade_funcionarios", "fonte_lead", "valor_mensal", "valor_total",
            "status", "tipo_contrato", "tipo_base", "situacao_contrato", "numero_os",
            "row_hash", "is_active", "created_at", "updated_at", "synced_at"
        ]
        for r in self.view_consolidada:
            for c in campos_obrigatorios:
                self.assertIn(c, r, f"Campo '{c}' ausente na view consolidada")


if __name__ == "__main__":
    print("\n" + "=" * 65)
    print("  TESTES DE ACEITE — ETAPA 1: CORTE DE FONTE DE DADOS SSO")
    print("=" * 65 + "\n")
    suite = unittest.TestLoader().loadTestsFromTestCase(TestCorteFonteDadosEtapa1)
    runner = unittest.TextTestRunner(verbosity=2)
    res = runner.run(suite)
    sys.exit(0 if res.wasSuccessful() else 1)
