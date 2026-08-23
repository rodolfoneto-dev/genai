const Anthropic = require('@anthropic-ai/sdk');
const BaseAiAdapter = require('./base.adapter');

class ClaudeAdapter extends BaseAiAdapter {
  constructor() {
    super('claude');
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
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
}

module.exports = ClaudeAdapter;
