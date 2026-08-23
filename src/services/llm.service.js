const GeminiAdapter = require('./adapters/gemini.adapter');
const ClaudeAdapter = require('./adapters/claude.adapter');
const MockAiAdapter = require('./adapters/mock.adapter');

class LlmService {
  constructor() {
    this.gemini = new GeminiAdapter();
    this.claude = new ClaudeAdapter();
    this.mock = new MockAiAdapter();
    this.defaultProvider = process.env.DEFAULT_AI_PROVIDER || 'gemini';
  }

  /**
   * Resolve o adaptador adequado com base na preferência e disponibilidade de chaves
   */
  resolveAdapter(requestedProvider) {
    if (process.env.NODE_ENV === 'test' || process.env.USE_MOCK_AI === 'true') {
      return this.mock;
    }

    const provider = requestedProvider || this.defaultProvider;

    if (provider === 'claude' && this.claude.isAvailable()) {
      return this.claude;
    }

    if (provider === 'gemini' && this.gemini.isAvailable()) {
      return this.gemini;
    }

    // Fallback: se o preferido não estiver disponível, tenta o outro
    if (this.gemini.isAvailable()) return this.gemini;
    if (this.claude.isAvailable()) return this.claude;

    // Se nenhuma chave estiver configurada em desenvolvimento, usa o mock seguro
    console.warn('⚠️ [LLM Service] Nenhuma chave de API de IA configurada (GEMINI_API_KEY ou ANTHROPIC_API_KEY). Usando MockAiAdapter.');
    return this.mock;
  }

  /**
   * Executa a geração com tratamento de erros, fallback transparente e normalização
   */
  async generate({
    systemPrompt,
    messages = [],
    maxTokens = 500,
    temperature = 0.7,
    jsonMode = false,
    provider = null,
    model = null,
  }) {
    const adapter = this.resolveAdapter(provider);

    try {
      return await adapter.generate({
        systemPrompt,
        messages,
        maxTokens,
        temperature,
        jsonMode,
        model,
      });
    } catch (primaryErr) {
      console.error(`⚠️ [LLM Service] Falha no adaptador ${adapter.name}: ${primaryErr.message}`);

      // Tentativa de fallback para o adaptador secundário se não for modo teste
      if (process.env.NODE_ENV !== 'test') {
        const fallbackAdapter = adapter.name === 'gemini' ? this.claude : this.gemini;
        if (fallbackAdapter.isAvailable()) {
          console.log(`🔄 [LLM Service] Tentando fallback para ${fallbackAdapter.name}...`);
          try {
            return await fallbackAdapter.generate({
              systemPrompt,
              messages,
              maxTokens,
              temperature,
              jsonMode,
            });
          } catch (fallbackErr) {
            console.error(`❌ [LLM Service] Fallback ${fallbackAdapter.name} também falhou: ${fallbackErr.message}`);
          }
        }
      }

      throw primaryErr;
    }
  }
}

module.exports = new LlmService();
