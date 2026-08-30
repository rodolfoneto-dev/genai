const BaseAiAdapter = require('./base.adapter');

/**
 * Adaptador para OpenCode Zen (https://opencode.ai/docs/pt-br/zen/)
 * Suporta modelos como Big Pickle (big-pickle) e outros via interface compatível com OpenAI.
 */
class OpencodeAdapter extends BaseAiAdapter {
  constructor() {
    super('opencode');
    const rawKey = process.env.OPENCODE_API_KEY || '';
    this.apiKey = rawKey.replace(/^["']|["']$/g, '').trim();
    this.baseUrl = (process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1').replace(/\/+$/, '');
    this.defaultModel = process.env.OPENCODE_MODEL || 'big-pickle';
  }

  isAvailable() {
    return Boolean(this.apiKey);
  }

  /**
   * Constrói a lista de mensagens no padrão OpenAI (system + histórico)
   */
  buildMessages(systemPrompt, messages = [], jsonMode = false) {
    const formatted = [];

    let effectiveSystem = systemPrompt || '';
    if (jsonMode && !effectiveSystem.includes('JSON')) {
      effectiveSystem += '\n\nIMPORTANT: Respond ONLY with a valid raw JSON object, without markdown code fences or conversational filler.';
    }

    if (effectiveSystem) {
      formatted.push({ role: 'system', content: effectiveSystem });
    }

    for (const m of messages) {
      formatted.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || '',
      });
    }

    return formatted;
  }

  /**
   * Chamada Unária (Compatível com OpenAI /v1/chat/completions)
   */
  async generate({ systemPrompt, messages = [], maxTokens = 500, temperature = 0.7, jsonMode = false, model, signal }) {
    if (!this.isAvailable()) {
      throw new Error('OPENCODE_API_KEY não configurada no ambiente.');
    }

    const modelName = model || this.defaultModel;
    const formattedMessages = this.buildMessages(systemPrompt, messages, jsonMode);

    const payload = {
      model: modelName,
      messages: formattedMessages,
      max_tokens: maxTokens,
      temperature,
    };

    if (jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    const startTime = performance.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      let errorJson = null;
      try { errorJson = JSON.parse(errorText); } catch {}
      const message = errorJson?.error?.message || errorText || `HTTP ${res.status}`;
      const error = new Error(`OpenCode Zen API Error (${res.status}): ${message}`);
      error.status = res.status;
      throw error;
    }

    const data = await res.json();
    const durationMs = Math.round(performance.now() - startTime);

    const content = data.choices?.[0]?.message?.content || '';
    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;
    const totalTokens = data.usage?.total_tokens || (promptTokens + completionTokens);

    let parsedJson = null;
    if (jsonMode) {
      try {
        parsedJson = JSON.parse(content);
      } catch (err) {
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          try {
            parsedJson = JSON.parse(jsonMatch[1]);
          } catch {}
        }
      }
    }

    return {
      content,
      parsedJson,
      provider: 'opencode',
      model: data.model || modelName,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      durationMs,
    };
  }

  /**
   * Chamada em Streaming via Server-Sent Events (SSE)
   */
  async *generateStream({ systemPrompt, messages = [], maxTokens = 500, temperature = 0.7, model, signal }) {
    if (!this.isAvailable()) {
      throw new Error('OPENCODE_API_KEY não configurada no ambiente.');
    }

    const modelName = model || this.defaultModel;
    const formattedMessages = this.buildMessages(systemPrompt, messages, false);

    const payload = {
      model: modelName,
      messages: formattedMessages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    };

    const startTime = performance.now();
    let ttftMs = null;
    let accumulatedText = '';
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      const error = new Error(`OpenCode Zen Stream Error (${res.status}): ${errorText}`);
      error.status = res.status;
      throw error;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Mantém linha incompleta no buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content || '';

            if (delta) {
              if (ttftMs === null) {
                ttftMs = Math.round(performance.now() - startTime);
              }
              accumulatedText += delta;
              yield { text: delta, isDone: false };
            }

            if (parsed.usage) {
              usage.promptTokens = parsed.usage.prompt_tokens || usage.promptTokens;
              usage.completionTokens = parsed.usage.completion_tokens || usage.completionTokens;
              usage.totalTokens = parsed.usage.total_tokens || (usage.promptTokens + usage.completionTokens);
            }
          } catch {
            // Linha com JSON malformado ou evento informativo
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }

    const durationMs = Math.round(performance.now() - startTime);
    if (!usage.totalTokens) {
      usage.promptTokens = Math.round(formattedMessages.reduce((acc, m) => acc + (m.content.length / 4), 0));
      usage.completionTokens = Math.round(accumulatedText.length / 4);
      usage.totalTokens = usage.promptTokens + usage.completionTokens;
    }

    yield {
      text: '',
      isDone: true,
      provider: 'opencode',
      model: modelName,
      usage,
      durationMs,
      ttftMs: ttftMs || durationMs,
    };
  }
}

module.exports = OpencodeAdapter;
