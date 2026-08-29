const mongoose = require('mongoose');

const AiUsageLogSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: [true, 'userId é obrigatório para rastreabilidade'],
      index: true,
    },
    role: {
      type: String,
      enum: ['aluno', 'professor', 'admin', 'system'],
      default: 'aluno',
      index: true,
    },
    feature: {
      type: String,
      enum: ['tutor', 'correction', 'exercise_generation'],
      required: [true, 'feature é obrigatória (tutor, correction, exercise_generation)'],
      index: true,
    },
    provider: {
      type: String,
      enum: ['gemini', 'claude'],
      required: true,
    },
    model: {
      type: String,
      required: true,
      default: 'gemini-2.5-flash',
    },
    promptTokens: {
      type: Number,
      default: 0,
      min: 0,
    },
    completionTokens: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
      min: 0,
    },
    estimatedCostUsd: {
      type: Number,
      default: 0.0,
      min: 0,
    },
    durationMs: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['success', 'error', 'quota_exceeded', 'throttled'],
      default: 'success',
      index: true,
    },
    cefrLevel: {
      type: String,
      enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'all'],
      default: 'all',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Índices compostos para consultas e agregações rápidas
AiUsageLogSchema.index({ userId: 1, createdAt: -1 });
AiUsageLogSchema.index({ feature: 1, createdAt: -1 });
AiUsageLogSchema.index({ createdAt: 1, status: 1 });
AiUsageLogSchema.index({ createdAt: 1, feature: 1 });
AiUsageLogSchema.index({ createdAt: 1, provider: 1 });

/**
 * Tabela de custos aproximados por 1k tokens (USD)
 */
const PRICING_TABLE = {
  'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
  'claude-3-5-haiku': { input: 0.0008, output: 0.004 },
};

/**
 * Helper estático para calcular custo e registrar uso
 */
AiUsageLogSchema.statics.logUsage = async function (data) {
  const modelName = data.model || 'gemini-2.5-flash';
  const pricing = PRICING_TABLE[modelName] || { input: 0.0001, output: 0.0004 };

  const promptTokens = Number(data.promptTokens) || 0;
  const completionTokens = Number(data.completionTokens) || 0;
  const totalTokens = promptTokens + completionTokens;

  const costInput = (promptTokens / 1000) * pricing.input;
  const costOutput = (completionTokens / 1000) * pricing.output;
  const estimatedCostUsd = Number((costInput + costOutput).toFixed(6));

  const logEntry = new this({
    userId: data.userId,
    role: data.role || 'aluno',
    feature: data.feature,
    provider: data.provider || 'gemini',
    model: modelName,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd,
    durationMs: data.durationMs || 0,
    status: data.status || 'success',
    cefrLevel: data.cefrLevel || 'all',
    metadata: data.metadata || {},
  });

  if (mongoose.connection.readyState === 1) {
    return await logEntry.save();
  }
  return logEntry;
};

/**
 * Agregação executiva para painel de FinOps (Admin)
 */
AiUsageLogSchema.statics.getFinOpsAnalytics = async function (filters = {}) {
  if (mongoose.connection.readyState !== 1) {
    return {
      overview: { totalRequests: 0, totalTokens: 0, totalCostUsd: 0, avgDurationMs: 0, avgTtftMs: 0 },
      byFeature: [],
      byProvider: [],
      topConsumers: [],
    };
  }
  const match = { status: 'success' };
  if (filters.startDate || filters.endDate) {
    match.createdAt = {};
    if (filters.startDate) match.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) match.createdAt.$lte = new Date(filters.endDate);
  }
  if (filters.feature) match.feature = filters.feature;
  if (filters.provider) match.provider = filters.provider;

  const [summary, byFeature, byProvider, byUser] = await Promise.all([
    this.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalTokens: { $sum: '$totalTokens' },
          totalCostUsd: { $sum: '$estimatedCostUsd' },
          avgDurationMs: { $avg: '$durationMs' },
          avgTtftMs: { $avg: '$metadata.ttftMs' },
        },
      },
    ]),
    this.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$feature',
          requests: { $sum: 1 },
          tokens: { $sum: '$totalTokens' },
          costUsd: { $sum: '$estimatedCostUsd' },
        },
      },
      { $sort: { tokens: -1 } },
    ]),
    this.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$provider',
          requests: { $sum: 1 },
          tokens: { $sum: '$totalTokens' },
          costUsd: { $sum: '$estimatedCostUsd' },
        },
      },
      { $sort: { costUsd: -1 } },
    ]),
    this.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$userId',
          requests: { $sum: 1 },
          tokens: { $sum: '$totalTokens' },
          costUsd: { $sum: '$estimatedCostUsd' },
        },
      },
      { $sort: { tokens: -1 } },
      { $limit: 10 },
    ]),
  ]);

  return {
    overview: summary[0] || { totalRequests: 0, totalTokens: 0, totalCostUsd: 0, avgDurationMs: 0, avgTtftMs: 0 },
    byFeature,
    byProvider,
    topConsumers: byUser,
  };
};

module.exports = mongoose.model('AiUsageLog', AiUsageLogSchema);
