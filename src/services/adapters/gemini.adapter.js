const { GoogleGenerativeAI } = require('@google/generative-ai');
const BaseAiAdapter = require('./base.adapter');

class GeminiAdapter extends BaseAiAdapter {
  constructor() {
    super('gemini');
    const rawKey = process.env.GEMINI_API_KEY || '';
    this.apiKey = rawKey.replace(/^["']|["']$/g, '').trim();
    this.defaultModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.client = this.apiKey ? new GoogleGenerativeAI(this.apiKey) : null;
  }

  isAvailable() {
    return Boolean(this.apiKey && this.client);
  }

  async generate({ systemPrompt, messages = [], maxTokens = 500, temperature = 0.7, jsonMode = false, model }) {
    if (!this.isAvailable()) {
      throw new Error('GEMINI_API_KEY não configurada no ambiente.');
    }

    const modelName = model || this.defaultModel;
    const genModel = this.client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        responseMimeType: jsonMode ? 'application/json' : 'text/plain',
      },
    });

    // Converte formato de mensagens ({ role, content }) para o formato do Gemini
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const startTime = performance.now();
    const result = await genModel.generateContent({ contents });
    const durationMs = Math.round(performance.now() - startTime);

    const response = await result.response;
    const content = response.text();

    // Extrai tokens retornados nos metadados ou faz estimativa segura
    const usageMetadata = response.usageMetadata || {};
    const promptTokens = usageMetadata.promptTokenCount || Math.ceil((systemPrompt?.length || 0 + JSON.stringify(messages).length) / 4);
    const completionTokens = usageMetadata.candidatesTokenCount || Math.ceil(content.length / 4);
    const totalTokens = promptTokens + completionTokens;

    let parsedJson = null;
    if (jsonMode) {
      try {
        parsedJson = JSON.parse(content);
      } catch (err) {
        // Tenta extrair bloco markdown ```json ... ``` se presente
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          parsedJson = JSON.parse(jsonMatch[1]);
        }
      }
    }

    return {
      content,
      parsedJson,
      provider: 'gemini',
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
      throw new Error('GEMINI_API_KEY não configurada no ambiente.');
    }

    const modelName = model || this.defaultModel;
    const genModel = this.client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        responseMimeType: jsonMode ? 'application/json' : 'text/plain',
      },
    });

    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const startTime = performance.now();
    let ttftMs = null;
    let accumulatedText = '';

    const requestOptions = signal ? { signal } : {};
    const result = await genModel.generateContentStream({ contents }, requestOptions);

    for await (const chunk of result.stream) {
      if (signal?.aborted) {
        const abortErr = new Error('Generation aborted by client');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const text = chunk.text();
      if (text) {
        if (ttftMs === null) {
          ttftMs = Math.round(performance.now() - startTime);
        }
        accumulatedText += text;
        yield {
          text,
          isDone: false,
        };
      }
    }

    const durationMs = Math.round(performance.now() - startTime);
    let usageMetadata = {};
    try {
      const response = await result.response;
      usageMetadata = response.usageMetadata || {};
    } catch {}

    const promptTokens = usageMetadata.promptTokenCount || Math.ceil(((systemPrompt?.length || 0) + JSON.stringify(messages).length) / 4);
    const completionTokens = usageMetadata.candidatesTokenCount || Math.ceil(accumulatedText.length / 4);
    const totalTokens = promptTokens + completionTokens;

    yield {
      text: '',
      isDone: true,
      provider: 'gemini',
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

module.exports = GeminiAdapter;
