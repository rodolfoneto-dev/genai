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
});
