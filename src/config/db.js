const mongoose = require('mongoose');

let isConnected = false;

const connectDB = async (uri) => {
  const mongoUri = uri || process.env.MONGODB_URI || 'mongodb://localhost:27017/englishfox_genai';

  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    isConnected = true;
    console.log(`🍃 [GenAI DB] MongoDB Conectado: ${conn.connection.host}/${conn.connection.name}`);
    return conn.connection;
  } catch (err) {
    console.error('❌ [GenAI DB] Erro ao conectar ao MongoDB:', err.message);
    isConnected = false;
    throw err;
  }
};

const disconnectDB = async () => {
  if (isConnected || mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    console.log('🍃 [GenAI DB] MongoDB desconectado.');
  }
};

module.exports = { connectDB, disconnectDB };
