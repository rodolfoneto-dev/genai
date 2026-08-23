#!/usr/bin/env node
require('dotenv').config({ quiet: true });
// Em servidores MCP com transporte stdio, stdout é exclusivo do protocolo JSON-RPC.
console.log = console.error;
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { getTutorPrompt, getEssayCorrectionPrompt, getExerciseGenerationPrompt } = require('../../src/services/prompt-templates');

const server = new McpServer({
  name: 'genai-service-mcp',
  version: '1.0.0',
});

// ==========================================
// Resources: Exposição de Contratos
// ==========================================
server.registerResource(
  'genai-contract-markdown',
  'genai://contract.md',
  {
    title: 'Contrato do Microsserviço Generativo de IA (Markdown)',
    description: 'Documentação completa de endpoints, modelos Mongoose, regras de quota e governança FinOps.',
    mimeType: 'text/markdown',
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: `# 🧠 English Fox GenAI Service Contract
- **Porta**: 4004 (REST)
- **Provedores de IA**: Gemini 2.5 Flash / Claude 3.5 Haiku
- **Rotas**:
  - \`POST /genai/tutor/chat\` (Aluno, Professor)
  - \`POST /genai/correction/essay\` (Aluno, Professor)
  - \`POST /genai/exercises/generate\` (Professor, Admin)
  - \`GET /genai/usage/my-quota\` (Aluno, Professor, Admin)
  - \`GET /genai/usage/analytics\` (Admin)
- **FinOps**: Cache semântico de exercícios, quotas diárias por tier e limite estrito de tokens.`,
      },
    ],
  })
);

// ==========================================
// Ferramentas MCP (Tools)
// ==========================================

// Tool 1: Obter Informações do GenAI Service
server.registerTool(
  'genai_get_service_info',
  {
    title: 'Obter Informações do GenAI Service',
    description: 'Retorna a matriz de rotas, portas, provedores de IA suportados e tabela de limites de quota.',
    inputSchema: z.object({}),
  },
  async () => {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              service: 'genai-service',
              port: 4004,
              providers: ['gemini', 'claude'],
              defaultProvider: process.env.DEFAULT_AI_PROVIDER || 'gemini',
              cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
              tierLimits: {
                free: '25.000 tokens/dia',
                basic: '75.000 tokens/dia',
                premium: '250.000 tokens/dia',
                professor: '300.000 tokens/dia',
                admin: '1.000.000 tokens/dia',
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 2: Gerar Mock de Exercícios Pedagógicos
server.registerTool(
  'genai_generate_mock_exercises',
  {
    title: 'Gerar Mock de Exercícios',
    description: 'Gera uma estrutura válida de exercícios com gabarito pedagógico e explicação.',
    inputSchema: z.object({
      topic: z.string().describe('Tópico gramatical ou vocabular'),
      cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).default('B1'),
      count: z.number().int().min(1).max(5).default(3),
    }),
  },
  async ({ topic, cefrLevel, count }) => {
    const exercises = Array.from({ length: count }, (_, idx) => ({
      id: idx + 1,
      type: 'multiple_choice',
      question: `Example question ${idx + 1} about "${topic}" (${cefrLevel})`,
      options: ['Option A (Correct)', 'Option B', 'Option C', 'Option D'],
      correctAnswer: 'Option A (Correct)',
      explanation: `Explicação pedagógica da regra aplicada ao nível ${cefrLevel}.`,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ topic, cefrLevel, totalGenerated: count, exercises }, null, 2),
        },
      ],
    };
  }
);

// Tool 3: Simular Avaliação de Redação
server.registerTool(
  'genai_simulate_essay_evaluation',
  {
    title: 'Simular Avaliação de Redação',
    description: 'Simula a saída estruturada de correção de redação com erros gramaticais e sugestões.',
    inputSchema: z.object({
      text: z.string().describe('Texto do aluno'),
      cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).default('B1'),
    }),
  },
  async ({ text, cefrLevel }) => {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              overallScore: 8.5,
              cefrLevel,
              summary: 'Texto bem estruturado com ótima coesão textual.',
              grammarErrors: [
                {
                  original: text.slice(0, 20),
                  corrected: text.slice(0, 20),
                  explanation: 'Nenhum erro grave detectado nesta amostra.',
                },
              ],
              vocabularySuggestions: [
                { original: 'good', suggestion: 'remarkable', context: 'Enriquecimento lexical' },
              ],
              revisedText: text,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Execução se chamado diretamente
if (require.main === module) {
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error('❌ [GenAI MCP Server Error]:', err);
    process.exit(1);
  });
}

module.exports = server;
