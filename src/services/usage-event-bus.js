const { EventEmitter } = require('events');
const AiUsageLog = require('../models/AiUsageLog');
const UserQuota = require('../models/UserQuota');
const { sanitizeLogPayload } = require('../utils/sanitizer');

/**
 * Barramento Assíncrono de Eventos de Consumo FinOps.
 * Desacopla a entrega de resposta ao estudante do tempo de persistência em banco.
 */
class UsageEventBus extends EventEmitter {
  constructor() {
    super();
    this.pendingTasks = new Set();
  }

  /**
   * Processa o registro de uso e débito de quota em segundo plano
   * @param {Object} payload
   */
  async processUsageEvent(payload) {
    try {
      const sanitized = sanitizeLogPayload(payload);

      // 1. Registra log de uso e custo
      await AiUsageLog.logUsage(sanitized);

      // 2. Debita tokens consumidos na quota do usuário
      if (sanitized.userId && sanitized.totalTokens > 0) {
        await UserQuota.consumeTokens(sanitized.userId, sanitized.totalTokens);
      }
    } catch (err) {
      console.error('⚠️ [UsageEventBus] Erro ao persistir evento de uso em segundo plano:', err.message);
    }
  }

  /**
   * Emite evento de uso e agenda processamento assíncrono em segundo plano
   * @param {Object} payload
   */
  dispatch(payload) {
    const task = this.processUsageEvent(payload);
    this.pendingTasks.add(task);
    task.finally(() => this.pendingTasks.delete(task));

    this.emit('usage.logged', payload);
  }

  /**
   * Aguarda todas as tarefas em segundo plano terminarem (útil para testes unitários)
   */
  async drain() {
    await Promise.all(Array.from(this.pendingTasks));
  }
}

module.exports = new UsageEventBus();
