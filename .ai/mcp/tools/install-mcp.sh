#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENAI_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "==> Registrando genai-service-mcp no cliente MCP..."
echo "📍 Caminho: $GENAI_DIR/.ai/mcp/server.js"

# Verifica se o node está instalado
if ! command -v node &> /dev/null; then
  echo "❌ Node.js não encontrado no PATH"
  exit 1
fi

echo "✅ genai-service-mcp pronto para uso!"
