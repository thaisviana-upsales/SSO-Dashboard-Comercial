# FÓRMULAS E REGRAS DE NEGÓCIO
# Dashboard Comercial Executivo SSO — Etapa 1
# Documento de Referência Analítica

**Projeto:** Dashboard Comercial Executivo SSO  
**Etapa:** 1 de 3 — Importação, Tratamento e Validação dos Dados  
**Última atualização:** 2026-07-21  
**Período dos dados:** Janeiro a Julho de 2026 (derivado do nome das abas)

---

## 1. ORIGEM DOS DADOS

| Arquivo        | `Base.2025.resultados SSO.xlsx`                            |
|----------------|------------------------------------------------------------|
| Abas válidas   | Janeiro26, Fevereiro26, Março26, Abril26, Maio26, Junho26, Julho26 |
| Linha de header| Linha 4 (linhas 1–3 são cabeçalhos de grupo mesclados)    |
| Período correto| 2026 (nome da aba sobrepõe o nome do arquivo)              |

> **IMPORTANTE:** Apesar de o arquivo se chamar `2025`, o período correto é **2026**,
> derivado do nome das abas. O mapeamento é feito por texto de cabeçalho, nunca
> por posição de coluna fixa.

---

## 2. CAMPOS IMPORTADOS (MODELO NORMALIZADO)

| Campo                | Origem na Planilha                      | Tipo      | Observação                               |
|---------------------|-----------------------------------------|-----------|------------------------------------------|
| `id_registro`       | Gerado automaticamente                  | UUID      | Único por registro                       |
| `mes_numero`        | Derivado do nome da aba                 | Integer   | 1–7                                      |
| `mes_nome`          | Derivado do nome da aba                 | String    | Ex: "Janeiro"                            |
| `ano`               | Derivado do nome da aba                 | Integer   | 2026                                     |
| `aba_origem`        | Nome da aba do Excel                    | String    | Ex: "Janeiro26"                          |
| `linha_origem`      | Número da linha na planilha             | Integer   | Permite rastreabilidade                  |
| `qtd_original`      | Coluna "QTD"                            | Any       | Preservado sem transformação             |
| `tipo_contrato`     | **Primeira** ocorrência de "TIPO DE CONTRATO" | String | Trim apenas; texto original preservado |
| `valor_total`       | Coluna "VALOR TOTAL"                    | Float/NULL | Convertido de formato BR; NULL se inválido |
| `status`            | Coluna "STATUS"                         | String    | Trim apenas; texto original preservado  |
| `fonte_lead`        | Coluna "FONTE DO LEAD"                  | String    | Texto original preservado; sem unificação |
| `vendedor`          | Coluna "VENDEDOR"                       | String    | Texto original preservado; sem unificação |
| `flag_valor_invalido` | Calculado                             | Boolean   | True se valor_total não pôde ser convertido |
| `data_importacao`   | Gerado automaticamente                  | ISO 8601  | Timestamp da execução do pipeline       |

---

## 3. CAMPOS EXCLUÍDOS (PII E OPERACIONAIS)

Os seguintes campos **não são importados** para a camada analítica:

- EMPRESA
- CNPJ
- NOME
- TELEFONE
- E-MAIL
- QUANTIDADE DE FUNCIONÁRIOS
- DATA ENVIO DE ORÇAMENTO
- DATA DE FECHAMENTO DA VENDA
- VALOR MENSAL
- PARCELAS
- TIPO DE CONTRATO (segunda ocorrência)
- SITUAÇÃO DO CONTRATO
- NÚMERO DA O.S.
- OBSERVAÇÃO DO VENDEDOR

---

## 4. ESTRUTURA DAS ABAS E DIFERENÇAS

| Aba          | Possui PARCELAS? | Coluna VALOR_TOTAL | Coluna STATUS | Coluna FONTE | Coluna VENDEDOR |
|--------------|------------------|--------------------|---------------|--------------|-----------------|
| Janeiro26    | ❌ Não            | L                  | M             | Q            | R               |
| Fevereiro26+ | ✅ Sim            | M                  | N             | R            | S               |

> **Nota sobre Janeiro26 — PARCELAS:**  
> A aba Janeiro26 não possui coluna PARCELAS explícita. O equivalente seria  
> `PARCELAS = VALOR_TOTAL / VALOR_MENSAL` (conforme instrução do usuário).  
> Como PARCELAS não integra a camada analítica, essa derivação é apenas  
> documental — não altera o modelo de dados.

> **Localização por texto:** O importador jamais usa posição de coluna fixa.
> Todas as colunas são localizadas pelo texto do cabeçalho na linha 4.

---

## 5. REGRAS DE TRATAMENTO

### 5.1 Limpeza de Texto
```
campo_armazenado = str(valor_bruto).strip()
```
- Apenas espaços no início e no final são removidos.
- Espaços internos são preservados.
- Capitalização é preservada.

### 5.2 Normalização de STATUS (somente para comparação)
```
status_normalizado = status_armazenado.strip().upper()
```
- O texto armazenado na base é o original (apenas trim).
- A comparação para classificação usa `strip().upper()`.
- Nunca se altera o valor armazenado.

### 5.3 Conversão de Valor Monetário Brasileiro
```python
# Aceita:
"R$ 16.928,33"  →  16928.33
"16.928,33"     →  16928.33
"16928.33"      →  16928.33
245784          →  245784.0

# Retorna NULL para:
"X", "À DEFINIR", "", None, "#VALUE!", "#REF!"
```

