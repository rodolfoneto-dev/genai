const { getRedisClient, isRedisReady } = require('../config/redis');

/**
 * Serviço de Cache Distribuído para Exercícios Gerados.
 * Integra Redis para compartilhamento entre réplicas com fallback gracioso in-memory.
 * Garante latência ~5ms e custo $0 para tópicos repetidos.
 */
class ExerciseCacheService {
  constructor(ttlMinutes = 60 * 24 * 7) {
    this.localCache = new Map();
    this.ttlMs = ttlMinutes * 60 * 1000; // 7 dias de retenção padrão
    this.prefix = 'genai:exercise:';
  }

  generateKey(topic, cefrLevel, count, type) {
    const cleanTopic = String(topic || '').trim().toLowerCase().replace(/\s+/g, '-');
    return `${this.prefix}${cleanTopic}:${String(cefrLevel || '').toUpperCase()}:${count}:${type}`;
  }

  /**
   * Busca exercício no cache (Redis distribuído ou fallback local)
   */
  async get(topic, cefrLevel, count, type) {
    const key = this.generateKey(topic, cefrLevel, count, type);

    // 1. Tenta buscar no Redis se estiver disponível
    const redis = getRedisClient();
    if (isRedisReady() && redis) {
      try {
        const raw = await redis.get(key);
        if (raw) {
          return JSON.parse(raw);
        }
      } catch (err) {
        console.warn('⚠️ [ExerciseCache] Erro ao consultar Redis, usando fallback local:', err.message);
      }
    }

    // 2. Fallback in-memory local
    const entry = this.localCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.localCache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Armazena exercício no cache (Redis com TTL e cópia local)
   */
  async set(topic, cefrLevel, count, type, data) {
    const key = this.generateKey(topic, cefrLevel, count, type);

    // 1. Salva no Redis se disponível
    const redis = getRedisClient();
    if (isRedisReady() && redis) {
      try {
        await redis.set(key, JSON.stringify(data), 'PX', this.ttlMs);
      } catch (err) {
        console.warn('⚠️ [ExerciseCache] Erro ao gravar no Redis, mantendo apenas cache local:', err.message);
      }
    }

    // 2. Salva no cache local in-memory
    this.localCache.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
      cachedAt: new Date().toISOString(),
    });
  }

  /**
   * Limpa cache local e registros do Redis
   */
  async clear() {
    this.localCache.clear();

    const redis = getRedisClient();
    if (isRedisReady() && redis) {
      try {
        const keys = await redis.keys(`${this.prefix}*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch {}
    }
  }
}

module.exports = new ExerciseCacheService();
