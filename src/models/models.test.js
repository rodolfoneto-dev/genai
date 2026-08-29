const mongoose = require('mongoose');
const AiUsageLog = require('./AiUsageLog');
const UserQuota = require('./UserQuota');
const TutorSession = require('./TutorSession');

describe('GenAI Service - Mongoose Models Unit Tests', () => {
  describe('AiUsageLog Model', () => {
    it('deve validar campos obrigatórios (userId, feature, provider, model)', () => {
      const log = new AiUsageLog({});
      const err = log.validateSync();

      expect(err.errors.userId).toBeDefined();
      expect(err.errors.feature).toBeDefined();
      expect(err.errors.provider).toBeDefined();
    });

    it('deve rejeitar enum inválido de feature e provider', () => {
      const log = new AiUsageLog({
        userId: 'user_1',
        feature: 'invalid_feature',
        provider: 'openai', // Apenas gemini e claude permitidos no escopo
      });
      const err = log.validateSync();

      expect(err.errors.feature).toBeDefined();
      expect(err.errors.provider).toBeDefined();
    });

    it('deve instanciar modelo com defaults corretos', () => {
      const log = new AiUsageLog({
        userId: 'user_test',
        feature: 'tutor',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        promptTokens: 150,
        completionTokens: 50,
      });

      expect(log.totalTokens).toBe(0); // Antes de hook/salvamento
      expect(log.status).toBe('success');
      expect(log.cefrLevel).toBe('all');
      expect(log.role).toBe('aluno');
    });
  });

  describe('UserQuota Model', () => {
    it('deve inicializar com limites padrão corretos para Free tier', () => {
      const quota = new UserQuota({
        userId: 'user_free_1',
        role: 'aluno',
        tier: 'free',
      });

      expect(quota.dailyTokenLimit).toBe(25000);
      expect(quota.monthlyTokenLimit).toBe(500000);
      expect(quota.dailyTokensUsed).toBe(0);
      expect(quota.monthlyTokensUsed).toBe(0);
    });

    it('hasAvailableQuota deve aprovar quando dentro do limite e rejeitar quando excedido', () => {
      const quota = new UserQuota({
        userId: 'user_quota_test',
        dailyTokenLimit: 1000,
        monthlyTokenLimit: 10000,
        dailyTokensUsed: 900,
        monthlyTokensUsed: 900,
        lastResetDate: new Date(),
      });

      // 900 + 50 <= 1000 -> permitido
      const checkAllowed = quota.hasAvailableQuota(50);
      expect(checkAllowed.allowed).toBe(true);
      expect(checkAllowed.dailyRemaining).toBe(100);

      // 900 + 150 > 1000 -> bloqueado
      const checkBlocked = quota.hasAvailableQuota(150);
      expect(checkBlocked.allowed).toBe(false);
    });

    it('checkAndResetDailyQuota deve zerar dailyTokensUsed se a data for de ontem', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const quota = new UserQuota({
        userId: 'user_yesterday',
        dailyTokenLimit: 25000,
        dailyTokensUsed: 15000,
        monthlyTokensUsed: 15000,
        lastResetDate: yesterday,
      });

      quota.checkAndResetDailyQuota();
      expect(quota.dailyTokensUsed).toBe(0);
      expect(quota.monthlyTokensUsed).toBe(15000);
    });

    it('consumeTokensAtomic deve permitir consumo dentro do limite e atualizar saldo', async () => {
      const quota = new UserQuota({
        userId: 'user_atomic_1',
        dailyTokenLimit: 1000,
        dailyTokensUsed: 200,
        monthlyTokenLimit: 10000,
        monthlyTokensUsed: 200,
      });

      jest.spyOn(UserQuota, 'getOrCreateQuota').mockResolvedValueOnce(quota);

      const result = await UserQuota.consumeTokensAtomic('user_atomic_1', 300, 'aluno');
      expect(result.allowed).toBe(true);
      expect(quota.dailyTokensUsed).toBe(500);
    });

    it('consumeTokensAtomic deve bloquear quando o consumo ultrapassar o limite diário', async () => {
      const quota = new UserQuota({
        userId: 'user_atomic_2',
        dailyTokenLimit: 1000,
        dailyTokensUsed: 900,
        monthlyTokenLimit: 10000,
        monthlyTokensUsed: 900,
      });

      jest.spyOn(UserQuota, 'getOrCreateQuota').mockResolvedValueOnce(quota);

      const result = await UserQuota.consumeTokensAtomic('user_atomic_2', 200, 'aluno');
      expect(result.allowed).toBe(false);
      expect(result.dailyRemaining).toBe(100);
    });

    it('consumeTokensAtomic deve conceder bypass automático para perfil admin', async () => {
      const result = await UserQuota.consumeTokensAtomic('admin_user', 999999, 'admin');
      expect(result.allowed).toBe(true);
    });
  });

  describe('TutorSession Model', () => {
    it('appendMessage deve respeitar a janela deslizante de maxContextMessages', () => {
      const session = new TutorSession({
        userId: 'student_123',
        cefrLevel: 'B1',
        maxContextMessages: 4,
        messages: [],
      });

      session.appendMessage('user', 'Hello');
      session.appendMessage('assistant', 'Hi there!');
      session.appendMessage('user', 'How are you?');
      session.appendMessage('assistant', 'I am doing great!');
      expect(session.messages.length).toBe(4);

      // Adiciona 5ª mensagem -> deve descartar a 1ª
      session.appendMessage('user', 'What is the topic today?');
      expect(session.messages.length).toBe(4);
      expect(session.messages[0].content).toBe('Hi there!');
      expect(session.messages[3].content).toBe('What is the topic today?');
    });

    it('getSanitizedHistory deve retornar array sem campos extras de banco', () => {
      const session = new TutorSession({
        userId: 'student_123',
        messages: [
          { role: 'user', content: 'Good morning', feedback: 'Perfeito!' },
          { role: 'assistant', content: 'Good morning! Ready for today?' },
        ],
      });

      const history = session.getSanitizedHistory();
      expect(history).toEqual([
        { role: 'user', content: 'Good morning' },
        { role: 'assistant', content: 'Good morning! Ready for today?' },
      ]);
    });

    it('deve usar o valor de process.env.TUTOR_MAX_CONTEXT_MESSAGES quando instanciado', () => {
      process.env.TUTOR_MAX_CONTEXT_MESSAGES = '8';
      const session = new TutorSession({
        userId: 'student_env_test',
      });

      expect(session.maxContextMessages).toBe(8);
      delete process.env.TUTOR_MAX_CONTEXT_MESSAGES;
    });

    it('deve limitar o teto máximo de mensagens a 20 mesmo que configurado maior', () => {
      process.env.TUTOR_MAX_CONTEXT_MESSAGES = '50';
      const session = new TutorSession({
        userId: 'student_cap_test',
      });

      expect(session.maxContextMessages).toBe(20);
      delete process.env.TUTOR_MAX_CONTEXT_MESSAGES;

      // Adiciona 25 mensagens
      for (let i = 1; i <= 25; i++) {
        session.appendMessage('user', `Message ${i}`);
      }

      expect(session.messages.length).toBe(20);
      expect(session.messages[0].content).toBe('Message 6');
      expect(session.messages[19].content).toBe('Message 25');
    });
  });
});