Algoritmo:
1. Se for `int` ou `float` nativo Python → converter diretamente para `float`
2. Remover `R$` e espaços
3. Se combinar `\d{1,3}(\.\d{3})*(,\d+)?` → remover `.`, substituir `,` por `.`
4. Se combinar `\d+(,\d+)` → substituir `,` por `.`
5. Se combinar `\d+(\.\d+)?` → usar como está
6. Caso contrário → `NULL`; registrar em `flag_valor_invalido = True`

**REGRA CRÍTICA:** Valores inválidos NÃO são substituídos por zero.

---

## 6. REGRAS DOS INDICADORES

### 6.1 Leads / Oportunidades
```
Leads = COUNT(*) de linhas comerciais válidas
```
- Uma linha é válida se possui pelo menos um campo comercial não vazio.
- **Nunca** usar `SUM(qtd_original)`.

### 6.2 Propostas Enviadas
```
Propostas_Enviadas = COUNT(*) WHERE tipo_contrato IS NOT NULL AND tipo_contrato != ''
```
- Todo registro com `tipo_contrato` preenchido conta como proposta enviada.

### 6.3 Previsão de Faturamento (Total de Propostas)
```
Previsao_Faturamento = SUM(valor_total)
  WHERE tipo_contrato IS NOT NULL
    AND flag_valor_invalido = FALSE
    AND valor_total IS NOT NULL
```
- Registros com valor inválido são excluídos da soma, mas permanecem na contagem.

### 6.4 Qtd. de Vendas
```
Qtd_Vendas = COUNT(*) WHERE TRIM(UPPER(status)) = 'CONTRATO FECHADO'
```

### 6.5 Faturamento Total de Vendas
```
Fat_Vendas = SUM(valor_total)
  WHERE TRIM(UPPER(status)) = 'CONTRATO FECHADO'
    AND flag_valor_invalido = FALSE
    AND valor_total IS NOT NULL
```

### 6.6 Conversão de Vendas
```
Conversao_Pct = (Qtd_Vendas / Propostas_Enviadas) × 100
```
> ⚠️ **ATENÇÃO:** A fórmula é `Vendas ÷ Propostas`, NUNCA `Propostas ÷ Vendas`.

### 6.7 Propostas Abertas
```
Propostas_Abertas = COUNT(*) WHERE TRIM(UPPER(status)) = 'PROPOSTA ENVIADA'
```

### 6.8 Recusadas
```
Recusadas = COUNT(*) WHERE TRIM(UPPER(status)) = 'RECUSADO'
```

---

## 7. TESTES DE ACEITE

| Indicador                  | Valor Esperado       | Tolerância |
|---------------------------|----------------------|------------|
| Janeiro — registros        | 96                   | exato      |
| Fevereiro — registros      | 127                  | exato      |
| Março — registros          | 193                  | exato      |
| Abril — registros          | 249                  | exato      |
| Maio — registros           | 265                  | exato      |
| Junho — registros          | 227                  | exato      |
| Julho — registros          | 108                  | exato      |
| **Total de Leads**         | **1.265**            | exato      |
| Propostas Enviadas         | 1.265                | exato      |
| Qtd. de Vendas             | 635                  | exato      |
| Propostas Abertas          | 387                  | exato      |
| Recusadas                  | 243                  | exato      |
| Conversão de Vendas        | ≈ 50,20%             | ± 1,5 p.p. |
| Previsão de Faturamento    | R$ 5.969.373,38      | ± R$ 1,00  |
| Faturamento Total Vendas   | R$ 1.676.229,28      | ± R$ 1,00  |
| Registros s/ valor válido  | 13                   | exato      |
| Contratos fechados s/ valor| 5                    | exato      |

---

## 8. REGRAS DE PRESERVAÇÃO DE TEXTO

As seguintes informações são preservadas **exatamente como estão** na planilha
(após trim), sem qualquer unificação ou normalização artificial:

| Campo           | Exemplo de NÃO unificação                   |
|-----------------|----------------------------------------------|
| `fonte_lead`    | `SSOMED/SITE` ≠ `SSOMED / SITE`             |
| `vendedor`      | `VINICIOS` ≠ `VINICIUS`                     |
| `tipo_contrato` | `PACOTE SST ` e `PACOTE SST` são distintos  |

---

## 9. ESTRUTURA DE ARQUIVOS

```
Painel Comercial SSO/
├── Base.2025.resultados SSO.xlsx   ← Fonte de dados (não modificado)
├── src/
│   ├── importador.py               ← Leitor do Excel + tratamentos
│   ├── agregador.py                ← Serviço de cálculo dos indicadores
│   ├── relatorio_qualidade.py      ← Gerador do relatório de qualidade
│   └── pipeline.py                 ← Orquestrador principal
├── tests/
│   └── test_importacao.py          ← Suite de testes automatizados (22 testes)
├── docs/
│   └── formulas.md                 ← Este documento
└── output/
    ├── base_analitica.json         ← Base normalizada (sem PII)
    ├── resumo_executivo.json       ← Indicadores agregados
    ├── qualidade.json              ← Log de problemas de qualidade
    └── relatorio_qualidade.txt     ← Relatório legível
```

---

## 10. GARANTIAS DE PRIVACIDADE

A base analítica (`base_analitica.json`) **não contém** nenhum dado pessoal
identificável (PII). Os 14 campos listados na seção 3 são descartados durante
a importação e nunca persistidos na camada analítica.

O teste `test_nenhum_dado_pii` valida automaticamente essa garantia a cada
execução da suite de testes.
