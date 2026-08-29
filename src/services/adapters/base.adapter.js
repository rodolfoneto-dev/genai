/**
 * Interface base e normalização de saída para adaptadores de LLM.
 * Facilita a adição futura de novos provedores (DeepSeek, Kimi, Mistral, OpenAI).
 */
class BaseAiAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * Executa a chamada à LLM e retorna resposta normalizada.
   * @param {Object} params
   * @param {string} params.systemPrompt - Prompt de sistema com diretrizes pedagógicas
   * @param {Array<{role: string, content: string}>} params.messages - Histórico de mensagens
   * @param {number} params.maxTokens - Limite estrito de tokens de saída
   * @param {number} params.temperature - Criatividade (0.0 a 1.0)
   * @param {boolean} params.jsonMode - Se deve forçar saída estruturada em JSON
   * @returns {Promise<{ content: string, parsedJson: any, usage: { promptTokens: number, completionTokens: number, totalTokens: number }, durationMs: number, model: string }>}
   */
  async generate(params) {
    throw new Error(`O método generate() deve ser implementado pelo adaptador ${this.name}`);
  }

  /**
   * Executa a chamada à LLM em modo streaming e retorna async generator com chunks normalizados.
   * @param {Object} params
   * @param {string} params.systemPrompt
   * @param {Array<{role: string, content: string}>} params.messages
   * @param {number} params.maxTokens
   * @param {number} params.temperature
   * @param {string} [params.model]
   * @param {AbortSignal} [params.signal]
   * @returns {AsyncGenerator<{ text: string, isDone: boolean, usage?: object, durationMs?: number, ttftMs?: number }>}
   */
  async *generateStream(params) {
    throw new Error(`O método generateStream() deve ser implementado pelo adaptador ${this.name}`);
  }
}

module.exports = BaseAiAdapter;
