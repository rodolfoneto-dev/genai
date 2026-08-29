const GeminiAdapter = require('./adapters/gemini.adapter');
const ClaudeAdapter = require('./adapters/claude.adapter');
const MockAiAdapter = require('./adapters/mock.adapter');
const { CircuitBreaker, executeWithRetry } = require('./resilience');

class LlmService {
  constructor() {
    this.gemini = new GeminiAdapter();
    this.claude = new ClaudeAdapter();
    this.mockGemini = new MockAiAdapter('gemini');
    this.mockClaude = new MockAiAdapter('claude');
    this.mock = this.mockGemini; // Compatibilidade com código existente
    this.defaultProvider = process.env.DEFAULT_AI_PROVIDER || 'gemini';

    this.circuitBreakers = {
      gemini: new CircuitBreaker('gemini'),
      claude: new CircuitBreaker('claude'),
    };
  }

  /**
   * Retorna o CircuitBreaker associado ao provedor
   * @param {string} provider
   * @returns {CircuitBreaker|null}
   */
  getCircuitBreaker(provider) {
    return this.circuitBreakers[provider] || null;
  }

  /**
   * Retorna o nome do provedor secundário para fallback
   * @param {string} provider
   * @returns {string}
   */
  getFallbackProviderName(provider) {
    return provider === 'gemini' ? 'claude' : 'gemini';
  }

  /**
   * Retorna o adaptador pelo nome de provedor
   * @param {string} provider
   * @returns {BaseAiAdapter}
   */
  getAdapterByName(provider) {
    if (process.env.NODE_ENV === 'test' || process.env.USE_MOCK_AI === 'true') {
      return provider === 'claude' ? this.mockClaude : this.mockGemini;
    }
    return provider === 'claude' ? this.claude : this.gemini;
  }

  /**
   * Resolve o adaptador adequado considerando disponibilidade e estado do Circuit Breaker
   */
  resolveAdapter(requestedProvider) {
    const isTest = process.env.NODE_ENV === 'test' || process.env.USE_MOCK_AI === 'true';
    const primaryName = requestedProvider || this.defaultProvider;
    const fallbackName = this.getFallbackProviderName(primaryName);

    const primaryAdapter = this.getAdapterByName(primaryName);
    const fallbackAdapter = this.getAdapterByName(fallbackName);

    const primaryBreaker = this.getCircuitBreaker(primaryName);
    const fallbackBreaker = this.getCircuitBreaker(fallbackName);

    // Se o circuito do provedor primário estiver ABERTO, tenta chavear preventivamente para o fallback
    if (primaryBreaker && primaryBreaker.isOpen()) {
      const fallbackAvailable = isTest || fallbackAdapter.isAvailable();
      const fallbackHealthy = !fallbackBreaker || !fallbackBreaker.isOpen();

      if (fallbackAvailable && fallbackHealthy) {
        console.warn(`🔄 [LLM Service] Circuito de ${primaryName} ABERTO. Roteando preventivamente para ${fallbackName}...`);
        return fallbackAdapter;
      }
    }

    if (isTest) {
      return primaryAdapter;
    }

    // Valida se o primário está disponível
    if (primaryAdapter.isAvailable()) {
      return primaryAdapter;
    }

    // Fallback: se o preferido não tiver chave, tenta o outro
    if (fallbackAdapter.isAvailable()) {
      return fallbackAdapter;
    }

    // Se nenhuma chave estiver configurada em desenvolvimento, usa o mock seguro
    console.warn('⚠️ [LLM Service] Nenhuma chave de API de IA configurada (GEMINI_API_KEY ou ANTHROPIC_API_KEY). Usando MockAiAdapter.');
    return this.mock;
  }

