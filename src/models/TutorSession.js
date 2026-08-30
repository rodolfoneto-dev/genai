const mongoose = require('mongoose');

const TutorMessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true,
  },
  content: {
    type: String,
    required: [true, 'Conteúdo da mensagem é obrigatório'],
    maxlength: 1000,
  },
  feedback: {
    type: String,
    default: null,
    maxlength: 500,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const getDefaultContextWindow = () => {
  const envVal = Number(process.env.TUTOR_MAX_CONTEXT_MESSAGES);
  return !isNaN(envVal) && envVal >= 2 ? Math.min(envVal, 20) : 6;
};

const TutorSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: [true, 'userId é obrigatório'],
      index: true,
    },
    cefrLevel: {
      type: String,
      enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
      default: 'B1',
    },
    topic: {
      type: String,
      default: 'General Conversation & Daily English',
      maxlength: 120,
    },
    messages: {
      type: [TutorMessageSchema],
      default: [],
    },
    maxContextMessages: {
      type: Number,
      default: getDefaultContextWindow,
      min: 2,
      max: 20,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

TutorSessionSchema.index({ userId: 1, active: 1 });
TutorSessionSchema.index({ userId: 1, topic: 1, active: 1 });

/**
 * Adiciona mensagem à sessão e aplica a janela deslizante de contexto delimitada (máx 20)
 */
TutorSessionSchema.methods.appendMessage = function (role, content, feedback = null) {
  this.messages.push({
    role,
    content,
    feedback,
    timestamp: new Date(),
  });

  const limit = Math.min(this.maxContextMessages || getDefaultContextWindow(), 20);
  // Mantém apenas as últimas N mensagens configuradas na janela deslizante
  if (this.messages.length > limit) {
    this.messages = this.messages.slice(-limit);
  }

  return this;
};

/**
 * Retorna o histórico formatado para o payload de mensagens da LLM respeitando o teto configurado
 */
TutorSessionSchema.methods.getSanitizedHistory = function () {
  const limit = Math.min(this.maxContextMessages || getDefaultContextWindow(), 20);
  const activeSlice = this.messages.slice(-limit);
  return activeSlice.map((m) => ({
    role: m.role,
    content: m.content,
  }));
};

/**
 * Helper atômico para adicionar mensagens com delimitador $slice diretamente no MongoDB
 */
TutorSessionSchema.statics.boundedAppend = async function (sessionId, newMessages = [], limit = 20) {
  const safeLimit = Math.min(limit, 20);
  const formatted = newMessages.map((m) => ({
    role: m.role,
    content: m.content,
    feedback: m.feedback || null,
    timestamp: new Date(),
  }));

  if (mongoose.connection.readyState !== 1) {
    return null;
  }

  return await this.findByIdAndUpdate(
    sessionId,
    {
      $push: {
        messages: {
          $each: formatted,
          $slice: -safeLimit,
        },
      },
    },
    { new: true }
  );
};

/**
 * Helper estático para buscar ou criar a sessão ativa do usuário vinculada ao tópico
 */
TutorSessionSchema.statics.getActiveSession = async function (userId, cefrLevel = 'B1', topic = null) {
  const defaultWindow = getDefaultContextWindow();
  const targetTopic = topic || 'General Daily English';

  if (mongoose.connection.readyState !== 1) {
    return new this({
      userId,
      cefrLevel,
      topic: targetTopic,
      maxContextMessages: defaultWindow,
      messages: [],
    });
  }

  // Busca a sessão ativa específica do usuário para este tópico exato
  let session = await this.findOne({ userId, topic: targetTopic, active: true }).sort({ updatedAt: -1 });

  if (!session) {
    session = new this({
      userId,
      cefrLevel,
      topic: targetTopic,
      maxContextMessages: defaultWindow,
      messages: [],
    });
    await session.save();
  } else if (cefrLevel && session.cefrLevel !== cefrLevel) {
    session.cefrLevel = cefrLevel;
    await session.save();
  }

  return session;
};

module.exports = mongoose.model('TutorSession', TutorSessionSchema);
