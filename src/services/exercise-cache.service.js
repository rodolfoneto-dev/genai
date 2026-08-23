/**
 * Serviço de Cache para Exercícios Gerados.
 * Garante que requisições sobre o mesmo tópico e nível CEFR sejam entregues
 * instantaneamente com latência de ~5ms e CUSTO $0 de API de IA.
 */
class ExerciseCacheService {
  constructor(ttlMinutes = 60 * 24 * 7) {
    this.cache = new Map();
    this.ttlMs = ttlMinutes * 60 * 1000; // 7 dias de retenção padrão
  }

  generateKey(topic, cefrLevel, count, type) {
    const cleanTopic = topic.trim().toLowerCase().replace(/\s+/g, '-');
    return `exercise:${cleanTopic}:${cefrLevel.toUpperCase()}:${count}:${type}`;
  }

  get(topic, cefrLevel, count, type) {
    const key = this.generateKey(topic, cefrLevel, count, type);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(topic, cefrLevel, count, type, data) {
    const key = this.generateKey(topic, cefrLevel, count, type);
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
      cachedAt: new Date().toISOString(),
    });
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = new ExerciseCacheService();
