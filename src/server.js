require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { connectDB } = require('./config/db');

const app = express();
const PORT = Number(process.env.PORT) || 4004;

// ==========================================
// Middlewares Globais
// ==========================================
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ==========================================
// Healthcheck & Diagnóstico
// ==========================================
app.get(['/health', '/genai/health'], (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const aiProviders = {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    defaultProvider: process.env.DEFAULT_AI_PROVIDER || 'gemini',
  };

  return res.status(200).json({
    status: 'ok',
    service: 'genai-service',
    port: PORT,
    timestamp: new Date().toISOString(),
    database: dbStatus,
    aiProviders,
  });
});

const openApiSpec = require('./config/openapi');

// ==========================================
// Especificação OpenAPI 3.0 (/docs.json)
// ==========================================
app.get('/docs.json', (req, res) => {
  return res.status(200).json(openApiSpec);
});

// ==========================================
// Rotas de Domínio GenAI
// ==========================================
const tutorRoutes = require('./routes/tutor.routes');
const correctionRoutes = require('./routes/correction.routes');
const exercisesRoutes = require('./routes/exercises.routes');
const usageRoutes = require('./routes/usage.routes');

app.use(['/genai/tutor', '/tutor'], tutorRoutes);
app.use(['/genai/correction', '/correction'], correctionRoutes);
app.use(['/genai/exercises', '/exercises'], exercisesRoutes);
app.use(['/genai/usage', '/usage'], usageRoutes);

// ==========================================
// Tratamento de Rotas Não Encontradas (404)
// ==========================================
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Rota ${req.method} ${req.originalUrl} não encontrada no GenAI Service.`,
    },
  });
});

// ==========================================
// Middleware Global de Tratamento de Erros
// ==========================================
app.use((err, req, res, next) => {
  console.error('💥 [GenAI Global Error]:', err);

  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'Ocorreu um erro interno no GenAI Service.',
      ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
    },
  });
});

// ==========================================
// Inicialização do Servidor (se não estiver em modo teste)
// ==========================================
let server = null;

if (process.env.NODE_ENV !== 'test') {
  connectDB().catch((err) => {
    console.error('⚠️ Inicializando servidor sem conexão inicial ao banco:', err.message);
  });

  server = app.listen(PORT, () => {
    console.log(`🧠 [GenAI Service] Servidor rodando na porta ${PORT}`);
    console.log(`👉 Healthcheck: http://localhost:${PORT}/health`);
    console.log(`👉 OpenAPI Docs: http://localhost:${PORT}/docs.json`);
  });
}

module.exports = { app, server };
