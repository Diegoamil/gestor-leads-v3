import { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken, TokenPayload } from './jwt.js';

// Extender o tipo do FastifyRequest para incluir o user
declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: TokenPayload;
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Token não fornecido' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyAccessToken(token);
    request.currentUser = decoded;
  } catch (error) {
    return reply.status(401).send({ error: 'Token inválido ou expirado' });
  }
}

// Middleware para verificar se é admin_master
export async function masterOnlyMiddleware(request: FastifyRequest, reply: FastifyReply) {
  await authMiddleware(request, reply);
  if (reply.sent) return;
  if (request.currentUser?.role !== 'admin_master') {
    return reply.status(403).send({ error: 'Acesso restrito a administradores master' });
  }
}

// Middleware para verificar se é admin_master OU account_admin
export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  await authMiddleware(request, reply);
  if (reply.sent) return;
  const role = request.currentUser?.role;
  if (role !== 'admin_master' && role !== 'account_admin') {
    return reply.status(403).send({ error: 'Acesso restrito a administradores' });
  }
}
