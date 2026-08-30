const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_staging_jwt_key_please_change';

const studentToken = jwt.sign(
  { sub: 'student_test_1', name: 'Aluno Teste', role: 'aluno', status: 'active', email: 'aluno@upexperience.com.br' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const teacherToken = jwt.sign(
  { sub: 'teacher_test_1', name: 'Professor Teste', role: 'professor', status: 'active', email: 'professor@upexperience.com.br' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const adminToken = jwt.sign(
  { sub: 'admin_test_1', name: 'Admin Master', role: 'admin', status: 'active', email: 'admin@upexperience.com.br' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

describe('GenAI Service - Domain Routes Integration Tests', () => {
  describe('POST /genai/tutor/chat', () => {
    it('deve retornar 401 se não estiver autenticado', async () => {
      const res = await request(app).post('/genai/tutor/chat').send({ message: 'Hello' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('deve retornar 400 se a mensagem for vazia', async () => {
      const res = await request(app)
        .post('/genai/tutor/chat')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ message: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('deve processar mensagem e retornar resposta do tutor com sucesso (200)', async () => {
      const res = await request(app)
        .post('/genai/tutor/chat')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          message: 'Hello teacher! I want to practice talking about my weekend.',
          cefrLevel: 'B1',
          topic: 'Weekend Activities',
        });

      expect(res.status).toBe(200);
      expect(res.body.reply).toBeDefined();
      expect(res.body.session).toEqual(
        expect.objectContaining({
          cefrLevel: 'B1',
          topic: 'Weekend Activities',
          totalMessages: expect.any(Number),
        })
      );
      expect(res.body.usage).toBeDefined();
    });
  });

  describe('GET /genai/tutor/history', () => {
    it('deve retornar 401 se não estiver autenticado', async () => {
      const res = await request(app).get('/genai/tutor/history');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('deve retornar histórico isolado por tópico (200)', async () => {
      const res = await request(app)
        .get('/genai/tutor/history')
        .query({ topic: 'Airport & Travel', cefrLevel: 'A2' })
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          sessionId: expect.any(String),
          topic: 'Airport & Travel',
          cefrLevel: 'A2',
          totalMessages: expect.any(Number),
          messages: expect.any(Array),
        })
      );
    });
  });

  describe('POST /genai/tutor/chat/stream (SSE)', () => {
    it('deve retornar 401 se não estiver autenticado', async () => {
      const res = await request(app).post('/genai/tutor/chat/stream').send({ message: 'Hello' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('deve retornar 400 se a mensagem for inválida', async () => {
      const res = await request(app)
        .post('/genai/tutor/chat/stream')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ message: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('deve transmitir resposta via Server-Sent Events com eventos start, chunk e done (200)', async () => {
      const res = await request(app)
        .post('/genai/tutor/chat/stream')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          message: 'Can you explain the difference between for and since?',
          cefrLevel: 'B1',
          topic: 'Grammar explanations',
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['cache-control']).toContain('no-cache');

      // Verifica eventos emitidos no corpo do SSE
      expect(res.text).toContain('event: start');
      expect(res.text).toContain('event: chunk');
      expect(res.text).toContain('event: done');
      expect(res.text).toContain('sessionId');
      expect(res.text).toContain('usage');
    });
  });

  describe('POST /genai/correction/essay', () => {
    it('deve retornar 400 se o texto for curto demais (< 10 caracteres)', async () => {
      const res = await request(app)
        .post('/genai/correction/essay')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ text: 'Too short' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('deve avaliar redação e retornar JSON estruturado com correções (200)', async () => {
      const res = await request(app)
        .post('/genai/correction/essay')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          text: 'I has been studying English for two years and I want to improve my writing skills.',
          cefrLevel: 'B2',
        });

      expect(res.status).toBe(200);
      expect(res.body.correction).toEqual(
        expect.objectContaining({
          overallScore: expect.any(Number),
          cefrLevel: expect.any(String),
          grammarErrors: expect.any(Array),
          vocabularySuggestions: expect.any(Array),
          revisedText: expect.any(String),
        })
      );
      expect(res.body.usage).toBeDefined();
    });
  });

  describe('POST /genai/exercises/generate', () => {
    it('deve retornar 403 Forbidden se um ALUNO tentar gerar exercícios', async () => {
      const res = await request(app)
        .post('/genai/exercises/generate')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ topic: 'Simple Past', cefrLevel: 'A2', count: 3 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('deve gerar exercícios com sucesso quando chamado por um PROFESSOR (200)', async () => {
      const res = await request(app)
        .post('/genai/exercises/generate')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          topic: 'Present Continuous for Future',
          cefrLevel: 'B1',
          count: 3,
          type: 'multiple_choice',
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          topic: expect.any(String),
          cefrLevel: 'B1',
          totalGenerated: 3,
          exercises: expect.any(Array),
        })
      );
      expect(res.body.data.exercises[0]).toHaveProperty('correctAnswer');
      expect(res.body.data.exercises[0]).toHaveProperty('explanation');
    });

    it('deve permitir geração quando chamado por um ADMIN (200)', async () => {
      const res = await request(app)
        .post('/genai/exercises/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          topic: 'Conditionals',
          cefrLevel: 'B2',
          count: 2,
        });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /genai/usage/my-quota', () => {
    it('deve retornar o saldo de quotas do usuário autenticado', async () => {
      const res = await request(app)
        .get('/genai/usage/my-quota')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          userId: 'student_test_1',
          role: 'aluno',
          daily: expect.objectContaining({
            limit: expect.any(Number),
            used: expect.any(Number),
            remaining: expect.any(Number),
            percentUsed: expect.any(Number),
          }),
          monthly: expect.objectContaining({
            limit: expect.any(Number),
            used: expect.any(Number),
            remaining: expect.any(Number),
          }),
        })
      );
    });
  });

  describe('GET /genai/usage/analytics', () => {
    it('deve bloquear com 403 se um aluno ou professor tentar acessar o analytics', async () => {
      const resStudent = await request(app)
        .get('/genai/usage/analytics')
        .set('Authorization', `Bearer ${studentToken}`);
      expect(resStudent.status).toBe(403);

      const resTeacher = await request(app)
        .get('/genai/usage/analytics')
        .set('Authorization', `Bearer ${teacherToken}`);
      expect(resTeacher.status).toBe(403);
    });

    it('deve retornar relatório FinOps consolidado quando chamado por um ADMIN (200)', async () => {
      const res = await request(app)
        .get('/genai/usage/analytics')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          finOpsReport: expect.any(String),
          generatedAt: expect.any(String),
          overview: expect.any(Object),
          byFeature: expect.any(Array),
          topConsumers: expect.any(Array),
        })
      );
    });
  });
});
