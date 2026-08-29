const rateLimit = require('express-rate-limit');
const UserQuota = require('../models/UserQuota');
const { getRedisClient, isRedisReady } = require('../config/redis');

/**
 * Store Resiliente para express-rate-limit.
 * Coordena contadores atômicos via Redis entre instâncias horizontais,
 * degradando automaticamente para memória local se o Redis estiver offline.
 */
class ResilientRateLimitStore {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000;
    this.prefix = options.prefix || 'rl:';
    this.localHits = new Map();
  }

  init(options) {
    if (options?.windowMs) {
      this.windowMs = options.windowMs;
    }
  }

  async increment(key) {
    const redis = getRedisClient();
    if (isRedisReady() && redis) {
      try {
        const fullKey = `${this.prefix}${key}`;
        const multi = redis.multi();
        multi.incr(fullKey);
        multi.pttl(fullKey);
        const results = await multi.exec();

        const totalHits = results[0][1];
        let ttl = results[1][1];

        // Se chave não possuía TTL definido, aplica PEXPIRE
        if (ttl === -1) {
          await redis.pexpire(fullKey, this.windowMs);
          ttl = this.windowMs;
        }

        const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs));
        return { totalHits, resetTime };
      } catch (err) {
        console.warn('⚠️ [RateLimit Store] Erro no Redis, degradando para in-memory local:', err.message);
      }
    }

    // Fallback local em memória
    const now = Date.now();
    let record = this.localHits.get(key);

    if (!record || now > record.resetTime.getTime()) {
      record = {
        totalHits: 1,
        resetTime: new Date(now + this.windowMs),
      };
    } else {
      record.totalHits += 1;
    }

    this.localHits.set(key, record);
    return { totalHits: record.totalHits, resetTime: record.resetTime };
  }

  async decrement(key) {
    const redis = getRedisClient();
    if (isRedisReady() && redis) {
      try {
        await redis.decr(`${this.prefix}${key}`);
        return;
      } catch {}
    }

    const record = this.localHits.get(key);
    if (record && record.totalHits > 0) {
      record.totalHits -= 1;
    }
  }

  async resetKey(key) {
    const redis = getRedisClient();
    if (isRedisReady() && redis) {
      try {
        await redis.del(`${this.prefix}${key}`);
      } catch {}
    }
    this.localHits.delete(key);
  }

  async resetAll() {
    this.localHits.clear();
    const redis = getRedisClient();
    if (isRedisReady() && redis) {
      try {
        const keys = await redis.keys(`${this.prefix}*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch {}
    }
  }
}

const resilientStore = new ResilientRateLimitStore({ windowMs: 60 * 1000 });

/**
 * Camada 1: Rate Limiter Anti-Flood / Anti-DDoS Distribuído
 * Limita a 20 requisições por minuto por IP/usuário autenticado.
 */
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: resilientStore,
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
  ResilientRateLimitStore,
};
