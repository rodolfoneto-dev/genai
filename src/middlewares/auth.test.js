const jwt = require('jsonwebtoken');
const { authenticate, checkRole, optionalAuthenticate } = require('./auth');

const JWT_SECRET = 'test_jwt_secret_12345';
process.env.JWT_SECRET = JWT_SECRET;

describe('GenAI Service - Auth Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe('authenticate()', () => {
    it('deve rejeitar requisição sem header Authorization', () => {
      authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'UNAUTHORIZED' }) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve rejeitar requisição com token mal formatado', () => {
      req.headers.authorization = 'InvalidTokenFormat';
      authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve rejeitar token expirado', () => {
      const expiredToken = jwt.sign(
        { sub: 'user_123', role: 'aluno', status: 'active' },
        JWT_SECRET,
        { expiresIn: -10 }
      );
      req.headers.authorization = `Bearer ${expiredToken}`;

      authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'TOKEN_EXPIRED' }) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve rejeitar usuário com status inativo', () => {
      const inactiveToken = jwt.sign(
        { sub: 'user_blocked', role: 'aluno', status: 'suspended' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      req.headers.authorization = `Bearer ${inactiveToken}`;

      authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'USER_INACTIVE' }) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve autenticar e preencher req.user com token válido', () => {
      const validToken = jwt.sign(
        { sub: 'user_student_1', name: 'Maria Silva', role: 'aluno', status: 'active', email: 'maria@upexperience.com.br' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      req.headers.authorization = `Bearer ${validToken}`;

      authenticate(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({
        id: 'user_student_1',
        name: 'Maria Silva',
        role: 'aluno',
        status: 'active',
        email: 'maria@upexperience.com.br',
        emailVerified: false,
      });
    });
  });

  describe('checkRole()', () => {
    it('deve autorizar quando o papel do usuário estiver na lista permitida', () => {
      req.user = { id: 'prof_1', role: 'professor' };
      const middleware = checkRole('professor', 'admin');

      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve bloquear com 403 quando o papel não for permitido', () => {
      req.user = { id: 'student_1', role: 'aluno' };
      const middleware = checkRole('professor', 'admin');

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'FORBIDDEN' }) })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuthenticate()', () => {
    it('deve preencher req.user como null se não houver token e chamar next', () => {
      optionalAuthenticate(req, res, next);
      expect(req.user).toBeNull();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve decodificar token quando fornecido', () => {
      const token = jwt.sign({ sub: 'user_opt', role: 'professor' }, JWT_SECRET);
      req.headers.authorization = `Bearer ${token}`;

      optionalAuthenticate(req, res, next);
      expect(req.user.id).toBe('user_opt');
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
