const mongoose = require('mongoose');

const DEFAULT_TIER_LIMITS = {
  free: { daily: 25000, monthly: 500000 },
  basic: { daily: 75000, monthly: 1500000 },
  premium: { daily: 250000, monthly: 5000000 },
  professor: { daily: 300000, monthly: 6000000 },
  admin: { daily: 1000000, monthly: 20000000 },
};

const UserQuotaSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: [true, 'userId é obrigatório'],
      unique: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['aluno', 'professor', 'admin'],
      default: 'aluno',
    },
    tier: {
      type: String,
      enum: ['free', 'basic', 'premium'],
      default: 'free',
    },
    dailyTokenLimit: {
      type: Number,
      default: 25000,
    },
    monthlyTokenLimit: {
      type: Number,
      default: 500000,
    },
    dailyTokensUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    monthlyTokensUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastResetDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Método de instância para verificar se é um novo dia e resetar o saldo diário
 */
UserQuotaSchema.methods.checkAndResetDailyQuota = function () {
  const now = new Date();
  const lastReset = new Date(this.lastResetDate);

  const isSameDay =
    now.getUTCFullYear() === lastReset.getUTCFullYear() &&
    now.getUTCMonth() === lastReset.getUTCMonth() &&
    now.getUTCDate() === lastReset.getUTCDate();

  const isSameMonth =
    now.getUTCFullYear() === lastReset.getUTCFullYear() &&
    now.getUTCMonth() === lastReset.getUTCMonth();

  if (!isSameDay) {
    this.dailyTokensUsed = 0;
    this.lastResetDate = now;
  }

  if (!isSameMonth) {
    this.monthlyTokensUsed = 0;
  }

  return this;
};

/**
 * Verifica se o usuário possui saldo disponível para a quantidade estimada de tokens
 */
UserQuotaSchema.methods.hasAvailableQuota = function (estimatedTokens = 500) {
  this.checkAndResetDailyQuota();

  const withinDailyLimit = this.dailyTokensUsed + estimatedTokens <= this.dailyTokenLimit;
  const withinMonthlyLimit = this.monthlyTokensUsed + estimatedTokens <= this.monthlyTokenLimit;

  return {
    allowed: withinDailyLimit && withinMonthlyLimit,
    dailyRemaining: Math.max(0, this.dailyTokenLimit - this.dailyTokensUsed),
    monthlyRemaining: Math.max(0, this.monthlyTokenLimit - this.monthlyTokensUsed),
    dailyTokensUsed: this.dailyTokensUsed,
    dailyTokenLimit: this.dailyTokenLimit,
  };
};

/**
 * Helper estático para buscar ou criar documento de quota para o usuário
 */
UserQuotaSchema.statics.getOrCreateQuota = async function (userId, role = 'aluno', tier = 'free') {
  const limits = role === 'admin' 
    ? DEFAULT_TIER_LIMITS.admin 
    : role === 'professor' 
      ? DEFAULT_TIER_LIMITS.professor 
      : DEFAULT_TIER_LIMITS[tier] || DEFAULT_TIER_LIMITS.free;

  if (mongoose.connection.readyState !== 1) {
    return new this({
      userId,
      role,
      tier,
      dailyTokenLimit: limits.daily,
      monthlyTokenLimit: limits.monthly,
      dailyTokensUsed: 0,
      monthlyTokensUsed: 0,
      lastResetDate: new Date(),
    });
  }

  let quota = await this.findOne({ userId });

  if (!quota) {
    quota = new this({
      userId,
      role,
      tier,
      dailyTokenLimit: limits.daily,
      monthlyTokenLimit: limits.monthly,
      dailyTokensUsed: 0,
      monthlyTokensUsed: 0,
      lastResetDate: new Date(),
    });
    await quota.save();
  } else {
    quota.checkAndResetDailyQuota();
    if (quota.isModified()) {
      await quota.save();
    }
  }

  return quota;
};

/**
 * Debita tokens consumidos após a resposta da LLM
 */
UserQuotaSchema.statics.consumeTokens = async function (userId, totalTokens = 0) {
  if (!userId || totalTokens <= 0 || mongoose.connection.readyState !== 1) return null;

  return await this.findOneAndUpdate(
    { userId },
    {
      $inc: {
        dailyTokensUsed: totalTokens,
        monthlyTokensUsed: totalTokens,
      },
    },
    { new: true, upsert: false }
  );
};

module.exports = mongoose.model('UserQuota', UserQuotaSchema);
