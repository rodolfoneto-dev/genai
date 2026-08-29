const { checkAiQuota } = require('./quota');
const UserQuota = require('../models/UserQuota');

describe('GenAI Service - Quota Middleware Unit Tests', () => {
  let req, res, next;

  beforeEach(() => {
    req = { user: { id: 'user_1', role: 'aluno' } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('deve permitir requisição de admin sem checagem de quota', async () => {
    req.user.role = 'admin';
    const middleware = checkAiQuota(500);

    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('deve permitir requisição quando o aluno tem saldo disponível', async () => {
    jest.spyOn(UserQuota, 'getOrCreateQuota').mockResolvedValueOnce({
      hasAvailableQuota: jest.fn().mockReturnValue({
        allowed: true,
        dailyTokenLimit: 25000,
        dailyTokensUsed: 1000,
        dailyRemaining: 24000,
      }),
    });

    const middleware = checkAiQuota(300);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('deve bloquear com 429 AI_QUOTA_EXCEEDED quando o aluno estourar o limite diário', async () => {
    jest.spyOn(UserQuota, 'getOrCreateQuota').mockResolvedValueOnce({
      hasAvailableQuota: jest.fn().mockReturnValue({
        allowed: false,
        dailyTokenLimit: 25000,
        dailyTokensUsed: 25100,
        dailyRemaining: 0,
      }),
    });

    const middleware = checkAiQuota(300);
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'AI_QUOTA_EXCEEDED',
          details: expect.objectContaining({ dailyLimit: 25000, dailyTokensUsed: 25100 }),
        }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  describe('Story 3.1: ResilientRateLimitStore & Rate Limiting', () => {
    const { ResilientRateLimitStore } = require('./quota');

    it('deve contabilizar requisições no fallback in-memory quando o Redis não estiver ativo', async () => {
      const store = new ResilientRateLimitStore({ windowMs: 1000, prefix: 'test-rl:' });

      const res1 = await store.increment('user_123');
      expect(res1.totalHits).toBe(1);
      expect(res1.resetTime).toBeInstanceOf(Date);

      const res2 = await store.increment('user_123');
      expect(res2.totalHits).toBe(2);

      await store.decrement('user_123');
      const res3 = await store.increment('user_123');
      expect(res3.totalHits).toBe(2);

      await store.resetKey('user_123');
      const res4 = await store.increment('user_123');
      expect(res4.totalHits).toBe(1);
    });

    it('deve resetar o contador após a expiração do windowMs', async () => {
      const store = new ResilientRateLimitStore({ windowMs: 50, prefix: 'test-exp:' });

      await store.increment('user_exp');
      await new Promise((r) => setTimeout(r, 60));

      const res = await store.increment('user_exp');
      expect(res.totalHits).toBe(1);
    });
  });
});
