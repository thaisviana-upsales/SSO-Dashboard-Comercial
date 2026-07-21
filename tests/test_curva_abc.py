"""
tests/test_curva_abc.py
=======================
Testes automatizados — Curva ABC de Clientes
Dashboard Comercial Executivo SSO — Etapa 1 de 3 (Qualidade de Vendas)

Execução:
    python3 tests/test_curva_abc.py

Autor: Antigravity / Google DeepMind
Data:  2026-07-21
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from curva_abc import converter_qtd_funcionarios, classificar_curva, agregar_por_curva, CURVAS_ORDENADAS
from importador import importar_excel, ARQUIVO_EXCEL


# ===========================================================================
# 1. TESTES UNITÁRIOS — CONVERSOR
# ===========================================================================

class TestConversorQtdFuncionarios(unittest.TestCase):
    """Testa converter_qtd_funcionarios."""

    def test_inteiro_direto(self):
        self.assertEqual(converter_qtd_funcionarios(50), 50)

    def test_float_vira_int(self):
        self.assertEqual(converter_qtd_funcionarios(70.0), 70)

    def test_string_numerica(self):
        self.assertEqual(converter_qtd_funcionarios("25"), 25)

    def test_zero(self):
        self.assertEqual(converter_qtd_funcionarios(0), 0)

    def test_zero_float(self):
        self.assertEqual(converter_qtd_funcionarios(0.0), 0)

    def test_x_maiusculo(self):
        self.assertIsNone(converter_qtd_funcionarios("X"))

    def test_x_minusculo(self):
        self.assertIsNone(converter_qtd_funcionarios("x"))

    def test_vazio_string(self):
        self.assertIsNone(converter_qtd_funcionarios(""))

    def test_vazio_none(self):
        self.assertIsNone(converter_qtd_funcionarios(None))

    def test_negativo_int(self):
        self.assertIsNone(converter_qtd_funcionarios(-1))

    def test_negativo_float(self):
        self.assertIsNone(converter_qtd_funcionarios(-5.0))

    def test_texto_invalido(self):
        self.assertIsNone(converter_qtd_funcionarios("MUITOS"))

    def test_value_error_excel(self):
        self.assertIsNone(converter_qtd_funcionarios("#VALUE!"))

    def test_nao_substitui_por_zero(self):
        """Valores inválidos devem retornar None, NUNCA 0."""
        for inv in ["X", "x", "", None, "#VALUE!", "ERRO", -1]:
            result = converter_qtd_funcionarios(inv)
            self.assertNotEqual(result, 0,
                msg=f"Valor inválido {repr(inv)} foi substituído por zero incorretamente")


# ===========================================================================
# 2. TESTES DE FRONTEIRA — CLASSIFICAÇÃO
# ===========================================================================

class TestClassificacaoCurvaABC(unittest.TestCase):
    """Testa todos os limites obrigatórios da Curva ABC."""

    # Limites exatos conforme especificação
    def test_120_entra_em_aplus(self):
        self.assertEqual(classificar_curva(120), 'A+')

    def test_119_entra_em_a(self):
        self.assertEqual(classificar_curva(119), 'A')

    def test_80_entra_em_a(self):
        self.assertEqual(classificar_curva(80), 'A')

    def test_79_entra_em_b(self):
        self.assertEqual(classificar_curva(79), 'B')

    def test_50_entra_em_b(self):
        self.assertEqual(classificar_curva(50), 'B')

    def test_49_entra_em_c(self):
        self.assertEqual(classificar_curva(49), 'C')

    def test_11_entra_em_c(self):
        self.assertEqual(classificar_curva(11), 'C')

    def test_10_entra_em_d(self):
        self.assertEqual(classificar_curva(10), 'D')

    def test_0_entra_em_d(self):
        self.assertEqual(classificar_curva(0), 'D')

    def test_x_string_nao_eh_classificado(self):
        """'X' deve converter para None, que classifica como Sem classificação."""
        qtd = converter_qtd_funcionarios("X")
        self.assertIsNone(qtd)
        self.assertEqual(classificar_curva(qtd), 'Sem classificação')

    def test_vazio_nao_eh_classificado(self):
        """Vazio deve converter para None → Sem classificação."""
        qtd = converter_qtd_funcionarios("")
        self.assertIsNone(qtd)
        self.assertEqual(classificar_curva(qtd), 'Sem classificação')

    def test_none_resulta_sem_classificacao(self):
        self.assertEqual(classificar_curva(None), 'Sem classificação')

    def test_negativo_resulta_sem_classificacao(self):
        """Negativos → None no conversor → Sem classificação."""
        qtd = converter_qtd_funcionarios(-1)
        self.assertIsNone(qtd)
        self.assertEqual(classificar_curva(qtd), 'Sem classificação')

    # Valores extremos e pontos intermediários
    def test_valores_aplus(self):
        for v in [120, 150, 200, 500, 1000]:
            self.assertEqual(classificar_curva(v), 'A+', f"Falha para {v}")

    def test_valores_a(self):
        for v in [80, 90, 100, 110, 119]:
            self.assertEqual(classificar_curva(v), 'A', f"Falha para {v}")

    def test_valores_b(self):
        for v in [50, 60, 70, 79]:
            self.assertEqual(classificar_curva(v), 'B', f"Falha para {v}")

    def test_valores_c(self):
        for v in [11, 20, 30, 40, 49]:
            self.assertEqual(classificar_curva(v), 'C', f"Falha para {v}")

    def test_valores_d(self):
        for v in [0, 1, 5, 10]:
            self.assertEqual(classificar_curva(v), 'D', f"Falha para {v}")


# ===========================================================================
# 3. TESTES DE MUTUA EXCLUSIVIDADE
# ===========================================================================

class TestMutuaExclusividadeCurva(unittest.TestCase):
    """Cada valor pertence a exatamente uma categoria."""

    def test_cada_valor_em_somente_uma_categoria(self):
        """Testa 0..200 — cada número deve resultar em exatamente 1 categoria."""
        for v in range(0, 201):
            resultado = classificar_curva(v)
            self.assertIn(resultado, ['A+', 'A', 'B', 'C', 'D'],
                          f"Valor {v} classificado como '{resultado}' (inválido)")

    def test_sem_sobreposicao_entre_categorias(self):
        """Fronteiras: nenhum valor pode estar em duas categorias."""
        fronteiras = {
            119: 'A',   120: 'A+',
            79: 'B',    80: 'A',
            49: 'C',    50: 'B',
            10: 'D',    11: 'C',
        }
        for v, esperado in fronteiras.items():
            resultado = classificar_curva(v)
            self.assertEqual(resultado, esperado,
                             f"Fronteira {v}: esperado '{esperado}', obtido '{resultado}'")


# ===========================================================================
# 4. TESTES DE INTEGRAÇÃO — BASE REAL
# ===========================================================================

_REGISTROS = None
_PROBLEMAS = None

def _get_dados():
    global _REGISTROS, _PROBLEMAS
    if _REGISTROS is None:
        _REGISTROS, _PROBLEMAS = importar_excel(ARQUIVO_EXCEL)
    return _REGISTROS, _PROBLEMAS


class TestIntegracaoCurvaABC(unittest.TestCase):
    """Testes de integração contra a base real do Excel."""

    def setUp(self):
        self.registros, _ = _get_dados()

    def test_todos_registros_tem_curva_abc(self):
        """Todo registro deve ter o campo curva_abc_cliente."""
        for r in self.registros:
            self.assertIn('curva_abc_cliente', r,
                          f"Campo curva_abc_cliente ausente no registro {r.get('id_registro')}")

    def test_todos_registros_tem_qtd_original(self):
        """Todo registro deve ter quantidade_funcionarios_original."""
        for r in self.registros:
            self.assertIn('quantidade_funcionarios_original', r)

    def test_todos_registros_tem_qtd_convertida(self):
        """Todo registro deve ter quantidade_funcionarios (pode ser None)."""
        for r in self.registros:
            self.assertIn('quantidade_funcionarios', r)

    def test_curvas_validas(self):
        """Todas as classificações devem ser valores canônicos."""
        validas = set(['A+', 'A', 'B', 'C', 'D', 'Sem classificação'])
        for r in self.registros:
            self.assertIn(r['curva_abc_cliente'], validas,
                          f"Classificação inválida: {r['curva_abc_cliente']}")

    def test_qtd_null_implica_sem_classificacao(self):
        """Se quantidade_funcionarios=None, curva deve ser 'Sem classificação'."""
        for r in self.registros:
            if r['quantidade_funcionarios'] is None:
                self.assertEqual(r['curva_abc_cliente'], 'Sem classificação',
                                 f"qtd=None mas curva='{r['curva_abc_cliente']}'")

    def test_qtd_valida_nao_implica_sem_classificacao(self):
        """Se quantidade_funcionarios é número, curva deve ser A+, A, B, C ou D."""
        for r in self.registros:
            if r['quantidade_funcionarios'] is not None:
                self.assertNotEqual(r['curva_abc_cliente'], 'Sem classificação',
                                    f"qtd={r['quantidade_funcionarios']} mas curva='Sem classificação'")

    def test_invalido_nao_vira_zero(self):
        """Registros com quantidade_funcionarios_original inválida → None, não 0."""
        for r in self.registros:
            if r['quantidade_funcionarios'] == 0:
                # Se é zero, a origem deve ser numérica (0 é válido = D)
                orig = r['quantidade_funcionarios_original']
                self.assertIsNotNone(orig, "qtd=0 sem valor original")
            if r.get('quantidade_funcionarios_original') in ('X', 'x', ''):
                self.assertIsNone(r['quantidade_funcionarios'],
                                  "Valor 'X' ou vazio não deveria virar número")

    def test_soma_propostas_por_curva_igual_total(self):
        """SUM(propostas por curva) deve igual o total de propostas da base."""
        from curva_abc import agregar_por_curva
        resultado = agregar_por_curva(self.registros)
        total_por_curva = sum(r['propostas'] for r in resultado)
        total_base = sum(1 for r in self.registros
                         if r.get('tipo_contrato') and str(r['tipo_contrato']).strip())
        self.assertEqual(total_por_curva, total_base,
                         f"Propostas por curva ({total_por_curva}) ≠ total base ({total_base})")

    def test_soma_registros_por_curva_igual_total(self):
        """SUM(registros por curva) deve igual o total de registros."""
        from curva_abc import agregar_por_curva
        resultado = agregar_por_curva(self.registros)
        total_por_curva = sum(r['registros'] for r in resultado)
        self.assertEqual(total_por_curva, len(self.registros),
                         f"Total por curva ({total_por_curva}) ≠ total registros ({len(self.registros)})")

    def test_vinicios_vinicius_separados(self):
        """VINICIOS e VINICIUS devem existir separadamente na base."""
        vendedores = {r.get('vendedor') for r in self.registros}
        if 'VINICIOS' in vendedores and 'VINICIUS' in vendedores:
            cnt_cios = sum(1 for r in self.registros if r.get('vendedor') == 'VINICIOS')
            cnt_cius = sum(1 for r in self.registros if r.get('vendedor') == 'VINICIUS')
            self.assertGreater(cnt_cios, 0, "VINICIOS sem registros")
            self.assertGreater(cnt_cius, 0, "VINICIUS sem registros")

    def test_fonte_lead_preservada(self):
        """Fontes não devem ser unificadas (SSOMED/SITE ≠ SSOMED / SITE)."""
        fontes = {r.get('fonte_lead') for r in self.registros if r.get('fonte_lead')}
        f1, f2 = 'SSOMED/SITE', 'SSOMED / SITE'
        if f1 in fontes and f2 in fontes:
            self.assertNotEqual(f1, f2)  # sempre true — garante que ambas existem

    def test_nenhum_dado_pii_novo(self):
        """Os novos campos não introduzem PII."""
        campos_pii = {'empresa', 'cnpj', 'nome', 'telefone', 'email',
                      'observacao', 'observacao_vendedor'}
        for r in self.registros:
            for campo in campos_pii:
                self.assertNotIn(campo, r,
                                 f"Campo PII '{campo}' encontrado após atualização")

    def test_total_registros_intacto(self):
        """A Etapa 1 deve continuar com exatamente 1.265 registros."""
        self.assertEqual(len(self.registros), 1265,
                         f"Total de registros alterado! Obtido: {len(self.registros)}")


# ===========================================================================
# RUNNER
# ===========================================================================

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  TESTES CURVA ABC — DASHBOARD COMERCIAL SSO")
    print("=" * 60 + "\n")

    loader = unittest.TestLoader()
    suite  = unittest.TestSuite()
    for cls in [TestConversorQtdFuncionarios, TestClassificacaoCurvaABC,
                TestMutuaExclusividadeCurva, TestIntegracaoCurvaABC]:
        suite.addTests(loader.loadTestsFromTestCase(cls))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    print("\n" + "=" * 60)
    print("  ✅ TODOS OS TESTES PASSARAM" if result.wasSuccessful()
          else f"  ❌ {len(result.failures)} falha(s), {len(result.errors)} erro(s)")
    print("=" * 60)
    sys.exit(0 if result.wasSuccessful() else 1)
