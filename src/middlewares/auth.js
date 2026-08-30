const jwt = require('jsonwebtoken');

/**
 * Middleware para verificar e decodificar token JWT obrigatório.
 * Compatível com o ecossistema UP!Experience (auth, academy, chat).
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Token de autenticação não fornecido ou formato inválido. Utilize Bearer <token>.',
      },
    });
  }

  const token = authHeader.split(' ')[1];
  const jwtSecret = process.env.JWT_SECRET || 'supersecret_staging_jwt_key_please_change';

  try {
    const decoded = jwt.verify(token, jwtSecret);

    // Validação de status ativo
    if (decoded.status && decoded.status !== 'active') {
      return res.status(403).json({
        error: {
          code: 'USER_INACTIVE',
          message: 'Usuário com acesso restrito ou inativo na plataforma.',
        },
      });
    }

    req.user = {
      id: decoded.sub || decoded.id,
      name: decoded.name || 'Usuário',
      role: decoded.role || 'aluno',
      status: decoded.status || 'active',
      email: decoded.email || null,
      emailVerified: Boolean(decoded.emailVerified),
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Sua sessão expirou. Efetue login novamente para continuar.',
        },
      });
    }
    return res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Token JWT inválido ou corrompido.',
      },
    });
  }
};

/**
 * Middleware opcional para endpoints com comportamento híbrido.
 */
const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];
  const jwtSecret = process.env.JWT_SECRET || 'supersecret_staging_jwt_key_please_change';

  try {
    const decoded = jwt.verify(token, jwtSecret);
    if (decoded.status === 'active' || !decoded.status) {
      req.user = {
        id: decoded.sub || decoded.id,
        name: decoded.name || 'Usuário',
        role: decoded.role || 'aluno',
        status: decoded.status || 'active',
        email: decoded.email || null,
        emailVerified: Boolean(decoded.emailVerified),
      };
    } else {
      req.user = null;
    }
  } catch {
    req.user = null;
  }
  next();
};

/**
 * Middleware de autorização baseada em papéis (RBAC).
 * Na v1, restrito a: 'aluno', 'professor', 'admin'.
 * 
 * NOTA DE EVOLUÇÃO FUTURA (M2M System Role):
 * Para chamadas automatizadas assíncronas do academy (ex: cron noturno para geração de exercícios em lote),
 * o papel 'system' poderá ser incluído aqui com sub: 'service_academy'.
 */
const checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Autenticação necessária para acessar este recurso.',
        },
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Acesso negado. Seu perfil (${req.user.role}) não tem permissão para esta operação.`,
          allowedRoles,
        },
      });
    }

    next();
  };
};

module.exports = {
  authenticate,
  optionalAuthenticate,
  checkRole,
};
