const Anthropic = require('@anthropic-ai/sdk');
const BaseAiAdapter = require('./base.adapter');

class ClaudeAdapter extends BaseAiAdapter {
  constructor() {
    super('claude');
    const rawKey = process.env.ANTHROPIC_API_KEY || '';
    this.apiKey = rawKey.replace(/^["']|["']$/g, '').trim();
    this.defaultModel = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';
    this.client = this.apiKey ? new Anthropic({ apiKey: this.apiKey }) : null;
  }

  isAvailable() {
    return Boolean(this.apiKey && this.client);
  }

  async generate({ systemPrompt, messages = [], maxTokens = 500, temperature = 0.7, jsonMode = false, model }) {
    if (!this.isAvailable()) {
      throw new Error('ANTHROPIC_API_KEY não configurada no ambiente.');
    }

    const modelName = model || this.defaultModel;

    // Filtra histórico para garantir alternância válida user / assistant
    const formattedMessages = messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    // Se jsonMode estiver ativo, reforça no system prompt
    let effectiveSystem = systemPrompt || '';
    if (jsonMode && !effectiveSystem.includes('JSON')) {
      effectiveSystem += '\n\nIMPORTANT: Respond ONLY with a valid raw JSON object, without markdown code fences or conversational greetings.';
    }

    const startTime = performance.now();
    const response = await this.client.messages.create({
      model: modelName,
      max_tokens: maxTokens,
      temperature,
      system: effectiveSystem,
      messages: formattedMessages,
    });
    const durationMs = Math.round(performance.now() - startTime);

    const content = response.content[0]?.text || '';
    const promptTokens = response.usage?.input_tokens || 0;
    const completionTokens = response.usage?.output_tokens || 0;
    const totalTokens = promptTokens + completionTokens;

    let parsedJson = null;
    if (jsonMode) {
      try {
        parsedJson = JSON.parse(content);
      } catch (err) {
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          parsedJson = JSON.parse(jsonMatch[1]);
        }
      }
    }

    return {
      content,
      parsedJson,
      provider: 'claude',
      model: modelName,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      durationMs,
    };
  }

  async *generateStream({ systemPrompt, messages = [], maxTokens = 500, temperature = 0.7, jsonMode = false, model, signal = null }) {
    if (!this.isAvailable()) {
      throw new Error('ANTHROPIC_API_KEY não configurada no ambiente.');
    }

    const modelName = model || this.defaultModel;
    const formattedMessages = messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    let effectiveSystem = systemPrompt || '';
    if (jsonMode && !effectiveSystem.includes('JSON')) {
      effectiveSystem += '\n\nIMPORTANT: Respond ONLY with a valid raw JSON object, without markdown code fences or conversational greetings.';
    }

    const startTime = performance.now();
    let ttftMs = null;

    const requestOptions = signal ? { signal } : {};
    const stream = this.client.messages.stream({
      model: modelName,
      max_tokens: maxTokens,
      temperature,
      system: effectiveSystem,
      messages: formattedMessages,
    }, requestOptions);

    for await (const text of stream.textStream) {
      if (signal?.aborted) {
        try { stream.abort(); } catch {}
        const abortErr = new Error('Generation aborted by client');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      if (text) {
        if (ttftMs === null) {
          ttftMs = Math.round(performance.now() - startTime);
        }
        yield {
          text,
          isDone: false,
        };
      }
    }

    const durationMs = Math.round(performance.now() - startTime);
    let finalMessage = null;
    try {
      finalMessage = await stream.finalMessage();
    } catch {}

    const promptTokens = finalMessage?.usage?.input_tokens || 0;
    const completionTokens = finalMessage?.usage?.output_tokens || 0;
    const totalTokens = promptTokens + completionTokens;

    yield {
      text: '',
      isDone: true,
      provider: 'claude',
      model: modelName,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      durationMs,
      ttftMs: ttftMs || durationMs,
    };
  }
}

module.exports = ClaudeAdapter;
