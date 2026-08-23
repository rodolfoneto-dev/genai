# 🧠 GenAI Service — Camada AI-Native (`.ai/`)

Estrutura de governança e inteligência artificial para o microsserviço generativo (Tutor, Correção e Exercícios).

---

## 📂 Estrutura de Pastas

| Diretório | Finalidade |
| :--- | :--- |
| **`agents/`** | Subagentes especializados (ex: `@PromptAuditor`, `@FinOpsCostAuditor`). |
| **`evals/`** | Suítes de avaliação automatizada (*LLM-as-a-judge*) para testar qualidade de respostas pedagógicas e alinhamento CEFR. |
| **`context/`** | Memória arquitetural, modelos Mongoose, regras de prompts e contratos. |
| **`workflows/`** | Workflows e scripts de revisão de PRs focados em consumo de tokens e saídas JSON estruturadas. |
| **`generators/`** | Geradores de dados sintéticos de conversas, redações e exercícios. |
| **`mcp/`** | Servidor nativo Model Context Protocol (`genai-service-mcp`). |
