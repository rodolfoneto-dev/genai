const express = require('express');
const { z } = require('zod');
const { authenticate, checkRole } = require('../middlewares/auth');
const { apiRateLimiter, checkAiQuota } = require('../middlewares/quota');
const llmService = require('../services/llm.service');
const { getEssayCorrectionPrompt } = require('../services/prompt-templates');
const AiUsageLog = require('../models/AiUsageLog');
const UserQuota = require('../models/UserQuota');
const usageEventBus = require('../services/usage-event-bus');

const router = express.Router();

const EssayInputSchema = z.object({
  text: z.string().min(10, 'O texto deve conter pelo menos 10 caracteres').max(3000, 'Texto muito longo (máx 3000 caracteres)'),
  cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional().default('B1'),
});

/**
 * POST /genai/correction/essay
 * Correção gramatical, vocabulário e avaliação pedagógica de redações e parágrafos.
 * Acessível por: Aluno e Professor.
 */
router.post('/essay', apiRateLimiter, authenticate, checkRole('aluno', 'professor'), checkAiQuota(700), async (req, res, next) => {
  try {
    const parseResult = EssayInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Texto inválido para correção.',
          details: parseResult.error.flatten().fieldErrors,
        },
      });
    }

    const { text, cefrLevel } = parseResult.data;
    const userId = req.user.id;

    // 1. Executa avaliação com JSON Mode
    const systemPrompt = getEssayCorrectionPrompt(cefrLevel);
    const aiResponse = await llmService.generate({
      systemPrompt,
      messages: [{ role: 'user', content: `Student Essay/Text:\n"""\n${text}\n"""` }],
      maxTokens: 700, // Limite para correções completas
      temperature: 0.3, // Menor temperatura para maior precisão gramatical
      jsonMode: true,
    });

    const correctionData = aiResponse.parsedJson || {
      overallScore: 8.0,
      cefrLevel,
      summary: aiResponse.content,
      grammarErrors: [],
      vocabularySuggestions: [],
      revisedText: text,
    };

    // 2. Registra uso e debita quota de forma assíncrona
    usageEventBus.dispatch({
      userId,
      role: req.user.role,
      feature: 'correction',
      provider: aiResponse.provider,
      model: aiResponse.model,
      promptTokens: aiResponse.usage?.promptTokens || 0,
      completionTokens: aiResponse.usage?.completionTokens || 0,
      totalTokens: aiResponse.usage?.totalTokens || 0,
      durationMs: aiResponse.durationMs || 0,
      cefrLevel,
    });

    return res.status(200).json({
      correction: correctionData,
      usage: aiResponse.usage,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
