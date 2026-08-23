# 🗺️ Memória Arquitetural & Contexto — GenAI Service

Decisões de arquitetura e modelos de dados do serviço generativo.

---

## 🏛️ Modelos Mongoose & Diretrizes
- **`AiUsageLog`**: Rastreabilidade de chamadas e custos em USD.
- **`UserQuota`**: Limites diários/mensais por tier e papel.
- **`TutorSession`**: Contexto de conversa com janela deslizante de 6 mensagens.
- **ADR 001 — Multi-Provider Adapter**: Desacoplamento de provedores (Gemini e Claude) via Strategy Pattern para plugar novos modelos (DeepSeek, Kimi) facilmente.
