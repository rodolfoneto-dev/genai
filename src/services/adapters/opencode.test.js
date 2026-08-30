const OpencodeAdapter = require('./opencode.adapter');
const llmService = require('../llm.service');
const { redactSecrets } = require('../../utils/sanitizer');

describe('OpenCode Zen AI Adapter (Big Pickle & OpenAI-compatible)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Instanciação e Disponibilidade', () => {
    it('isAvailable deve retornar false se OPENCODE_API_KEY não estiver definida', () => {
      delete process.env.OPENCODE_API_KEY;
      const adapter = new OpencodeAdapter();
      expect(adapter.isAvailable()).toBe(false);
      expect(adapter.defaultModel).toBe('big-pickle');
      expect(adapter.baseUrl).toBe('https://opencode.ai/zen/v1');
    });

    it('isAvailable deve retornar true se OPENCODE_API_KEY estiver configurada', () => {
      process.env.OPENCODE_API_KEY = 'sk-mock-opencode-test-key-12345';
      const adapter = new OpencodeAdapter();
      expect(adapter.isAvailable()).toBe(true);
    });
  });

  describe('buildMessages', () => {
    it('deve montar array de mensagens no padrão OpenAI com system prompt', () => {
      const adapter = new OpencodeAdapter();
      const messages = adapter.buildMessages('You are a tutor', [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]);

      expect(messages).toEqual([
        { role: 'system', content: 'You are a tutor' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]);
    });

    it('deve injetar diretiva JSON quando jsonMode estiver ativo', () => {
      const adapter = new OpencodeAdapter();
      const messages = adapter.buildMessages('Evaluate essay', [], true);
      expect(messages[0].content).toContain('IMPORTANT: Respond ONLY with a valid raw JSON object');
    });
  });

  describe('generate (Unário)', () => {
    it('deve disparar fetch com endpoint /chat/completions e retornar resposta normalizada', async () => {
      process.env.OPENCODE_API_KEY = 'sk-mock-opencode-test-key-12345';
      const adapter = new OpencodeAdapter();

      const mockResponseData = {
        id: 'chatcmpl-test-123',
        model: 'big-pickle',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello from Big Pickle!',
            },
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 6,
          total_tokens: 21,
        },
      };

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponseData,
      });

      const res = await adapter.generate({
        systemPrompt: 'You are a helpful tutor',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
        temperature: 0.5,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://opencode.ai/zen/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer sk-mock-opencode-test-key-12345',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'big-pickle',
            messages: [
              { role: 'system', content: 'You are a helpful tutor' },
              { role: 'user', content: 'Hello' },
            ],
            max_tokens: 100,
            temperature: 0.5,
          }),
        })
      );

      expect(res).toEqual({
        content: 'Hello from Big Pickle!',
        parsedJson: null,
        provider: 'opencode',
        model: 'big-pickle',
        usage: {
          promptTokens: 15,
          completionTokens: 6,
          totalTokens: 21,
        },
        durationMs: expect.any(Number),
      });

      fetchSpy.mockRestore();
    });

    it('deve fazer parse de JSON quando jsonMode = true', async () => {
      process.env.OPENCODE_API_KEY = 'sk-mock-opencode-test-key-12345';
      const adapter = new OpencodeAdapter();

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'big-pickle',
          choices: [{ message: { content: '{"score": 9.5, "feedback": "Excellent"}' } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
      });

      const res = await adapter.generate({
        systemPrompt: 'Evaluate in JSON',
        messages: [{ role: 'user', content: 'Essay text' }],
        jsonMode: true,
      });

      expect(res.parsedJson).toEqual({ score: 9.5, feedback: 'Excellent' });
      fetchSpy.mockRestore();
    });

    it('deve lançar erro com status HTTP em caso de resposta não-ok', async () => {
      process.env.OPENCODE_API_KEY = 'sk-mock-opencode-test-key-12345';
      const adapter = new OpencodeAdapter();

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'Invalid API Key' } }),
      });

      await expect(
        adapter.generate({
          systemPrompt: 'Test',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow('OpenCode Zen API Error (401): Invalid API Key');

      fetchSpy.mockRestore();
    });
  });

  describe('generateStream (Streaming)', () => {
    it('deve consumir stream SSE e retornar chunks progressivos com métricas', async () => {
      process.env.OPENCODE_API_KEY = 'sk-mock-opencode-test-key-12345';
      const adapter = new OpencodeAdapter();

      const ssePayload = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" World"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ssePayload));
          controller.close();
        },
      });

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        body: stream,
      });

      const chunks = [];
      for await (const chunk of adapter.generateStream({
        systemPrompt: 'Hi',
        messages: [{ role: 'user', content: 'Say hello' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ text: 'Hello', isDone: false });
      expect(chunks[1]).toEqual({ text: ' World', isDone: false });
      expect(chunks[2]).toEqual(
        expect.objectContaining({
          text: '',
          isDone: true,
          provider: 'opencode',
          model: 'big-pickle',
          usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
        })
      );

      fetchSpy.mockRestore();
    });
  });

  describe('Sanitização & Observabilidade', () => {
    it('redactSecrets deve mascarar chave OPENCODE_API_KEY (sk-...)', () => {
      const log = 'Request failed with key sk-bLjDN0TFZ10Jn3h9EYqXJ5ZLzcgDNQKsbC7AKGGjUssdWa7JTuF4Mmf4z77yMlQQ on zen';
      const redacted = redactSecrets(log);
      expect(redacted).toContain('[REDACTED_OPENCODE_KEY]');
      expect(redacted).not.toContain('sk-bLjDN0TFZ10Jn3h9');
    });
  });

  describe('Integração com LlmService Orchestrator', () => {
    it('resolveAdapter("opencode") deve resolver adaptador opencode', () => {
      const adapter = llmService.getAdapterByName('opencode');
      expect(adapter).toBeDefined();
    });

    it('deve ter CircuitBreaker registrado para opencode', () => {
      const breaker = llmService.getCircuitBreaker('opencode');
      expect(breaker).toBeDefined();
      expect(breaker.name).toBe('opencode');
    });
  });
});
