const DeepseekAdapter = require('./deepseek.adapter');
const llmService = require('../llm.service');

describe('DeepSeek AI Adapter (DeepSeek-V3, DeepSeek-V4 & Reasoner)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Instanciação e Disponibilidade', () => {
    it('isAvailable deve retornar false se DEEPSEEK_API_KEY não estiver definida', () => {
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.DEEPSEEK_MODEL;
      const adapter = new DeepseekAdapter();
      expect(adapter.isAvailable()).toBe(false);
      expect(adapter.defaultModel).toBe('deepseek-chat');
      expect(adapter.baseUrl).toBe('https://api.deepseek.com');
    });

    it('isAvailable deve retornar true se DEEPSEEK_API_KEY estiver configurada', () => {
      process.env.DEEPSEEK_API_KEY = 'sk-mock-deepseek-test-key-12345';
      const adapter = new DeepseekAdapter();
      expect(adapter.isAvailable()).toBe(true);
    });

    it('normalizeModelName deve mapear aliases curtos para identificadores oficiais', () => {
      const adapter = new DeepseekAdapter();
      expect(adapter.normalizeModelName('v4-flash')).toBe('deepseek-v4-flash');
      expect(adapter.normalizeModelName('v4-pro')).toBe('deepseek-v4-pro');
      expect(adapter.normalizeModelName('v4-flash-vision-exp')).toBe('deepseek-v4-flash-vision-exp');
      expect(adapter.normalizeModelName('chat')).toBe('deepseek-chat');
      expect(adapter.normalizeModelName('reasoner')).toBe('deepseek-reasoner');
      expect(adapter.normalizeModelName('deepseek-chat')).toBe('deepseek-chat');
    });
  });

  describe('buildMessages', () => {
    it('deve montar array de mensagens no padrão OpenAI com system prompt', () => {
      const adapter = new DeepseekAdapter();
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
      const adapter = new DeepseekAdapter();
      const messages = adapter.buildMessages('Evaluate essay', [], true);
      expect(messages[0].content).toContain('IMPORTANT: Respond ONLY with a valid raw JSON object');
    });
  });

  describe('generate (Unário)', () => {
    it('deve disparar fetch com endpoint /chat/completions e retornar resposta normalizada', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-mock-deepseek-test-key-12345';
      const adapter = new DeepseekAdapter();

      const mockResponseData = {
        id: 'chatcmpl-test-123',
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello from DeepSeek!',
              reasoning_content: 'Quick greeting reasoning',
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
        model: 'v4-flash',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.deepseek.com/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer sk-mock-deepseek-test-key-12345',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'deepseek-v4-flash',
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
        content: 'Hello from DeepSeek!',
        reasoningContent: 'Quick greeting reasoning',
        parsedJson: null,
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
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
      process.env.DEEPSEEK_API_KEY = 'sk-mock-deepseek-test-key-12345';
      const adapter = new DeepseekAdapter();

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'deepseek-chat',
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
      process.env.DEEPSEEK_API_KEY = 'sk-mock-deepseek-test-key-12345';
      const adapter = new DeepseekAdapter();

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
      ).rejects.toThrow('DeepSeek API Error (401): Invalid API Key');

      fetchSpy.mockRestore();
    });

    it('deve lançar erro se DEEPSEEK_API_KEY não estiver presente', async () => {
      delete process.env.DEEPSEEK_API_KEY;
      const adapter = new DeepseekAdapter();

      await expect(
        adapter.generate({
          systemPrompt: 'Test',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow('DEEPSEEK_API_KEY não configurada no ambiente.');
    });
  });

  describe('generateStream (Streaming)', () => {
    it('deve consumir stream SSE e retornar chunks progressivos separando reasoning de content', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-mock-deepseek-test-key-12345';
      const adapter = new DeepseekAdapter();

      const ssePayload = [
        'data: {"choices":[{"delta":{"reasoning_content":"Thinking..."}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" DeepSeek"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12}}\n\n',
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
      expect(chunks[1]).toEqual({ text: ' DeepSeek', isDone: false });
      expect(chunks[2]).toEqual(
        expect.objectContaining({
          text: '',
          isDone: true,
          provider: 'deepseek',
          model: 'deepseek-chat',
          reasoningContent: 'Thinking...',
          usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
        })
      );

      fetchSpy.mockRestore();
    });

    it('deve lançar erro se o stream falhar com erro HTTP', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-mock-deepseek-test-key-12345';
      const adapter = new DeepseekAdapter();

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

      await expect(async () => {
        for await (const _ of adapter.generateStream({
          systemPrompt: 'Hi',
          messages: [{ role: 'user', content: 'Hi' }],
        })) {}
      }).rejects.toThrow('DeepSeek Stream Error (503): Service Unavailable');

      fetchSpy.mockRestore();
    });
  });

  describe('Integração com LlmService Orchestrator', () => {
    it('resolveAdapter("deepseek") deve resolver adaptador deepseek', () => {
      const adapter = llmService.getAdapterByName('deepseek');
      expect(adapter).toBeDefined();
    });

    it('deve ter CircuitBreaker registrado para deepseek', () => {
      const breaker = llmService.getCircuitBreaker('deepseek');
      expect(breaker).toBeDefined();
      expect(breaker.name).toBe('deepseek');
    });
  });
});
