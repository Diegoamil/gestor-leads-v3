import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { authMiddleware } from '../../utils/auth-middleware.js';

export async function messageRoutes(app: FastifyInstance) {
  // ── LISTAR MENSAGENS DE UM LEAD ──
  app.get('/api/messages/:lead_id', { preHandler: authMiddleware }, async (request, reply) => {
    const { lead_id } = request.params as { lead_id: string };
    const { page = '1', limit = '100' } = request.query as any;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [mensagens, total] = await Promise.all([
      prisma.mensagem.findMany({
        where: { lead_id },
        orderBy: { hora: 'asc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.mensagem.count({ where: { lead_id } }),
    ]);

    return reply.send({ mensagens, total });
  });

  // ── ENVIAR MENSAGEM MANUAL (vendedor) ──
  app.post('/api/messages', { preHandler: authMiddleware }, async (request, reply) => {
    const { lead_id, texto, midia_url } = request.body as {
      lead_id: string;
      texto: string;
      midia_url?: string;
    };

    if (!lead_id || !texto) {
      return reply.status(400).send({ error: 'lead_id e texto são obrigatórios' });
    }

    const mensagem = await prisma.mensagem.create({
      data: {
        lead_id,
        texto,
        origem: 'vendedor',
        midia_url,
      },
    });

    // Atualizar última interação do lead
    await prisma.lead.update({
      where: { id: lead_id },
      data: { ultima_interacao: new Date() },
    });

    return reply.status(201).send(mensagem);
  });
}
