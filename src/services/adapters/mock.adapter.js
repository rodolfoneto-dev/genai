const BaseAiAdapter = require('./base.adapter');

class MockAiAdapter extends BaseAiAdapter {
  constructor(providerName = 'gemini') {
    super('mock');
    this.providerName = providerName;
    this.failureConfig = null;
  }

  isAvailable() {
    return true;
  }

  simulateFailure(error, count = 1) {
    this.failureConfig = { error, count, attempts: 0 };
  }

  clearFailure() {
    this.failureConfig = null;
  }

  async generate({ systemPrompt = '', messages = [], maxTokens = 500, jsonMode = false }) {
    if (this.failureConfig && this.failureConfig.attempts < this.failureConfig.count) {
      this.failureConfig.attempts++;
      throw this.failureConfig.error;
    }

    const lastUserMessage = messages.filter((m) => m.role === 'user').pop()?.content || '';
    const durationMs = 15;

    // Resposta Mock para Tutor
    if (systemPrompt.includes('TUTOR') || !jsonMode) {
      const mockReply = `Hello! That's a great observation about "${lastUserMessage.slice(0, 30)}". How often do you practice this in English?`;
      return {
        content: mockReply,
        parsedJson: null,
        provider: this.providerName,
        model: `${this.providerName}-mock`,
        usage: {
          promptTokens: 45,
          completionTokens: 35,
          totalTokens: 80,
        },
        durationMs,
      };
    }

    // Resposta Mock para Correção de Redação (JSON Mode)
    if (systemPrompt.includes('CORRECTION') || systemPrompt.includes('ESSAY')) {
      const mockCorrection = {
        overallScore: 8.5,
        cefrLevel: 'B2',
        summary: 'Ótimo texto, com boa estrutura de frases e vocabulário natural.',
        grammarErrors: [
          {
            original: 'I has been studying',
            corrected: 'I have been studying',
            explanation: 'Utilize "have" com o pronome "I" no Present Perfect Continuous.',
          },
        ],
        vocabularySuggestions: [
          {
            original: 'very good',
            suggestion: 'exceptional / remarkable',
            context: 'Para maior sofisticação na escrita.',
          },
        ],
        revisedText: 'I have been studying English for two years and it has been an exceptional journey.',
      };

      return {
        content: JSON.stringify(mockCorrection),
        parsedJson: mockCorrection,
        provider: 'gemini',
        model: 'gemini-2.5-flash-mock',
        usage: {
          promptTokens: 120,
          completionTokens: 140,
          totalTokens: 260,
        },
        durationMs,
      };
    }

    // Resposta Mock para Geração de Exercícios (JSON Mode)
    const mockExercises = {
      topic: 'Simple Past vs Present Perfect',
      cefrLevel: 'B1',
      totalGenerated: 3,
      exercises: [
        {
          id: 1,
          type: 'multiple_choice',
          question: 'She _____ to London last summer.',
          options: ['has gone', 'went', 'goes', 'going'],
          correctAnswer: 'went',
          explanation: 'Usamos Simple Past (went) porque o tempo é específico (last summer).',
        },
        {
          id: 2,
          type: 'fill_in_the_blank',
          question: 'I have _____ (live) in São Paulo for 5 years.',
          correctAnswer: 'lived',
          explanation: 'O particípio passado do verbo live é lived.',
        },
        {
          id: 3,
          type: 'multiple_choice',
          question: '_____ you ever visited the United States?',
          options: ['Did', 'Have', 'Do', 'Are'],
          correctAnswer: 'Have',
          explanation: 'Para experiências de vida sem tempo definido, usamos Present Perfect com Have.',
        },
      ],
    };

    return {
      content: JSON.stringify(mockExercises),
      parsedJson: mockExercises,
      provider: 'gemini',
      model: 'gemini-2.5-flash-mock',
      usage: {
        promptTokens: 110,
        completionTokens: 180,
        totalTokens: 290,
      },
      durationMs,
    };
  }

  async *generateStream({ systemPrompt = '', messages = [], maxTokens = 500, signal = null }) {
    if (signal?.aborted) {
      const abortErr = new Error('Generation aborted by client');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    if (this.failureConfig && this.failureConfig.attempts < this.failureConfig.count) {
      this.failureConfig.attempts++;
      throw this.failureConfig.error;
    }

    const lastUserMessage = messages.filter((m) => m.role === 'user').pop()?.content || '';
    const fullText = `Hello! That's a great observation about "${lastUserMessage.slice(0, 30)}". How often do you practice this in English?`;
    
    // Divide a mensagem em 4 chunks para simular streaming realista
    const words = fullText.split(' ');
    const chunks = [];
    const chunkSize = Math.ceil(words.length / 4);
    for (let i = 0; i < words.length; i += chunkSize) {
      const chunkWords = words.slice(i, i + chunkSize).join(' ');
      chunks.push(i === 0 ? chunkWords : ' ' + chunkWords);
    }

    const startTime = performance.now();
    let ttftMs = null;

    for (let i = 0; i < chunks.length; i++) {
      if (signal?.aborted) {
        const abortErr = new Error('Generation aborted by client');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      if (i === 0) {
        ttftMs = Math.round(performance.now() - startTime);
      }

      yield {
        text: chunks[i],
        isDone: false,
      };
    }

    const durationMs = Math.round(performance.now() - startTime);
    const promptTokens = 45;
    const completionTokens = 35;

    yield {
      text: '',
      isDone: true,
      provider: this.providerName,
      model: `${this.providerName}-mock`,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      durationMs,
      ttftMs: ttftMs || durationMs,
    };
  }
}

module.exports = MockAiAdapter;
