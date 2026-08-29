/**
 * Utilitário de Sanitização de Logs e Redação de PII / Segredos.
 * Protege chaves de API, tokens JWT e conteúdo sensível de redações/prompts em produção.
 */

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z-_]{35}/g, // Google API Key
  /sk-ant-[a-zA-Z0-9_-]{20,}/g, // Anthropic API Key
  /Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, // JWT Bearer
  /password["':\s]+["']?([^"',\s]+)/gi,
  /api[_-]?key["':\s]+["']?([^"',\s]+)/gi,
];

/**
 * Redige chaves de API e tokens sensíveis de strings
 * @param {string} str
 * @returns {string}
 */
function redactSecrets(str) {
  if (typeof str !== 'string') return str;

  let sanitized = str;
  sanitized = sanitized.replace(/AIza[0-9A-Za-z-_]{20,}/g, '[REDACTED_GEMINI_KEY]');
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_ANTHROPIC_KEY]');
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_OPENCODE_KEY]');
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, 'Bearer [REDACTED_JWT]');
  return sanitized;
}

/**
 * Sanitiza objeto de log para observabilidade protegendo PII do estudante
 * @param {Object} data
 * @param {boolean} [forceRedactPrompt=false]
 * @returns {Object}
 */
function sanitizeLogPayload(data, forceRedactPrompt = false) {
  if (!data || typeof data !== 'object') return data;

  const isProd = process.env.NODE_ENV === 'production' || forceRedactPrompt;
  const clone = { ...data };

  // Em produção, omite textos brutos de redações/prompts para conformidade LGPD/COPPA
  if (isProd) {
    if (clone.prompt) clone.prompt = '[REDACTED_PROMPT_CONTENT]';
    if (clone.systemPrompt) clone.systemPrompt = '[REDACTED_SYSTEM_PROMPT]';
    if (clone.message) clone.message = '[REDACTED_USER_MESSAGE]';
    if (clone.text) clone.text = '[REDACTED_ESSAY_TEXT]';
    if (clone.content && typeof clone.content === 'string' && clone.content.length > 100) {
      clone.content = '[REDACTED_LARGE_CONTENT]';
    }
  }

  // Redige segredos em headers ou mensagens de erro
  if (clone.error) {
    if (typeof clone.error === 'string') {
      clone.error = redactSecrets(clone.error);
    } else if (clone.error.message) {
      clone.error = { ...clone.error, message: redactSecrets(clone.error.message) };
    }
  }

  return clone;
}

module.exports = {
  redactSecrets,
  sanitizeLogPayload,
};
