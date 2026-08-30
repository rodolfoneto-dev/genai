const express = require('express');
const { z } = require('zod');
const { authenticate, checkRole } = require('../middlewares/auth');
const { apiRateLimiter, checkAiQuota } = require('../middlewares/quota');
const llmService = require('../services/llm.service');
const { getTutorPrompt } = require('../services/prompt-templates');
const TutorSession = require('../models/TutorSession');
const AiUsageLog = require('../models/AiUsageLog');
const UserQuota = require('../models/UserQuota');
const usageEventBus = require('../services/usage-event-bus');

const router = express.Router();

const ChatInputSchema = z.object({
  message: z.string().min(1, 'A mensagem não pode estar vazia').max(1000, 'Mensagem muito longa (máx 1000 caracteres)'),
  cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional().default('B1'),
  topic: z.string().max(120).optional().default('General Daily English'),
});

/**
 * GET /genai/tutor/history
 * Recupera o histórico de mensagens da sessão ativa para o tópico selecionado.
 * Acessível por: Aluno e Professor.
 */
router.get('/history', authenticate, checkRole('aluno', 'professor'), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const topic = (req.query.topic && String(req.query.topic).trim()) || 'General Daily English';
    const cefrLevel = (req.query.cefrLevel && String(req.query.cefrLevel).trim()) || 'B1';

    let session = null;
    try {
      session = await TutorSession.getActiveSession(userId, cefrLevel, topic);
    } catch {
      session = new TutorSession({ userId, cefrLevel, topic, messages: [] });
    }

    return res.status(200).json({
      sessionId: session._id || 'temp_session',
      cefrLevel: session.cefrLevel || cefrLevel,
      topic: session.topic || topic,
      totalMessages: session.messages ? session.messages.length : 0,
      messages: session.messages || [],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /genai/tutor/chat
 * Conversa interativa com o tutor UP!.
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
      maxTokens: Number(process.env.TUTOR_MAX_TOKENS) || 800, // Limite FinOps adaptado para modelos com raciocínio
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

    // 5. Registra log de uso e debita quota de forma assíncrona via barramento de eventos
    usageEventBus.dispatch({
      userId,
      role: req.user.role,
      feature: 'tutor',
      provider: aiResponse.provider,
      model: aiResponse.model,
      promptTokens: aiResponse.usage?.promptTokens || 0,
      completionTokens: aiResponse.usage?.completionTokens || 0,
      totalTokens: aiResponse.usage?.totalTokens || 0,
      durationMs: aiResponse.durationMs || 0,
      cefrLevel,
    });

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

/**
 * POST /genai/tutor/chat/stream
 * Conversa interativa com o tutor UP! com resposta progressiva via Server-Sent Events (SSE).
 * Acessível por: Aluno e Professor.
 */
router.post('/chat/stream', apiRateLimiter, authenticate, checkRole('aluno', 'professor'), checkAiQuota(300), async (req, res, next) => {
  const abortController = new AbortController();
  let keepAliveTimer = null;

  // Detecta desconexão do cliente para abortar upstream imediatamente
  req.on('close', () => {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

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
      session = new TutorSession({ userId, cefrLevel, topic, messages: [] });
    }

    // 2. Prepara o histórico recente para o contexto da LLM
    const history = session.getSanitizedHistory ? session.getSanitizedHistory() : [];
    history.push({ role: 'user', content: message });

    // 3. Configura Headers SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    // 4. Envia evento de início (start)
    res.write(`event: start\ndata: ${JSON.stringify({
      sessionId: session._id || 'temp_session',
      cefrLevel: session.cefrLevel || cefrLevel,
      topic: session.topic || topic,
    })}\n\n`);

    // 5. Inicia heartbeat keep-alive a cada 15 segundos para evitar timeout de proxy
    keepAliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(':keepalive\n\n');
      }
    }, 15000);

    // 6. Consome o stream do provedor de IA
    const systemPrompt = getTutorPrompt(session.cefrLevel || cefrLevel, session.topic || topic);
    let fullContent = '';
    let finalChunk = null;

    for await (const chunk of llmService.generateStream({
      systemPrompt,
      messages: history,
      maxTokens: Number(process.env.TUTOR_MAX_TOKENS) || 800,
      temperature: 0.7,
      signal: abortController.signal,
    })) {
      if (!chunk.isDone) {
        fullContent += chunk.text;
        res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`);
      } else {
        finalChunk = chunk;
      }
    }

    if (keepAliveTimer) clearInterval(keepAliveTimer);

    // 7. Salva a resposta no histórico da sessão
    if (session.appendMessage) {
      session.appendMessage('user', message);
      session.appendMessage('assistant', fullContent);
      try {
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState === 1) {
          await session.save();
        }
      } catch {}
    }

    // 8. Registra uso e debita quota de forma assíncrona
    usageEventBus.dispatch({
      userId,
      role: req.user.role,
      feature: 'tutor',
      provider: finalChunk?.provider || 'gemini',
      model: finalChunk?.model || 'gemini-2.5-flash',
      promptTokens: finalChunk?.usage?.promptTokens || Math.ceil(message.length / 4),
      completionTokens: finalChunk?.usage?.completionTokens || Math.ceil(fullContent.length / 4),
      totalTokens: finalChunk?.usage?.totalTokens || Math.ceil((message.length + fullContent.length) / 4),
      durationMs: finalChunk?.durationMs || 0,
      cefrLevel,
      metadata: {
        ttftMs: finalChunk?.ttftMs || 0,
        sessionId: session._id,
      },
    });

    // 9. Envia evento final (done) e encerra stream
    res.write(`event: done\ndata: ${JSON.stringify({
      sessionId: session._id || 'temp_session',
      totalMessages: session.messages?.length || 2,
      usage: finalChunk?.usage,
      ttftMs: finalChunk?.ttftMs || 0,
      durationMs: finalChunk?.durationMs || 0,
    })}\n\n`);

    res.end();
  } catch (err) {
    if (keepAliveTimer) clearInterval(keepAliveTimer);

    if (err.name === 'AbortError' || abortController.signal.aborted) {
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }

    if (!res.headersSent) {
      return next(err);
    }

    try {
      res.write(`event: error\ndata: ${JSON.stringify({
        error: {
          code: err.code || 'AI_STREAM_ERROR',
          message: err.message || 'Erro durante o streaming da resposta.',
        },
      })}\n\n`);
      res.end();
    } catch {}
  }
});

module.exports = router;
