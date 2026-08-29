process.env.AI_RETRY_INITIAL_DELAY_MS = '5';
process.env.AI_REQUEST_TIMEOUT_MS = '2000';

const { CircuitBreaker, CIRCUIT_STATES } = require('./circuit-breaker');
const { executeWithRetry, isRetryableError } = require('./retry');
const llmService = require('../llm.service');

describe('GenAI Service - Resilience & Fault Tolerance (Epic 2)', () => {
  describe('Story 2.1: Request Timeout & Exponential Backoff Retry Policy', () => {
    it('isRetryableError deve identificar corretamente erros transitórios e de cliente', () => {
      // Transitórios (Retryable)
      expect(isRetryableError({ status: 429, message: 'Too many requests' })).toBe(true);
      expect(isRetryableError({ status: 503, message: 'Service unavailable' })).toBe(true);
      expect(isRetryableError({ message: 'Resource has been exhausted (rate limit)' })).toBe(true);
      expect(isRetryableError({ message: 'ETIMEDOUT connection failed' })).toBe(true);
      expect(isRetryableError({ message: 'fetch failed' })).toBe(true);

      // Não-transitórios (Non-retryable)
      expect(isRetryableError({ status: 400, message: 'Bad request payload' })).toBe(false);
      expect(isRetryableError({ status: 401, message: 'Invalid API key' })).toBe(false);
      expect(isRetryableError({ status: 403, message: 'Forbidden' })).toBe(false);
      expect(isRetryableError({ status: 404, message: 'Model not found' })).toBe(false);
      expect(isRetryableError({ name: 'AbortError', message: 'The user aborted a request' })).toBe(false);
    });

    it('executeWithRetry deve retentar erros transitórios até ter sucesso', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          const err = new Error('Rate limit exceeded (429)');
          err.status = 429;
          throw err;
        }
        return { success: true, attempts };
      });

      const retriesLogged = [];
      const result = await executeWithRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 10,
        onRetry: (info) => retriesLogged.push(info),
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
      expect(retriesLogged.length).toBe(2);
      expect(retriesLogged[0].attempt).toBe(1);
    });

    it('executeWithRetry deve falhar imediatamente sem retries em erro 400/401', async () => {
      const fn = jest.fn(async () => {
        const clientErr = new Error('Invalid authentication key');
        clientErr.status = 401;
        throw clientErr;
      });

      await expect(
        executeWithRetry(fn, { maxRetries: 3, initialDelayMs: 10 })
      ).rejects.toThrow('Invalid authentication key');

      expect(fn).toHaveBeenCalledTimes(1); // Sem retentativas
    });

    it('executeWithRetry deve abortar com timeout se a operação exceder timeoutMs', async () => {
      const slowFn = jest.fn(async ({ signal }) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason);
          });
        });
      });

      await expect(
        executeWithRetry(slowFn, { timeoutMs: 30, maxRetries: 0 })
      ).rejects.toThrow(/Tempo limite/);
    });
  });

  describe('Story 2.2: Circuit Breaker for Failing Providers', () => {
    let breaker;

    beforeEach(() => {
      breaker = new CircuitBreaker('test-provider', {
        failureThreshold: 3,
        windowMs: 1000,
        cooldownMs: 50,
      });
    });

    it('deve inicializar em estado CLOSED e não bloquear chamadas', () => {
      expect(breaker.getState()).toBe(CIRCUIT_STATES.CLOSED);
      expect(breaker.isOpen()).toBe(false);
    });

    it('deve transicionar para OPEN após atingir limiar de falhas', () => {
      breaker.recordFailure(new Error('Falha 1'));
      expect(breaker.getState()).toBe(CIRCUIT_STATES.CLOSED);

      breaker.recordFailure(new Error('Falha 2'));
      expect(breaker.getState()).toBe(CIRCUIT_STATES.CLOSED);

      breaker.recordFailure(new Error('Falha 3'));
      expect(breaker.getState()).toBe(CIRCUIT_STATES.OPEN);
      expect(breaker.isOpen()).toBe(true);
    });

    it('deve transicionar para HALF_OPEN após expiração do cooldown e resetar em sucesso', async () => {
      // Força abertura do circuito
      breaker.recordFailure(new Error('Falha 1'));
      breaker.recordFailure(new Error('Falha 2'));
      breaker.recordFailure(new Error('Falha 3'));
      expect(breaker.getState()).toBe(CIRCUIT_STATES.OPEN);

      // Aguarda expiração do cooldown
      await new Promise((r) => setTimeout(r, 60));

      // Ao checar isOpen(), transiciona para HALF_OPEN permitindo canário
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState()).toBe(CIRCUIT_STATES.HALF_OPEN);

      // Sucesso na requisição canário fecha o circuito
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CIRCUIT_STATES.CLOSED);
      expect(breaker.failures.length).toBe(0);
    });

    it('deve reabrir o circuito imediatamente se o canário falhar em HALF_OPEN', async () => {
      breaker.recordFailure(new Error('Falha 1'));
      breaker.recordFailure(new Error('Falha 2'));
      breaker.recordFailure(new Error('Falha 3'));

      await new Promise((r) => setTimeout(r, 60));
      expect(breaker.isOpen()).toBe(false); // Agora HALF_OPEN

      // Canário falhou
      breaker.recordFailure(new Error('Canário falhou'));
      expect(breaker.getState()).toBe(CIRCUIT_STATES.OPEN);
      expect(breaker.isOpen()).toBe(true);
    });
  });

  describe('Story 2.3: Stream-Compatible Provider Fallback Routing', () => {
    beforeEach(() => {
      llmService.mockGemini.clearFailure();
      llmService.mockClaude.clearFailure();
      llmService.circuitBreakers.gemini?.reset();
      llmService.circuitBreakers.claude?.reset();
    });

    it('deve executar fallback para Claude se o Gemini falhar na geração unária', async () => {
      // Simula falha esgotada no Gemini
      llmService.mockGemini.simulateFailure(new Error('Gemini 503 Overloaded'), 5);

      const res = await llmService.generate({
        systemPrompt: 'TUTOR',
        messages: [{ role: 'user', content: 'Hello fallback test' }],
      });

      expect(res).toBeDefined();
      expect(res.provider).toBe('claude');
      expect(res.content).toBeDefined();
    });

    it('deve lançar PROVIDER_UNAVAILABLE se tanto Gemini quanto Claude falharem', async () => {
      llmService.mockGemini.simulateFailure(new Error('Gemini Down'), 5);
      llmService.mockClaude.simulateFailure(new Error('Claude Down'), 5);

      await expect(
        llmService.generate({
          systemPrompt: 'TUTOR',
          messages: [{ role: 'user', content: 'Both down' }],
        })
      ).rejects.toThrow(/Todos os provedores de IA falharam/);
    });

    it('deve executar fallback transparente de stream se o primário falhar antes do primeiro chunk', async () => {
      llmService.mockGemini.simulateFailure(new Error('Gemini Stream Error before first token'), 5);

      const chunks = [];
      let finalChunk = null;

      for await (const chunk of llmService.generateStream({
        systemPrompt: 'TUTOR',
        messages: [{ role: 'user', content: 'Test stream fallback' }],
      })) {
        if (!chunk.isDone) {
          chunks.push(chunk);
        } else {
          finalChunk = chunk;
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(finalChunk).toBeDefined();
      expect(finalChunk.provider).toBe('claude');
    });

    it('deve chavear preventivamente para Claude se o circuito do Gemini estiver ABERTO', async () => {
      const geminiBreaker = llmService.getCircuitBreaker('gemini');
      // Força circuito aberto no Gemini
      geminiBreaker.state = CIRCUIT_STATES.OPEN;
      geminiBreaker.nextAttemptTime = Date.now() + 60000;

      const res = await llmService.generate({
        systemPrompt: 'TUTOR',
        messages: [{ role: 'user', content: 'Circuit breaker test' }],
      });

      expect(res.provider).toBe('claude');
    });
  });
});
