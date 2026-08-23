# 🧪 Evals & Benchmarks — GenAI Service

Suítes de avaliação automatizada para qualidade pedagógica e precisão de saída estruturada.

---

## 🎯 Cenários de Avaliação
1. **CEFR Alignment Precision**: Validar se respostas calibradas para A1 realmente utilizam vocabulário e frases ultra-simples.
2. **JSON Output Guarantee**: Garantir que as rotas de correção e geração de exercícios nunca retornem blocos corrompidos de JSON.
3. **Quota Block Latency**: Validar que requisições de alunos com quota excedida são bloqueadas em menos de 10ms sem chamar a API de IA.
