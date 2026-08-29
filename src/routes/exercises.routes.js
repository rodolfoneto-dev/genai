const express = require('express');
const { z } = require('zod');
const { authenticate, checkRole } = require('../middlewares/auth');
const { apiRateLimiter, checkAiQuota } = require('../middlewares/quota');
const llmService = require('../services/llm.service');
const { getExerciseGenerationPrompt } = require('../services/prompt-templates');
const exerciseCache = require('../services/exercise-cache.service');
const AiUsageLog = require('../models/AiUsageLog');
const UserQuota = require('../models/UserQuota');
const usageEventBus = require('../services/usage-event-bus');

const router = express.Router();

const ExerciseGenerateInputSchema = z.object({
  topic: z.string().min(3, 'Tópico deve ter no mínimo 3 caracteres').max(100, 'Tópico muito longo (máx 100 caracteres)'),
  cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional().default('B1'),
  count: z.number().int().min(1, 'Mínimo de 1 exercício').max(10, 'Máximo de 10 exercícios por chamada').optional().default(3),
  type: z.enum(['multiple_choice', 'fill_in_the_blank', 'mixed']).optional().default('mixed'),
});

/**
 * POST /genai/exercises/generate
 * Geração sob demanda de exercícios pedagógicos para o catálogo ou aulas.
 * Restrito nesta v1 a: Professor e Admin.
 * 
 * NOTA DE ARQUITETURA:
 * Quando houver jobs assíncronos em background, a role 'system' será permitida aqui.
 */
router.post('/generate', apiRateLimiter, authenticate, checkRole('professor', 'admin'), checkAiQuota(600), async (req, res, next) => {
  try {
    const parseResult = ExerciseGenerateInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Parâmetros inválidos para geração de exercícios.',
          details: parseResult.error.flatten().fieldErrors,
        },
      });
    }

    const { topic, cefrLevel, count, type } = parseResult.data;
    const userId = req.user.id;

    // 1. Checagem de Cache Semântico (FinOps $0)
    const cachedData = await exerciseCache.get(topic, cefrLevel, count, type);
    if (cachedData) {
      return res.status(200).json({
        data: cachedData,
        cached: true,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
    }

    // 2. Gera exercícios via LLM estruturado
    const systemPrompt = getExerciseGenerationPrompt(topic, cefrLevel, count, type);
    const aiResponse = await llmService.generate({
      systemPrompt,
      messages: [{ role: 'user', content: `Please create ${count} ${type} exercises for topic: "${topic}" at level ${cefrLevel}.` }],
      maxTokens: 600, // Limite FinOps
      temperature: 0.5,
      jsonMode: true,
    });

    const exercisesPayload = aiResponse.parsedJson || {
      topic,
      cefrLevel,
      totalGenerated: count,
      exercises: [],
    };

    // Salva no cache
    await exerciseCache.set(topic, cefrLevel, count, type, exercisesPayload);

    // 2. Registra uso e debita quota de forma assíncrona
    usageEventBus.dispatch({
      userId,
      role: req.user.role,
      feature: 'exercise_generation',
      provider: aiResponse.provider,
      model: aiResponse.model,
      promptTokens: aiResponse.usage?.promptTokens || 0,
      completionTokens: aiResponse.usage?.completionTokens || 0,
      totalTokens: aiResponse.usage?.totalTokens || 0,
      durationMs: aiResponse.durationMs || 0,
      cefrLevel,
      metadata: { topic, count, type },
    });

    return res.status(200).json({
      data: exercisesPayload,
      usage: aiResponse.usage,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
