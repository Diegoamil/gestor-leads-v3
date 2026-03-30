import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { authMiddleware } from '../../utils/auth-middleware.js';
import { env } from '../../config/env.js';

export async function whatsappRoutes(app: FastifyInstance) {
  // ── LISTAR CONEXÕES WHATSAPP POR EMPRESA ──
  app.get('/api/whatsapp/connections/:empresa_id', { preHandler: authMiddleware }, async (request, reply) => {
    const { empresa_id } = request.params as { empresa_id: string };
    const conexoes = await prisma.conexaoWhatsApp.findMany({
      where: { empresa_id },
      orderBy: { created_at: 'desc' },
    });
    return reply.send(conexoes);
  });

  // ── CRIAR INSTÂNCIA WHATSAPP ──
  app.post('/api/whatsapp/connections', { preHandler: authMiddleware }, async (request, reply) => {
    const { empresa_id, nome_instancia } = request.body as { empresa_id: string; nome_instancia: string };

    // Criar na Evolution API
    const evoRes = await fetch(`${env.EVO_URL}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': env.EVO_KEY },
      body: JSON.stringify({
        instanceName: nome_instancia,
        token: '',
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      }),
    });

    if (!evoRes.ok) {
      const err = await evoRes.text();
      return reply.status(500).send({ error: 'Erro ao criar instância na Evolution', details: err });
    }

    // Salvar no banco
    const conexao = await prisma.conexaoWhatsApp.create({
      data: {
        empresa_id,
        nome_instancia,
        evolution_instance_name: nome_instancia,
        evolution_status: 'disconnected',
      },
    });

    // Configurar webhook apontando para nossa API
    await fetch(`${env.EVO_URL}/webhook/set/${nome_instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': env.EVO_KEY },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: `${env.API_BASE_URL}/api/webhooks/evolution`,
          byEvents: true,
          base64: true,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        },
      }),
    });

    return reply.status(201).send(conexao);
  });

  // ── GERAR QR CODE ──
  app.get('/api/whatsapp/qrcode/:instance_name', { preHandler: authMiddleware }, async (request, reply) => {
    const { instance_name } = request.params as { instance_name: string };

    const evoRes = await fetch(`${env.EVO_URL}/instance/connect/${instance_name}`, {
      headers: { 'apikey': env.EVO_KEY },
    });

    const data = await evoRes.json();
    return reply.send({ qrcode: data.base64 || data.code || null });
  });

  // ── VERIFICAR STATUS DA CONEXÃO ──
  app.get('/api/whatsapp/status/:instance_name', { preHandler: authMiddleware }, async (request, reply) => {
    const { instance_name } = request.params as { instance_name: string };

    const evoRes = await fetch(`${env.EVO_URL}/instance/connectionState/${instance_name}`, {
      headers: { 'apikey': env.EVO_KEY },
    });

    const data = await evoRes.json();
    const state = data.instance?.state || 'close';

    // Atualizar no banco
    await prisma.conexaoWhatsApp.updateMany({
      where: { evolution_instance_name: instance_name },
      data: { evolution_status: state },
    });

    return reply.send({ instance_name, state });
  });

  // ── DESCONECTAR INSTÂNCIA ──
  app.delete('/api/whatsapp/connections/:instance_name', { preHandler: authMiddleware }, async (request, reply) => {
    const { instance_name } = request.params as { instance_name: string };

    await fetch(`${env.EVO_URL}/instance/logout/${instance_name}`, {
      method: 'DELETE',
      headers: { 'apikey': env.EVO_KEY },
    });

    await prisma.conexaoWhatsApp.updateMany({
      where: { evolution_instance_name: instance_name },
      data: { evolution_status: 'disconnected' },
    });

    return reply.send({ message: 'Instância desconectada' });
  });

  // ── SINCRONIZAR WEBHOOKS DE TODAS AS INSTÂNCIAS ──
  app.post('/api/whatsapp/sync-webhooks', { preHandler: authMiddleware }, async (request, reply) => {
    const conexoes = await prisma.conexaoWhatsApp.findMany();
    const results = [];

    for (const conexao of conexoes) {
      try {
        const evoRes = await fetch(`${env.EVO_URL}/webhook/set/${conexao.evolution_instance_name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': env.EVO_KEY },
          body: JSON.stringify({
            webhook: {
              enabled: true,
              url: `${env.API_BASE_URL}/api/webhooks/evolution`,
              byEvents: true,
              base64: true,
              events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
            },
          }),
        });

        results.push({
          instance: conexao.evolution_instance_name,
          success: evoRes.ok,
          status: evoRes.status,
          message: evoRes.ok ? 'Webhook sincronizado' : await evoRes.text()
        });
      } catch (error: any) {
        results.push({
          instance: conexao.evolution_instance_name,
          success: false,
          error: error.message
        });
      }
    }

    return reply.send({ total: conexoes.length, details: results });
  });
}
