import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { authMiddleware, adminMiddleware } from '../../utils/auth-middleware.js';

const empresaSchema = z.object({
  nome: z.string().min(2),
  segmento: z.string().default('servicos'),
  plano: z.string().default('starter'),
  logo: z.string().optional(),
  configuracao_ia: z.any().default({}),
  meta_pixel_id: z.string().optional(),
  meta_access_token: z.string().optional(),
});

export async function companyRoutes(app: FastifyInstance) {
  // ── LISTAR EMPRESAS ──
  app.get('/api/companies', { preHandler: authMiddleware }, async (request, reply) => {
    const user = request.currentUser!;
    const where = user.role === 'admin_master'
      ? {}
      : { account_id: user.accountId };

    const empresas = await prisma.empresa.findMany({
      where,
      include: { conexoes_whatsapp: { select: { id: true, evolution_status: true, nome_instancia: true } } },
      orderBy: { created_at: 'desc' },
    });

    return reply.send(empresas);
  });

  // ── CRIAR EMPRESA ──
  app.post('/api/companies', { preHandler: adminMiddleware }, async (request, reply) => {
    const body = empresaSchema.parse(request.body);
    const user = request.currentUser!;
    const accountId = (request.body as any).account_id || user.accountId;

    if (!accountId) {
      return reply.status(400).send({ error: 'account_id é obrigatório' });
    }

    const empresa = await prisma.empresa.create({
      data: { ...body, account_id: accountId },
    });

    return reply.status(201).send(empresa);
  });

  // ── BUSCAR EMPRESA POR ID ──
  app.get('/api/companies/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const empresa = await prisma.empresa.findUnique({
      where: { id },
      include: {
        conexoes_whatsapp: true,
        _count: { select: { leads: true } },
      },
    });

    if (!empresa) return reply.status(404).send({ error: 'Empresa não encontrada' });
    return reply.send(empresa);
  });

  // ── ATUALIZAR EMPRESA ──
  app.put('/api/companies/:id', { preHandler: adminMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = empresaSchema.partial().parse(request.body);

    const empresa = await prisma.empresa.update({
      where: { id },
      data: body,
    });

    return reply.send(empresa);
  });

  // ── DELETAR EMPRESA ──
  app.delete('/api/companies/:id', { preHandler: adminMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.empresa.delete({ where: { id } });
    return reply.send({ message: 'Empresa removida' });
  });
}
