const llmService = require('./llm.service');
const {
  getTutorPrompt,
  getEssayCorrectionPrompt,
  getExerciseGenerationPrompt,
  CEFR_GUIDELINES,
} = require('./prompt-templates');

describe('GenAI Service - LLM Engine & Prompt Templates Unit Tests', () => {
  describe('Prompt Templates', () => {
    it('getTutorPrompt deve incluir o nível CEFR e tópico', () => {
      const prompt = getTutorPrompt('B2', 'Job Interviews in Tech');
      expect(prompt).toContain('CEFR B2');
      expect(prompt).toContain('Job Interviews in Tech');
      expect(prompt).toContain('Speak 100% in English');
    });

    it('getEssayCorrectionPrompt deve conter diretrizes de JSON e avaliação', () => {
      const prompt = getEssayCorrectionPrompt('B1');
      expect(prompt).toContain('UP!EXPERIENCE ESSAY EVALUATOR');
      expect(prompt).toContain('overallScore');
      expect(prompt).toContain('grammarErrors');
      expect(prompt).toContain('revisedText');
    });

    it('getExerciseGenerationPrompt deve incluir tipo e quantidade solicitada', () => {
      const prompt = getExerciseGenerationPrompt('Phrasal Verbs', 'B2', 5, 'multiple_choice');
      expect(prompt).toContain('Phrasal Verbs');
      expect(prompt).toContain('Exactly 5 exercises');
      expect(prompt).toContain('multiple_choice');
    });
  });

  describe('LLM Service (Adapter Orchestration)', () => {
    it('deve usar o MockAiAdapter em ambiente de teste e responder para o Tutor', async () => {
      const res = await llmService.generate({
        systemPrompt: getTutorPrompt('B1', 'Travel'),
        messages: [{ role: 'user', content: 'I want to travel to London next week.' }],
        maxTokens: 300,
      });

      expect(res.content).toBeDefined();
      expect(res.provider).toBe('gemini');
      expect(res.usage.totalTokens).toBeGreaterThan(0);
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('deve gerar e fazer parse de JSON estruturado para Correção de Redação', async () => {
      const res = await llmService.generate({
        systemPrompt: getEssayCorrectionPrompt('B2'),
        messages: [{ role: 'user', content: 'I has been studying English for two years...' }],
        jsonMode: true,
      });

      expect(res.parsedJson).toBeDefined();
      expect(res.parsedJson.overallScore).toBe(8.5);
      expect(res.parsedJson.cefrLevel).toBe('B2');
      expect(Array.isArray(res.parsedJson.grammarErrors)).toBe(true);
      expect(res.parsedJson.grammarErrors[0].original).toBe('I has been studying');
    });

    it('deve gerar e fazer parse de JSON para Exercícios', async () => {
      const res = await llmService.generate({
        systemPrompt: getExerciseGenerationPrompt('Simple Past', 'B1', 3),
        messages: [{ role: 'user', content: 'Generate exercises please' }],
        jsonMode: true,
      });

      expect(res.parsedJson).toBeDefined();
      expect(res.parsedJson.totalGenerated).toBe(3);
      expect(res.parsedJson.exercises.length).toBe(3);
      expect(res.parsedJson.exercises[0].correctAnswer).toBe('went');
    });

    it('deve realizar streaming de tokens via generateStream com TTFT e chunks normalizados', async () => {
      const chunks = [];
      let finalChunk = null;

      for await (const chunk of llmService.generateStream({
        systemPrompt: getTutorPrompt('B1', 'Travel'),
        messages: [{ role: 'user', content: 'Tell me about London' }],
      })) {
        if (!chunk.isDone) {
          chunks.push(chunk);
        } else {
          finalChunk = chunk;
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].text).toBeDefined();
      expect(finalChunk).toBeDefined();
      expect(finalChunk.isDone).toBe(true);
      expect(finalChunk.usage.totalTokens).toBeGreaterThan(0);
      expect(finalChunk.ttftMs).toBeGreaterThanOrEqual(0);
    });

    it('deve abortar geração em stream quando signal for disparado', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(async () => {
        for await (const _ of llmService.generateStream({
          systemPrompt: getTutorPrompt('B1', 'Travel'),
          messages: [{ role: 'user', content: 'Test abort' }],
          signal: controller.signal,
        })) {}
      }).rejects.toThrow('Generation aborted by client');
    });
  });

  describe('Story 3.2: Distributed ExerciseCacheService', () => {
    const exerciseCache = require('./exercise-cache.service');

    beforeEach(async () => {
      await exerciseCache.clear();
    });

    it('deve gerar chave formatada com prefixo genai:exercise:', () => {
      const key = exerciseCache.generateKey('Simple Past', 'A2', 5, 'multiple_choice');
      expect(key).toBe('genai:exercise:simple-past:A2:5:multiple_choice');
    });

    it('deve gravar e recuperar do cache reduzindo latência e custo a zero', async () => {
      const mockPayload = {
        topic: 'Travel',
        cefrLevel: 'B1',
        totalGenerated: 2,
        exercises: [{ id: 1, question: 'Where did you go?' }],
      };

      await exerciseCache.set('Travel', 'B1', 2, 'multiple_choice', mockPayload);

      const cached = await exerciseCache.get('Travel', 'B1', 2, 'multiple_choice');
      expect(cached).toEqual(mockPayload);

      // Miss em tópico não cacheado
      const miss = await exerciseCache.get('Cooking', 'B1', 2, 'multiple_choice');
      expect(miss).toBeNull();
    });

    it('clear() deve invalidar todos os itens armazenados', async () => {
      await exerciseCache.set('Grammar', 'B2', 3, 'fill_in_the_blank', { test: true });
      await exerciseCache.clear();

      const cached = await exerciseCache.get('Grammar', 'B2', 3, 'fill_in_the_blank');
      expect(cached).toBeNull();
    });
  });
});
