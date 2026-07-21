"""
exportar_dados_dashboard.py
===========================
Exporta a base analítica validada (Etapa 1) como módulo JS para o dashboard.
NÃO modifica os dados — apenas serializa para consumo do frontend.

Uso: python3 src/exportar_dados_dashboard.py
"""

import json
from datetime import datetime
from pathlib import Path

BASE_JSON = Path(__file__).parent.parent / "output" / "base_analitica.json"
OUT_JS    = Path(__file__).parent.parent / "dashboard" / "js" / "data.js"

def exportar():
    if not BASE_JSON.exists():
        raise FileNotFoundError(
            f"Base analítica não encontrada: {BASE_JSON}\n"
            "Execute primeiro: python3 src/pipeline.py"
        )

    with open(BASE_JSON, "r", encoding="utf-8") as f:
        dados = json.load(f)

    ts = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    js = (
        "// DADOS ANALÍTICOS SSO — ETAPA 1 (camada validada)\n"
        f"// Exportado em: {ts}\n"
        f"// Registros: {len(dados)}\n"
        "// ATENÇÃO: Este arquivo é gerado automaticamente. Não edite manualmente.\n"
        f"const SSO_DATA = {json.dumps(dados, ensure_ascii=False, separators=(',', ':'))};\n"
        f"const SSO_EXPORTED_AT = '{ts}';\n"
    )

    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write(js)

    print(f"✅ Exportado: {len(dados)} registros → {OUT_JS}")

if __name__ == "__main__":
    exportar()
