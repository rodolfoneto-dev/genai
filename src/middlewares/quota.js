const rateLimit = require('express-rate-limit');
const UserQuota = require('../models/UserQuota');

/**
 * Camada 1: Rate Limiter Anti-Flood / Anti-DDoS (In-Memory)
 * Limita a 20 requisições por minuto por IP/usuário autenticado.
 */
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Muitas requisições em curto intervalo. Aguarde alguns segundos antes de tentar novamente.',
        details: { retryAfterSeconds: 60 },
      },
    });
  },
});

/**
 * Camada 2: Validador de Quota de Tokens Diária por Aluno/Professor (Banco / Modelo)
 * Intercepta a requisição ANTES da chamada à LLM para evitar consumo indevido.
 */
const checkAiQuota = (estimatedTokens = 500) => {
  return async (req, res, next) => {
    // Se o usuário for Admin, bypassa verificação de quota
    if (req.user?.role === 'admin') {
      return next();
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Usuário não autenticado para verificação de quota.',
        },
      });
    }

    try {
      const quota = await UserQuota.getOrCreateQuota(userId, req.user.role);
      const quotaCheck = quota.hasAvailableQuota(estimatedTokens);

      if (!quotaCheck.allowed) {
        return res.status(429).json({
          error: {
            code: 'AI_QUOTA_EXCEEDED',
            message: 'Você atingiu o limite diário de consumo de Inteligência Artificial.',
            details: {
              dailyLimit: quotaCheck.dailyTokenLimit,
              dailyTokensUsed: quotaCheck.dailyTokensUsed,
              dailyRemaining: quotaCheck.dailyRemaining,
              resetInfo: 'Seu saldo será automaticamente renovado à meia-noite (UTC).',
            },
          },
        });
      }

      req.userQuota = quota;
      next();
    } catch (err) {
      console.warn('⚠️ [Quota Middleware] Falha na checagem de quota, prosseguindo com fallback gracioso:', err.message);
      next();
    }
  };
};

module.exports = {
  apiRateLimiter,
  checkAiQuota,
};
