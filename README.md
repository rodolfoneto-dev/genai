# agy --conversation=c8d8df39-114e-4b01-b94a-de8edfe9a2dc
# 🧠 UP!Experience — GenAI Microservice (`genai`)

Microsserviço de Inteligência Artificial Generativa pedagógica da plataforma UP!Experience. Centraliza o tutor interativo, correção de redações, geração sob demanda de exercícios e governança de custos (FinOps).

---

## 🚀 Tecnologias & Arquitetura

- **Runtime**: Node.js 20 LTS (Express)
- **Database**: MongoDB Atlas (Mongoose)
- **AI Providers**: Google Gemini (`@google/generative-ai`), Anthropic Claude (`@anthropic-ai/sdk`) e OpenCode Zen (`big-pickle`)
- **Porta Padrão**: `:4004` (interna no Docker / Gateway)
- **Segurança**: JWT Stateless com verificação de assinatura e permissões RBAC (`aluno`, `professor`, `admin`)
- **FinOps & Quotas**: 2 camadas de proteção (Rate limit in-memory de 20 req/min + Quota diária de tokens no MongoDB)

---

## 🛣️ Catálogo de Endpoints REST

| Método | Endpoint | Permissão (v1) | Descrição |
| :--- | :--- | :--- | :--- |
| **`POST`** | `/genai/tutor/chat` | `aluno`, `professor` | Conversa com o tutor UP! com janela deslizante de 20 mensagens. |
| **`POST`** | `/genai/correction/essay` | `aluno`, `professor` | Correção detalhada de redação com erros gramaticais e sugestões. |
| **`POST`** | `/genai/exercises/generate` | `professor`, `admin` | Geração sob demanda de exercícios com gabarito explicativo. |
| **`GET`** | `/genai/usage/my-quota` | `aluno`, `professor`, `admin` | Consulta de saldo diário e mensal de tokens do usuário. |
| **`GET`** | `/genai/usage/analytics` | `admin` | Relatório consolidado de custos e tokens para gestão FinOps. |
| **`GET`** | `/health` | *Público* | Healthcheck com status do banco e provedores de IA. |
| **`GET`** | `/docs.json` | *Público* | Especificação OpenAPI 3.0 agregada pelo Edge Gateway. |

---

## 🛠️ Comandos Rápidos

```bash
# Instalar dependências
npm install

# Rodar em modo desenvolvimento
npm run dev

# Executar suíte de testes (Jest)
npm test

# Gerar tokens JWT de teste
npm run token:gen aluno
npm run token:gen professor
npm run token:gen admin

# Executar servidor MCP nativo
npm run mcp
```
