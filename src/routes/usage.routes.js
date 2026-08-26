const express = require('express');
const { authenticate, checkRole } = require('../middlewares/auth');
const UserQuota = require('../models/UserQuota');
const AiUsageLog = require('../models/AiUsageLog');

const router = express.Router();

/**
 * GET /genai/usage/my-quota
 * Consulta saldo de tokens e limites do usuário autenticado.
 * Acessível por: Aluno, Professor e Admin.
 */
router.get('/my-quota', authenticate, checkRole('aluno', 'professor', 'admin'), async (req, res, next) => {
  try {
    const userId = req.user.id;
    let quota = null;

    try {
      quota = await UserQuota.getOrCreateQuota(userId, req.user.role);
    } catch {
      // Fallback em memória caso banco esteja indisponível
      quota = {
        userId,
        role: req.user.role,
        tier: 'free',
        dailyTokenLimit: 25000,
        monthlyTokenLimit: 500000,
        dailyTokensUsed: 0,
        monthlyTokensUsed: 0,
        lastResetDate: new Date(),
      };
    }

    const remainingDaily = Math.max(0, quota.dailyTokenLimit - quota.dailyTokensUsed);
    const remainingMonthly = Math.max(0, quota.monthlyTokenLimit - quota.monthlyTokensUsed);
    const percentUsedDaily = Number(((quota.dailyTokensUsed / quota.dailyTokenLimit) * 100).toFixed(1));

    return res.status(200).json({
      userId: quota.userId,
      role: quota.role,
      tier: quota.tier,
      daily: {
        limit: quota.dailyTokenLimit,
        used: quota.dailyTokensUsed,
        remaining: remainingDaily,
        percentUsed: percentUsedDaily,
      },
      monthly: {
        limit: quota.monthlyTokenLimit,
        used: quota.monthlyTokensUsed,
        remaining: remainingMonthly,
      },
      lastResetDate: quota.lastResetDate,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /genai/usage/analytics
 * Relatório consolidado de custos e métricas FinOps para gestão da plataforma.
 * Restrito estritamente a: Admin.
 */
router.get('/analytics', authenticate, checkRole('admin'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    let analytics = null;
    try {
      analytics = await AiUsageLog.getFinOpsAnalytics({ startDate, endDate });
    } catch {
      analytics = {
        overview: { totalRequests: 0, totalTokens: 0, totalCostUsd: 0, avgDurationMs: 0 },
        byFeature: [],
        topConsumers: [],
      };
    }

    return res.status(200).json({
      finOpsReport: 'UP!Experience GenAI Service - Cost & Usage Analytics',
      generatedAt: new Date().toISOString(),
      filters: { startDate: startDate || null, endDate: endDate || null },
      ...analytics,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
