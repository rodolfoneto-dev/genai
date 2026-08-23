const express = require('express');
const { z } = require('zod');
const { authenticate, checkRole } = require('../middlewares/auth');
const { apiRateLimiter, checkAiQuota } = require('../middlewares/quota');
const llmService = require('../services/llm.service');
const { getTutorPrompt } = require('../services/prompt-templates');
const TutorSession = require('../models/TutorSession');
const AiUsageLog = require('../models/AiUsageLog');
const UserQuota = require('../models/UserQuota');

const router = express.Router();

const ChatInputSchema = z.object({
  message: z.string().min(1, 'A mensagem não pode estar vazia').max(1000, 'Mensagem muito longa (máx 1000 caracteres)'),
  cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional().default('B1'),
  topic: z.string().max(120).optional().default('General Daily English'),
});

/**
 * POST /genai/tutor/chat
 * Conversa interativa com o tutor Fox.
 * Acessível por: Aluno e Professor.
 */
router.post('/chat', apiRateLimiter, authenticate, checkRole('aluno', 'professor'), checkAiQuota(300), async (req, res, next) => {
  try {
    const parseResult = ChatInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados de entrada inválidos para o chat do tutor.',
          details: parseResult.error.flatten().fieldErrors,
        },
      });
    }

    const { message, cefrLevel, topic } = parseResult.data;
    const userId = req.user.id;

    // 1. Recupera ou cria a sessão ativa
    let session = null;
    try {
      session = await TutorSession.getActiveSession(userId, cefrLevel, topic);
    } catch {
      // Se o banco não estiver disponível, cria sessão volátil em memória
      session = new TutorSession({ userId, cefrLevel, topic, messages: [] });
    }

    // 2. Prepara o histórico recente para o contexto da LLM
    const history = session.getSanitizedHistory ? session.getSanitizedHistory() : [];
    history.push({ role: 'user', content: message });

    // 3. Executa chamada de IA com prompt pedagógico
    const systemPrompt = getTutorPrompt(session.cefrLevel || cefrLevel, session.topic || topic);
    const aiResponse = await llmService.generate({
      systemPrompt,
      messages: history,
      maxTokens: 300, // Limite estrito FinOps
      temperature: 0.7,
    });

    // 4. Salva a resposta no histórico da sessão
    if (session.appendMessage) {
      session.appendMessage('user', message);
      session.appendMessage('assistant', aiResponse.content);
      try {
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState === 1) {
          await session.save();
        }
      } catch {}
    }

    // 5. Registra log de uso e debita quota em background
    try {
      await Promise.all([
        AiUsageLog.logUsage({
          userId,
          role: req.user.role,
          feature: 'tutor',
          provider: aiResponse.provider,
          model: aiResponse.model,
          promptTokens: aiResponse.usage?.promptTokens || 0,
          completionTokens: aiResponse.usage?.completionTokens || 0,
          durationMs: aiResponse.durationMs || 0,
          cefrLevel,
        }),
        UserQuota.consumeTokens(userId, aiResponse.usage?.totalTokens || 0),
      ]);
    } catch {}

    return res.status(200).json({
      reply: aiResponse.content,
      session: {
        id: session._id || 'temp_session',
        cefrLevel: session.cefrLevel,
        topic: session.topic,
        totalMessages: session.messages?.length || 2,
      },
      usage: aiResponse.usage,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
