import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { authMiddleware } from '../../utils/auth-middleware.js';

export async function leadRoutes(app: FastifyInstance) {
  // ── LISTAR LEADS POR EMPRESA ──
  app.get('/api/leads', { preHandler: authMiddleware }, async (request, reply) => {
    const { empresa_id, estagio, temperatura, page = '1', limit = '50' } = request.query as any;

    if (!empresa_id) {
      return reply.status(400).send({ error: 'empresa_id é obrigatório' });
    }

    const where: any = { empresa_id };
    if (estagio) where.estagio = estagio;
    if (temperatura) where.temperatura = temperatura;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: {
          mensagens: { orderBy: { hora: 'desc' }, take: 1 },
          _count: { select: { mensagens: true } },
        },
        orderBy: { updated_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.lead.count({ where }),
    ]);

    return reply.send({ leads, total, page: parseInt(page), limit: parseInt(limit) });
  });

  // ── BUSCAR LEAD POR ID ──
  app.get('/api/leads/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        mensagens: { orderBy: { hora: 'asc' } },
        conexao: { select: { nome_instancia: true, evolution_instance_name: true } },
      },
    });

    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' });
    return reply.send(lead);
  });

  // ── ATUALIZAR LEAD (estágio, temperatura, etc) ──
  app.put('/api/leads/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updateSchema = z.object({
      nome: z.string().optional(),
      temperatura: z.string().optional(),
      estagio: z.string().optional(),
      score: z.number().optional(),
      campanha: z.string().optional(),
      source: z.string().optional(),
    }).partial();

    const body = updateSchema.parse(request.body);
    const lead = await prisma.lead.update({ where: { id }, data: body });
    return reply.send(lead);
  });

  // ── DELETAR LEAD ──
  app.delete('/api/leads/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.lead.delete({ where: { id } });
    return reply.send({ message: 'Lead removido' });
  });

  // ── LEADS POR ESTÁGIO (Pipeline/Kanban) ──
  app.get('/api/leads/pipeline/:empresa_id', { preHandler: authMiddleware }, async (request, reply) => {
    const { empresa_id } = request.params as { empresa_id: string };
    const estagios = ['novo', 'atendimento', 'negociacao', 'agendado', 'fechado'];

    const pipeline = await Promise.all(
      estagios.map(async (estagio) => {
        const leads = await prisma.lead.findMany({
          where: { empresa_id, estagio },
          include: {
            mensagens: { orderBy: { hora: 'desc' }, take: 1 },
          },
          orderBy: { updated_at: 'desc' },
        });
        return { id: estagio, label: estagio.charAt(0).toUpperCase() + estagio.slice(1), leads };
      })
    );

    return reply.send(pipeline);
  });

  // ── DASHBOARD STATS ──
  app.get('/api/leads/stats/:empresa_id', { preHandler: authMiddleware }, async (request, reply) => {
    const { empresa_id } = request.params as { empresa_id: string };

    const [total, quentes, mornos, frios, porEstagio] = await Promise.all([
      prisma.lead.count({ where: { empresa_id } }),
      prisma.lead.count({ where: { empresa_id, temperatura: 'quente' } }),
      prisma.lead.count({ where: { empresa_id, temperatura: 'morno' } }),
      prisma.lead.count({ where: { empresa_id, temperatura: 'frio' } }),
      prisma.lead.groupBy({
        by: ['estagio'],
        where: { empresa_id },
        _count: true,
      }),
    ]);

    return reply.send({
      total,
      temperatura: { quente: quentes, morno: mornos, frio: frios },
      pipeline: porEstagio.map((g) => ({ estagio: g.estagio, count: g._count })),
    });
  });
}
