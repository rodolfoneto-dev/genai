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

  next();
}

module.exports = correlationMiddleware;
