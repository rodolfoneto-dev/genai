const request = require('supertest');
const { app } = require('./server');

describe('GenAI Service - Server Integration Tests', () => {
  it('GET /health deve responder com 200 e metadados do serviço', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'genai-service',
        port: expect.any(Number),
        timestamp: expect.any(String),
        database: expect.any(String),
        aiProviders: expect.objectContaining({
          gemini: expect.any(Boolean),
          claude: expect.any(Boolean),
          defaultProvider: expect.any(String),
        }),
      })
    );
  });

  it('GET /docs.json deve responder com a especificação OpenAPI 3.0', async () => {
    const res = await request(app).get('/docs.json');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        openapi: '3.0.0',
        info: expect.objectContaining({
          title: 'English Fox - GenAI Service API',
        }),
      })
    );
  });

  it('GET /rota-inexistente deve retornar 404 no formato RFC 7807', async () => {
    const res = await request(app).get('/rota-inexistente');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Rota GET /rota-inexistente não encontrada no GenAI Service.',
      },
    });
  });
});
