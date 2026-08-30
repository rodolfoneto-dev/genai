const request = require('supertest');
const { app } = require('../server');
const usageEventBus = require('./usage-event-bus');
const AiUsageLog = require('../models/AiUsageLog');
const UserQuota = require('../models/UserQuota');
const { redactSecrets, sanitizeLogPayload } = require('../utils/sanitizer');

describe('GenAI Service - Observability, FinOps & Event Bus (Epic 4)', () => {
  describe('Story 4.1: Asynchronous Usage Event Bus & Worker', () => {
    it('dispatch deve emitir evento usage.logged e persistir log e quota em background', async () => {
      const logSpy = jest.spyOn(AiUsageLog, 'logUsage').mockResolvedValue({});
      const quotaSpy = jest.spyOn(UserQuota, 'consumeTokens').mockResolvedValue({});

      usageEventBus.dispatch({
        userId: 'student_async_event',
        role: 'aluno',
        feature: 'tutor',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        durationMs: 400,
        cefrLevel: 'B1',
      });

      // Aguarda processamento das tarefas no event bus
      await usageEventBus.drain();

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'student_async_event',
          feature: 'tutor',
          totalTokens: 150,
        })
      );
      expect(quotaSpy).toHaveBeenCalledTimes(1);
      expect(quotaSpy).toHaveBeenCalledWith('student_async_event', 150);

      logSpy.mockRestore();
      quotaSpy.mockRestore();
    });
  });

  describe('Story 4.2: Correlation ID & Distributed Tracing Headers', () => {
    it('deve gerar cabeçalho X-Request-ID em respostas quando não fornecido', async () => {
      const res = await request(app).get('/genai/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('deve propagar X-Request-ID fornecido na requisição', async () => {
      const customId = 'req-trace-custom-uuid-12345';
      const res = await request(app)
        .get('/genai/health')
        .set('X-Request-ID', customId);

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('deve propagar cabeçalho traceparent quando fornecido', async () => {
      const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const res = await request(app)
        .get('/genai/health')
        .set('traceparent', traceparent);

      expect(res.status).toBe(200);
      expect(res.headers['traceparent']).toBe(traceparent);
    });
  });

  describe('Story 4.3: Telemetry PII Redaction & Prompt Sanitization', () => {
    it('redactSecrets deve mascarar chaves Google Gemini e Anthropic Claude', () => {
      const textWithGemini = 'Error calling https://generativelanguage.googleapis.com with key AIzaSyA1234567890123456789012345678901';
      const textWithClaude = 'Error calling https://api.anthropic.com with key sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
      const textWithBearer = 'Authorization failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID';

      expect(redactSecrets(textWithGemini)).toContain('[REDACTED_GEMINI_KEY]');
      expect(redactSecrets(textWithClaude)).toContain('[REDACTED_ANTHROPIC_KEY]');
      expect(redactSecrets(textWithBearer)).toContain('Bearer [REDACTED_JWT]');
    });

    it('sanitizeLogPayload deve ocultar prompts e mensagens de redação quando em produção', () => {
      const payload = {
        userId: 'student_privacy',
        message: 'This is my private personal statement for college admission.',
        text: 'Private student essay text with sensitive thoughts.',
        totalTokens: 120,
      };

      const sanitized = sanitizeLogPayload(payload, true); // forceRedactPrompt = true
      expect(sanitized.message).toBe('[REDACTED_USER_MESSAGE]');
      expect(sanitized.text).toBe('[REDACTED_ESSAY_TEXT]');
      expect(sanitized.totalTokens).toBe(120); // Metadados quantitativos FinOps preservados
    });
  });

  describe('Story 4.4: Multi-Dimensional FinOps Analytics & Cost Attribution', () => {
    it('getFinOpsAnalytics deve agrupar dados e retornar estrutura com overview, byFeature, byProvider e topConsumers', async () => {
      const result = await AiUsageLog.getFinOpsAnalytics({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });

      expect(result).toHaveProperty('overview');
      expect(result).toHaveProperty('byFeature');
      expect(result).toHaveProperty('byProvider');
      expect(result).toHaveProperty('topConsumers');
    });
  });
});
