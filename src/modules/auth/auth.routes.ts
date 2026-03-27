import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { hashPassword, comparePassword, generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import { authMiddleware } from '../../utils/auth-middleware.js';

const registerSchema = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  senha: z.string().min(6),
  account_nome: z.string().min(2).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
  // ── REGISTRO ──
  app.post('/api/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);

    const existing = await prisma.usuario.findUnique({ where: { email: body.email } });
    if (existing) {
      return reply.status(409).send({ error: 'E-mail já cadastrado' });
    }

    const senha_hash = await hashPassword(body.senha);

    // Cria account + usuário juntos
    const account = await prisma.account.create({
      data: {
        nome: body.account_nome || body.nome,
        plano: 'starter',
      },
    });

    const user = await prisma.usuario.create({
      data: {
        nome: body.nome,
        email: body.email,
        senha_hash,
        role: 'account_admin',
        account_id: account.id,
      },
    });

    const tokenPayload = { userId: user.id, email: user.email, role: user.role, accountId: account.id };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return reply.status(201).send({
      user: { id: user.id, nome: user.nome, email: user.email, role: user.role },
      account: { id: account.id, nome: account.nome },
      accessToken,
      refreshToken,
    });
  });

  // ── LOGIN ──
  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = await prisma.usuario.findUnique({
      where: { email: body.email },
      include: { account: true },
    });

    if (!user) {
      return reply.status(401).send({ error: 'E-mail ou senha inválidos' });
    }

    const validPassword = await comparePassword(body.senha, user.senha_hash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'E-mail ou senha inválidos' });
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      accountId: user.account_id || undefined,
    };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return reply.send({
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        account_id: user.account_id,
        empresa_ids: user.empresa_ids,
      },
      account: user.account ? { id: user.account.id, nome: user.account.nome, plano: user.account.plano } : null,
      accessToken,
      refreshToken,
    });
  });

  // ── REFRESH TOKEN ──
  app.post('/api/auth/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    if (!refreshToken) {
      return reply.status(401).send({ error: 'Refresh token não fornecido' });
    }

    try {
      const decoded = verifyRefreshToken(refreshToken);
      const user = await prisma.usuario.findUnique({ where: { id: decoded.userId } });
      if (!user) {
        return reply.status(401).send({ error: 'Usuário não encontrado' });
      }

      const tokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        accountId: user.account_id || undefined,
      };

      return reply.send({
        accessToken: generateAccessToken(tokenPayload),
        refreshToken: generateRefreshToken(tokenPayload),
      });
    } catch {
      return reply.status(401).send({ error: 'Refresh token inválido' });
    }
  });

  // ── ME (dados do usuário logado) ──
  app.get('/api/auth/me', { preHandler: authMiddleware }, async (request, reply) => {
    const user = await prisma.usuario.findUnique({
      where: { id: request.currentUser!.userId },
      include: { account: true },
    });

    if (!user) {
      return reply.status(404).send({ error: 'Usuário não encontrado' });
    }

    // Buscar empresas do account
    const empresas = user.account_id
      ? await prisma.empresa.findMany({ where: { account_id: user.account_id } })
      : [];

    // Buscar todas accounts (se admin_master)
    const accounts = user.role === 'admin_master'
      ? await prisma.account.findMany()
      : user.account ? [user.account] : [];

    return reply.send({
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        account_id: user.account_id,
        empresa_ids: user.empresa_ids,
      },
      account: user.account,
      accounts,
      empresas,
    });
  });
}
