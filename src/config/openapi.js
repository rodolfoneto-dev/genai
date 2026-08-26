const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'UP!Experience - GenAI Service API',
    version: '1.0.0',
    description: 'Microsserviço de Inteligência Artificial Generativa para tutoria, correção de redações e geração de exercícios pedagógicos para a plataforma UP!Experience.',
    contact: {
      name: 'UP!Experience Platform Team',
      email: 'atendimento@upexperience.com.br',
    },
  },
  servers: [
    { url: 'http://localhost:4004', description: 'Servidor Local GenAI' },
    { url: 'http://localhost:8080/genai', description: 'Edge Gateway Local' },
    { url: 'https://upexperience.vibecodia.com.br/genai', description: 'Staging Gateway' },
  ],
  tags: [
    { name: 'GenAI & Tutor', description: 'Tutor virtual, correção estruturada de redação, geração de exercícios e quotas FinOps' },
  ],
  paths: {
    '/genai/health': {
      get: {
        tags: ['GenAI & Tutor'],
        summary: 'Verificação de Saúde do GenAI Service',
        responses: {
          '200': {
            description: 'Serviço GenAI ativo e operacional',
          },
        },
      },
    },
    '/genai/tutor/chat': {
      post: {
        tags: ['Tutor'],
        summary: 'Conversar com o Tutor Virtual',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', example: 'Hello! I want to practice talking about travel.' },
                  cefrLevel: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], default: 'B1' },
                  topic: { type: 'string', example: 'Airport check-in' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Resposta do tutor gerada com sucesso' },
          '400': { description: 'Mensagem inválida ou vazia' },
          '401': { description: 'Token ausente ou expirado' },
          '429': { description: 'Quota diária de tokens excedida' },
        },
      },
    },
    '/genai/correction/essay': {
      post: {
        tags: ['Correção'],
        summary: 'Corrigir e Avaliar Redação/Texto',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['text'],
                properties: {
                  text: { type: 'string', example: 'I has been studying English for two years and I want to improve my writing.' },
                  cefrLevel: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], default: 'B1' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Avaliação estruturada em JSON' },
          '400': { description: 'Texto curto demais' },
          '401': { description: 'Não autorizado' },
          '429': { description: 'Quota excedida' },
        },
      },
    },
    '/genai/exercises/generate': {
      post: {
        tags: ['Exercícios'],
        summary: 'Gerar Exercícios Pedagógicos sob Demanda',
        security: [{ bearerAuth: [] }],
        description: 'Restrito a Professores e Administradores na v1.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['topic'],
                properties: {
                  topic: { type: 'string', example: 'Present Perfect vs Simple Past' },
                  cefrLevel: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], default: 'B1' },
                  count: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
                  type: { type: 'string', enum: ['multiple_choice', 'fill_in_the_blank', 'mixed'], default: 'mixed' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Lista de exercícios gerados' },
          '403': { description: 'Acesso negado para alunos' },
        },
      },
    },
    '/genai/usage/my-quota': {
      get: {
        tags: ['Quotas & FinOps'],
        summary: 'Consultar Saldo de Tokens do Usuário',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Saldo diário e mensal' },
        },
      },
    },
    '/genai/usage/analytics': {
      get: {
        tags: ['Quotas & FinOps'],
        summary: 'Relatório Executivo de Custos FinOps',
        security: [{ bearerAuth: [] }],
        description: 'Acessível estritamente por Administradores.',
        responses: {
          '200': { description: 'Relatório consolidado de custos' },
          '403': { description: 'Acesso negado' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Insira o token JWT no formato: Bearer <seu_token>',
      },
    },
  },
};

module.exports = openApiSpec;
