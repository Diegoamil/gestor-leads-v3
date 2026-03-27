import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { authMiddleware } from '../../utils/auth-middleware.js';

/**
 * META CONVERSIONS API (CAPI)
 * Migração da Edge Function `meta-capi` do Supabase.
 * Envia eventos de conversão (Lead/Purchase) para o Meta Pixel.
 */
export async function metaCapiRoutes(app: FastifyInstance) {
  app.post('/api/meta/capi', { preHandler: authMiddleware }, async (request, reply) => {
    const { leadId, stage, meta_conversion_data } = request.body as {
      leadId: string;
      stage: string;
      meta_conversion_data: string;
    };

    console.log(`[CAPI] Evento para Lead ${leadId}, Stage: ${stage}`);

    if (!meta_conversion_data) {
      return reply.send({ message: 'Sem meta_conversion_data, ignorado.' });
    }

    // Buscar configuração Meta da empresa
    let empresaPixelId = '';
    let empresaToken = '';

    if (leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { empresa_id: true },
      });

      if (lead?.empresa_id) {
        const empresa = await prisma.empresa.findUnique({
          where: { id: lead.empresa_id },
          select: { meta_pixel_id: true, meta_access_token: true },
        });
        empresaPixelId = empresa?.meta_pixel_id || '';
        empresaToken = empresa?.meta_access_token || '';
      }
    }

    if (!empresaPixelId || !empresaToken) {
      console.warn('[CAPI] Pixel ID ou Access Token não configurados');
      return reply.status(400).send({ error: 'Variáveis Meta não configuradas para esta empresa' });
    }

    const eventName = stage === 'fechado' ? 'Purchase' : 'Lead';
    const eventTime = Math.floor(Date.now() / 1000);

    const capiPayload = {
      data: [
        {
          event_name: eventName,
          event_time: eventTime,
          action_source: 'business_messaging',
          messaging_destinations: ['whatsapp'],
          user_data: {
            lead_event_source: meta_conversion_data,
          },
        },
      ],
    };

    const response = await fetch(
      `https://graph.facebook.com/v19.0/${empresaPixelId}/events?access_token=${empresaToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capiPayload),
      }
    );

    const bodyRes = await response.json();

    if (!response.ok) {
      console.error('[CAPI] Erro Meta:', bodyRes);
      return reply.status(400).send({ error: bodyRes });
    }

    console.log('[CAPI] Sucesso:', bodyRes);
    return reply.send({ success: true, meta_response: bodyRes });
  });
}
