#!/usr/bin/env node
const jwt = require('jsonwebtoken');

const role = process.argv[2] || 'aluno';
const validRoles = ['aluno', 'professor', 'admin'];

if (!validRoles.includes(role)) {
  console.error(`❌ Papel inválido: "${role}". Utilize: ${validRoles.join(', ')}`);
  process.exit(1);
}

const secret = process.env.JWT_SECRET || 'supersecret_staging_jwt_key_please_change';

const payloads = {
  aluno: {
    sub: 'user_student_dev_1',
    name: 'Aluno Teste GenAI',
    role: 'aluno',
    status: 'active',
    email: 'aluno@upexperience.com.br',
    emailVerified: true,
  },
  professor: {
    sub: 'user_teacher_dev_1',
    name: 'Professor Teste GenAI',
    role: 'professor',
    status: 'active',
    email: 'professor@upexperience.com.br',
    emailVerified: true,
  },
  admin: {
    sub: 'user_admin_dev_1',
    name: 'Admin Master GenAI',
    role: 'admin',
    status: 'active',
    email: 'admin@upexperience.com.br',
    emailVerified: true,
  },
};

const payload = payloads[role];
const token = jwt.sign(payload, secret, { expiresIn: '7d' });

console.log('================================================================');
console.log(`🔑 Token JWT Gerado para o GenAI Service [ROLE: ${role.toUpperCase()}]`);
console.log('================================================================');
console.log(`Bearer ${token}`);
console.log('================================================================');
