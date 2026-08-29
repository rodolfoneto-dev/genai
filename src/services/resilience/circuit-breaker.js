/**
 * Circuit Breaker Pattern para Provedores de IA.
 * Estados:
 *  - CLOSED: Operação normal, requisições fluem para o provedor.
 *  - OPEN: Provedor falhou repetidamente, requisições são rejeitadas/redirecionadas imediatamente.
 *  - HALF_OPEN: Período de cooldown expirou, permite requisições canário para testar recuperação.
 */

const CIRCUIT_STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

class CircuitBreaker {
  /**
   * @param {string} name - Nome do serviço/provedor protegido (ex: 'gemini', 'claude')
   * @param {Object} [options]
   * @param {number} [options.failureThreshold=5] - Número de falhas para abrir o circuito
   * @param {number} [options.windowMs=60000] - Janela de tempo deslizante para contagem de falhas (60s)
   * @param {number} [options.cooldownMs=30000] - Tempo de espera em OPEN antes de HALF_OPEN (30s)
   */
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || (process.env.CIRCUIT_BREAKER_THRESHOLD ? Number(process.env.CIRCUIT_BREAKER_THRESHOLD) : 5);
    this.windowMs = options.windowMs || (process.env.CIRCUIT_BREAKER_WINDOW_MS ? Number(process.env.CIRCUIT_BREAKER_WINDOW_MS) : 60000);
    this.cooldownMs = options.cooldownMs || (process.env.CIRCUIT_BREAKER_COOLDOWN_MS ? Number(process.env.CIRCUIT_BREAKER_COOLDOWN_MS) : 30000);

    this.state = CIRCUIT_STATES.CLOSED;
    this.failures = [];
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  /**
   * Verifica se o circuito está aberto (bloqueando chamadas)
   * @returns {boolean} true se o circuito estiver bloqueado
   */
  isOpen() {
    if (this.state === CIRCUIT_STATES.OPEN) {
      if (Date.now() >= this.nextAttemptTime) {
        this.state = CIRCUIT_STATES.HALF_OPEN;
        return false; // Permite requisição canário
      }
      return true;
    }
    return false;
  }

  /**
   * Registra sucesso na chamada ao provedor
   */
  recordSuccess() {
    this.failures = [];
    this.state = CIRCUIT_STATES.CLOSED;
    this.nextAttemptTime = null;
  }

  /**
   * Registra falha na chamada ao provedor
   * @param {Error} [error]
   */
  recordFailure(error = null) {
    const now = Date.now();
    this.lastFailureTime = now;

    // Remove falhas fora da janela deslizante
    const cutoff = now - this.windowMs;
    this.failures = this.failures.filter((t) => t > cutoff);
    this.failures.push(now);

    // Se estiver em HALF_OPEN ou atingir o limiar de falhas, abre o circuito
    if (this.state === CIRCUIT_STATES.HALF_OPEN || this.failures.length >= this.failureThreshold) {
      this.state = CIRCUIT_STATES.OPEN;
      this.nextAttemptTime = now + this.cooldownMs;
      console.warn(`⚡ [CircuitBreaker:${this.name}] Circuito ABERTO! Falhas: ${this.failures.length}/${this.failureThreshold}. Próxima tentativa em ${Math.round(this.cooldownMs / 1000)}s.`);
    }
  }

  /**
   * Retorna o estado atual
   */
  getState() {
    // Força atualização caso tenha expirado cooldown
    this.isOpen();
    return this.state;
  }

  /**
   * Reseta o estado do circuito para CLOSED
   */
  reset() {
    this.state = CIRCUIT_STATES.CLOSED;
    this.failures = [];
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }
}

module.exports = {
  CircuitBreaker,
  CIRCUIT_STATES,
};
