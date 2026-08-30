const crypto = require('crypto');

/**
 * Middleware de Correlação e Tracing Distribuído.
 * Propaga X-Request-ID e traceparent para rastreabilidade end-to-end de telemetria.
 */
function correlationMiddleware(req, res, next) {
  const correlationId = req.headers['x-request-id'] || crypto.randomUUID();
  const traceparent = req.headers['traceparent'];

  req.id = correlationId;
  req.correlationId = correlationId;
  req._startTime = performance.now();

  res.setHeader('X-Request-ID', correlationId);

  if (traceparent) {
    req.traceparent = traceparent;
    res.setHeader('traceparent', traceparent);
  }

  res.on('finish', () => {
    if (!req.path.endsWith('/health') && req.path !== '/docs.json' && req.path !== '/docs') {
      const durationMs = Math.round(performance.now() - req._startTime);
      console.log(`🌐 [HTTP ${res.statusCode}] ${req.method} ${req.originalUrl || req.url} - ${durationMs}ms [${correlationId}]`);
    }
  });

  next();
}

module.exports = correlationMiddleware;
