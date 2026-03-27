import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { authMiddleware, adminMiddleware } from '../../utils/auth-middleware.js';
import { hashPassword } from '../../utils/jwt.js';

const userSchema = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  senha: z.string().min(6).optional(),
  role: z.string().default('salesperson'),
  account_id: z.string().optional(),
  empresa_ids: z.array(z.string()).default([]),
  avatar: z.string().optional(),
});

export async function userRoutes(app: FastifyInstance) {
  // ── LISTAR USUÁRIOS ──
  app.get('/api/users', { preHandler: adminMiddleware }, async (request, reply) => {
    const user = request.currentUser!;
    const where = user.role === 'admin_master' ? {} : { account_id: user.accountId };

    const users = await prisma.usuario.findMany({
      where,
      select: {
        id: true, nome: true, email: true, role: true,
        avatar: true, account_id: true, empresa_ids: true, created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });

    return reply.send(users);
  });

  // ── CRIAR USUÁRIO ──
  app.post('/api/users', { preHandler: adminMiddleware }, async (request, reply) => {
    const body = userSchema.parse(request.body);
    const existing = await prisma.usuario.findUnique({ where: { email: body.email } });
    if (existing) return reply.status(409).send({ error: 'E-mail já cadastrado' });

    const senha_hash = await hashPassword(body.senha || 'mudar123');
    const accountId = body.account_id || request.currentUser!.accountId;

    const user = await prisma.usuario.create({
      data: {
        nome: body.nome,
        email: body.email,
        senha_hash,
        role: body.role,
        account_id: accountId,
        empresa_ids: body.empresa_ids,
        avatar: body.avatar,
      },
      select: { id: true, nome: true, email: true, role: true, account_id: true, empresa_ids: true },
    });

    return reply.status(201).send(user);
  });

  // ── ATUALIZAR USUÁRIO ──
  app.put('/api/users/:id', { preHandler: adminMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = userSchema.partial().parse(request.body);
    const data: any = { ...body };
    if (body.senha) {
      data.senha_hash = await hashPassword(body.senha);
      delete data.senha;
    }

    const user = await prisma.usuario.update({
      where: { id },
      data,
      select: { id: true, nome: true, email: true, role: true, account_id: true, empresa_ids: true },
    });

    return reply.send(user);
  });

  // ── DELETAR USUÁRIO ──
  app.delete('/api/users/:id', { preHandler: adminMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.usuario.delete({ where: { id } });
    return reply.send({ message: 'Usuário removido' });
  });
}
