const Redis = require('ioredis');

let redisClient = null;
let isRedisAvailable = false;
let hasLoggedWarning = false;

/**
 * Inicializa ou retorna cliente Redis resiliente com suporte a fallback
 */
function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;

  // Se não houver configuração de Redis ou for ambiente de teste sem flag explícita, desabilita
  if (!redisUrl && !redisHost) {
    if (!hasLoggedWarning && process.env.NODE_ENV !== 'test') {
      console.warn('⚠️ [Redis Config] Nenhuma URL de Redis configurada (REDIS_URL ou REDIS_HOST). Operando em modo In-Memory Fallback.');
      hasLoggedWarning = true;
    }
    return null;
  }

  try {
    const options = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
      retryStrategy: (times) => {
        if (times > 3) {
          if (!hasLoggedWarning) {
            console.warn('⚠️ [Redis Connection] Falha ao conectar ao Redis após 3 tentativas. Degradação para fallback local in-memory.');
            hasLoggedWarning = true;
          }
          return null; // Interrompe retries contínuos
        }
        return Math.min(times * 200, 1000);
      },
    };

    redisClient = redisUrl ? new Redis(redisUrl, options) : new Redis({ host: redisHost, port: Number(process.env.REDIS_PORT) || 6379, ...options });

    redisClient.on('connect', () => {
      isRedisAvailable = true;
      hasLoggedWarning = false;
      console.log('✅ [Redis] Conectado com sucesso.');
    });

    redisClient.on('ready', () => {
      isRedisAvailable = true;
    });

    redisClient.on('error', (err) => {
      isRedisAvailable = false;
      if (!hasLoggedWarning) {
        console.warn(`⚠️ [Redis Error] Conexão com Redis indisponível: ${err.message}. Degradação graciosa ativa.`);
        hasLoggedWarning = true;
      }
    });

    redisClient.on('close', () => {
      isRedisAvailable = false;
    });

    // Conecta de forma não bloqueante
    redisClient.connect().catch(() => {
      isRedisAvailable = false;
    });

    return redisClient;
  } catch (err) {
    isRedisAvailable = false;
    console.warn(`⚠️ [Redis Init] Não foi possível inicializar cliente Redis: ${err.message}`);
    return null;
  }
}

/**
 * Retorna true se o Redis estiver online e pronto para receber comandos
 */
function isRedisReady() {
  return Boolean(isRedisAvailable && redisClient && redisClient.status === 'ready');
}

/**
 * Encerra conexão com o Redis (útil para encerramento de testes e graceful shutdown)
 */
async function closeRedis() {
  if (redisClient) {
    try {
      if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
        await redisClient.quit();
      } else {
        redisClient.disconnect();
      }
    } catch {}
    redisClient = null;
    isRedisAvailable = false;
  }
}

module.exports = {
  getRedisClient,
  isRedisReady,
  closeRedis,
};
