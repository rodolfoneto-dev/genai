/**
 * Mecanismo de Retry com Exponential Backoff e Jitter para chamadas de IA.
 * Identifica erros transitórios (429, 503, timeout) e descarta erros de cliente (400, 401).
 */

/**
 * Avalia se um erro é transitório e elegível para nova tentativa
 * @param {Error|any} error
 * @returns {boolean}
 */
function isRetryableError(error) {
  if (!error) return false;

  // Erro de aborto por desconexão nunca deve ser retentado
  if (error.name === 'AbortError' || error.message?.includes('aborted')) {
    return false;
  }

  // Verifica status HTTP se presente
  const status = error.status || error.statusCode;
  if (status) {
    // 400, 401, 403, 404, 422 são erros determinísticos do cliente
    if ([400, 401, 403, 404, 422].includes(status)) {
      return false;
    }
    // 429 (Rate Limit), 500, 502, 503, 504 são transitórios
    if ([429, 500, 502, 503, 504].includes(status)) {
      return true;
    }
  }

  const msg = String(error.message || '').toLowerCase();
  const retryablePatterns = [
    'rate limit',
    'resource exhausted',
    'too many requests',
    '429',
    '503',
    'overloaded',
    'service unavailable',
    'timeout',
    'timed out',
    'econnreset',
    'etimedout',
    'econnrefused',
    'fetch failed',
    'socket hang up',
  ];

  return retryablePatterns.some((pattern) => msg.includes(pattern));
}

/**
 * Função utilitária de sleep com suporte a AbortSignal
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
function sleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const abortErr = new Error('Operação cancelada');
      abortErr.name = 'AbortError';
      return reject(abortErr);
    }

    const timer = setTimeout(() => resolve(), ms);

    if (signal) {
      const abortHandler = () => {
        clearTimeout(timer);
        const abortErr = new Error('Operação cancelada');
        abortErr.name = 'AbortError';
        reject(abortErr);
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  });
}

/**
 * Executa uma função assíncrona com retry exponencial, jitter e timeout
 * @param {Function} fn - Função que retorna Promise
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.initialDelayMs=500]
 * @param {number} [options.maxDelayMs=4000]
 * @param {number} [options.backoffFactor=2]
 * @param {number} [options.timeoutMs=15000] - Timeout global da operação
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.onRetry]
 * @returns {Promise<any>}
 */
async function executeWithRetry(fn, options = {}) {
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : (process.env.AI_MAX_RETRIES ? Number(process.env.AI_MAX_RETRIES) : 3);
  const initialDelayMs = options.initialDelayMs !== undefined ? options.initialDelayMs : (process.env.AI_RETRY_INITIAL_DELAY_MS ? Number(process.env.AI_RETRY_INITIAL_DELAY_MS) : 500);
  const maxDelayMs = options.maxDelayMs !== undefined ? options.maxDelayMs : 4000;
  const backoffFactor = options.backoffFactor !== undefined ? options.backoffFactor : 2;
  const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : (process.env.AI_REQUEST_TIMEOUT_MS ? Number(process.env.AI_REQUEST_TIMEOUT_MS) : 15000);
  const callerSignal = options.signal || null;

  // Timeout controller para a chamada
  const timeoutController = new AbortController();
  let timeoutTimer = null;

  if (timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      const timeoutErr = new Error(`Tempo limite de ${timeoutMs}ms excedido na requisição de IA.`);
      timeoutErr.name = 'TimeoutError';
      timeoutErr.code = 'TIMEOUT_ERROR';
      timeoutController.abort(timeoutErr);
    }, timeoutMs);
  }

  // Combina signal externo com o signal de timeout
  const abortHandler = () => timeoutController.abort(callerSignal.reason);
  if (callerSignal) {
    if (callerSignal.aborted) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const err = new Error('Operação cancelada pelo cliente');
      err.name = 'AbortError';
      throw err;
    }
    callerSignal.addEventListener('abort', abortHandler, { once: true });
  }

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (timeoutController.signal.aborted) {
          throw timeoutController.signal.reason || new Error('Requisição cancelada ou expirada por timeout');
        }

        return await fn({ attempt, signal: timeoutController.signal });
      } catch (err) {
        // Se a operação foi cancelada ou timeout ocorreu, não tenta novamente
        if (err.name === 'AbortError' || err.name === 'TimeoutError' || timeoutController.signal.aborted) {
          throw err;
        }

        // Se o erro não for transitório ou atingiu o número máximo de tentativas
        if (attempt === maxRetries || !isRetryableError(err)) {
          throw err;
        }

        // Cálculo de Exponential Backoff com Full Jitter
        const exponentialDelay = initialDelayMs * Math.pow(backoffFactor, attempt);
        const jitter = Math.random() * (initialDelayMs * 0.5);
        const delay = Math.min(Math.round(exponentialDelay + jitter), maxDelayMs);

        if (typeof options.onRetry === 'function') {
          options.onRetry({ attempt: attempt + 1, delay, error: err });
        }

        await sleep(delay, timeoutController.signal);
      }
    }
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (callerSignal) callerSignal.removeEventListener('abort', abortHandler);
  }
}

module.exports = {
  executeWithRetry,
  isRetryableError,
  sleep,
};