  /**
   * Executa a geração com timeout, retry exponencial, circuit breaker e fallback transparente
   */
  async generate({
    systemPrompt,
    messages = [],
    maxTokens = 500,
    temperature = 0.7,
    jsonMode = false,
    provider = null,
    model = null,
    signal = null,
  }) {
    const primaryAdapter = this.resolveAdapter(provider);
    const primaryProviderName = primaryAdapter.name === 'mock' ? primaryAdapter.providerName : primaryAdapter.name;
    const primaryBreaker = this.getCircuitBreaker(primaryProviderName);

    try {
      const result = await executeWithRetry(
        async ({ signal: reqSignal }) => {
          return await primaryAdapter.generate({
            systemPrompt,
            messages,
            maxTokens,
            temperature,
            jsonMode,
            model,
            signal: reqSignal,
          });
        },
        {
          signal,
          onRetry: ({ attempt, delay, error }) => {
            console.warn(`🔄 [LLM Retry] Provedor ${primaryProviderName} - Tentativa ${attempt} em ${delay}ms após erro: ${error.message}`);
          },
        }
      );

      if (primaryBreaker) primaryBreaker.recordSuccess();
      return result;
    } catch (primaryErr) {
      if (primaryErr.name === 'AbortError' || signal?.aborted) {
        throw primaryErr;
      }

      if (primaryBreaker) primaryBreaker.recordFailure(primaryErr);
      console.error(`⚠️ [LLM Service] Falha no provedor ${primaryProviderName}: ${primaryErr.message}`);

      // Execução de Fallback
      const isTest = process.env.NODE_ENV === 'test' || process.env.USE_MOCK_AI === 'true';
      const fallbackProviderName = this.getFallbackProviderName(primaryProviderName);
      const fallbackAdapter = this.getAdapterByName(fallbackProviderName);
      const fallbackBreaker = this.getCircuitBreaker(fallbackProviderName);

      const canFallback = (isTest || fallbackAdapter.isAvailable()) && (!fallbackBreaker || !fallbackBreaker.isOpen());

      if (canFallback) {
        console.log(`🔄 [LLM Service] Executando fallback transparente para ${fallbackProviderName}...`);
        try {
          const fallbackResult = await executeWithRetry(
            async ({ signal: reqSignal }) => {
              return await fallbackAdapter.generate({
                systemPrompt,
                messages,
                maxTokens,
                temperature,
                jsonMode,
                signal: reqSignal,
              });
            },
            {
              signal,
              onRetry: ({ attempt, delay, error }) => {
                console.warn(`🔄 [LLM Retry Fallback] Provedor ${fallbackProviderName} - Tentativa ${attempt} em ${delay}ms: ${error.message}`);
              },
            }
          );

          if (fallbackBreaker) fallbackBreaker.recordSuccess();
          return fallbackResult;
        } catch (fallbackErr) {
          if (fallbackBreaker) fallbackBreaker.recordFailure(fallbackErr);
          console.error(`❌ [LLM Service] Fallback ${fallbackProviderName} também falhou: ${fallbackErr.message}`);

          const unavailableErr = new Error(`Todos os provedores de IA falharam. Primário (${primaryProviderName}): ${primaryErr.message} | Secundário (${fallbackProviderName}): ${fallbackErr.message}`);
          unavailableErr.code = 'PROVIDER_UNAVAILABLE';
          unavailableErr.details = { primary: primaryErr.message, fallback: fallbackErr.message };
          throw unavailableErr;
        }
      }

      throw primaryErr;
    }
  }

  /**
   * Executa a geração em streaming via async generator com suporte a circuit breaker e fallback
   */
  async *generateStream({
    systemPrompt,
    messages = [],
    maxTokens = 500,
    temperature = 0.7,
    jsonMode = false,
    provider = null,
    model = null,
    signal = null,
  }) {
    const primaryAdapter = this.resolveAdapter(provider);
    const primaryProviderName = primaryAdapter.name === 'mock' ? primaryAdapter.providerName : primaryAdapter.name;
    const primaryBreaker = this.getCircuitBreaker(primaryProviderName);

    let hasEmittedChunk = false;

    try {
      for await (const chunk of primaryAdapter.generateStream({
        systemPrompt,
        messages,
        maxTokens,
        temperature,
        jsonMode,
        model,
        signal,
      })) {
        if (!hasEmittedChunk && !chunk.isDone) {
          hasEmittedChunk = true;
          if (primaryBreaker) primaryBreaker.recordSuccess();
        }
        yield chunk;
      }
    } catch (primaryErr) {
      if (primaryErr.name === 'AbortError' || signal?.aborted) {
        throw primaryErr;
      }

      if (primaryBreaker) primaryBreaker.recordFailure(primaryErr);
      console.error(`⚠️ [LLM Service Stream] Falha no provedor ${primaryProviderName}: ${primaryErr.message}`);

      // Fallback seguro em streaming: SOMENTE se nenhum chunk foi transmitido ao cliente ainda
      if (!hasEmittedChunk) {
        const isTest = process.env.NODE_ENV === 'test' || process.env.USE_MOCK_AI === 'true';
        const fallbackProviderName = this.getFallbackProviderName(primaryProviderName);
        const fallbackAdapter = this.getAdapterByName(fallbackProviderName);
        const fallbackBreaker = this.getCircuitBreaker(fallbackProviderName);

        const canFallback = (isTest || fallbackAdapter.isAvailable()) && (!fallbackBreaker || !fallbackBreaker.isOpen());

        if (canFallback) {
          console.log(`🔄 [LLM Service Stream] Executando fallback seguro de stream para ${fallbackProviderName}...`);
          try {
            let fallbackEmitted = false;
            for await (const chunk of fallbackAdapter.generateStream({
              systemPrompt,
              messages,
              maxTokens,
              temperature,
              jsonMode,
              signal,
            })) {
              if (!fallbackEmitted && !chunk.isDone) {
                fallbackEmitted = true;
                if (fallbackBreaker) fallbackBreaker.recordSuccess();
              }
              yield chunk;
            }
            return;
          } catch (fallbackErr) {
            if (fallbackBreaker) fallbackBreaker.recordFailure(fallbackErr);
            console.error(`❌ [LLM Service Stream] Fallback ${fallbackProviderName} também falhou: ${fallbackErr.message}`);

            const unavailableErr = new Error(`Todos os provedores de IA falharam no streaming. Primário (${primaryProviderName}): ${primaryErr.message} | Secundário (${fallbackProviderName}): ${fallbackErr.message}`);
            unavailableErr.code = 'PROVIDER_UNAVAILABLE';
            throw unavailableErr;
          }
        }
      }

      throw primaryErr;
    }
  }
}

module.exports = new LlmService();
