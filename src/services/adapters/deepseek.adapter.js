const BaseAiAdapter = require('./base.adapter');

/**
 * Adaptador para DeepSeek (https://api.deepseek.com)
 * Suporta modelos DeepSeek V3/V4 (deepseek-chat, deepseek-v4-flash, deepseek-v4-pro)
 * e modelos de raciocínio (deepseek-reasoner) via interface compatível com OpenAI.
 */
class DeepseekAdapter extends BaseAiAdapter {
  constructor() {
    super('deepseek');
    const rawKey = process.env.DEEPSEEK_API_KEY || '';
    this.apiKey = rawKey.replace(/^["']|["']$/g, '').trim();
    this.baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    this.defaultModel = this.normalizeModelName(process.env.DEEPSEEK_MODEL || 'deepseek-chat');
  }

  /**
   * Normaliza nomes curtos de modelos para o identificador oficial aceito pela API
   * @param {string} model
   * @returns {string}
   */
  normalizeModelName(model) {
    if (!model) return 'deepseek-chat';
    const trimmed = model.replace(/^["']|["']$/g, '').trim();
    if (trimmed === 'v4-flash') return 'deepseek-v4-flash';
    if (trimmed === 'v4-pro') return 'deepseek-v4-pro';
    if (trimmed === 'v4-flash-vision-exp') return 'deepseek-v4-flash-vision-exp';
    if (trimmed === 'chat') return 'deepseek-chat';
    if (trimmed === 'reasoner') return 'deepseek-reasoner';
    return trimmed;
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
    if (jsonMode && !effectiveSystem.toLowerCase().includes('json')) {
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
   * Chamada Unária (Compatível com OpenAI /chat/completions)
   */
  async generate({ systemPrompt, messages = [], maxTokens = 500, temperature = 0.7, jsonMode = false, model, signal }) {
    if (!this.isAvailable()) {
      throw new Error('DEEPSEEK_API_KEY não configurada no ambiente.');
    }

    const modelName = this.normalizeModelName(model || this.defaultModel);
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
    const endpoint = `${this.baseUrl}/chat/completions`;

    const res = await fetch(endpoint, {
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
      const error = new Error(`DeepSeek API Error (${res.status}): ${message}`);
      error.status = res.status;
      throw error;
    }

    const data = await res.json();
    const durationMs = Math.round(performance.now() - startTime);

    const choice = data.choices?.[0]?.message;
    const content = choice?.content || '';
    const reasoningContent = choice?.reasoning_content || null;
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
      provider: 'deepseek',
      model: data.model || modelName,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      durationMs,
      ...(reasoningContent ? { reasoningContent } : {}),
    };
  }

  /**
   * Chamada em Streaming via Server-Sent Events (SSE)
   */
  async *generateStream({ systemPrompt, messages = [], maxTokens = 500, temperature = 0.7, jsonMode = false, model, signal }) {
    if (!this.isAvailable()) {
      throw new Error('DEEPSEEK_API_KEY não configurada no ambiente.');
    }

    const modelName = this.normalizeModelName(model || this.defaultModel);
    const formattedMessages = this.buildMessages(systemPrompt, messages, jsonMode);

    const payload = {
      model: modelName,
      messages: formattedMessages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    const startTime = performance.now();
    let ttftMs = null;
    let accumulatedText = '';
    let accumulatedReasoning = '';
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const endpoint = `${this.baseUrl}/chat/completions`;

    const res = await fetch(endpoint, {
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
      const error = new Error(`DeepSeek Stream Error (${res.status}): ${message}`);
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
            const delta = parsed.choices?.[0]?.delta;
            const contentChunk = delta?.content || '';
            const reasoningChunk = delta?.reasoning_content || '';

            if (reasoningChunk) {
              accumulatedReasoning += reasoningChunk;
            }

            if (contentChunk) {
              if (ttftMs === null) {
                ttftMs = Math.round(performance.now() - startTime);
              }
              accumulatedText += contentChunk;
              yield { text: contentChunk, isDone: false };
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
      provider: 'deepseek',
      model: modelName,
      usage,
      durationMs,
      ttftMs: ttftMs || durationMs,
      ...(accumulatedReasoning ? { reasoningContent: accumulatedReasoning } : {}),
    };
  }
}

module.exports = DeepseekAdapter;
