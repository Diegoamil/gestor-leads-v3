import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { llmQueue } from '../../workers/llm-processor.worker.js';

/**
 * WEBHOOK EVOLUTION API
 * Migração direta da Edge Function `evolution-webhook` do Supabase.
 * Recebe eventos: CONNECTION_UPDATE, MESSAGES_UPSERT, MESSAGES_UPDATE
 */
export async function webhookRoutes(app: FastifyInstance) {
  app.post('/api/webhooks/evolution', async (request, reply) => {
    try {
      const payload = request.body as any;
      console.log('[WEBHOOK] Evento recebido:', payload.event, 'Instância:', payload.instance);

      // Log para depuração (opcional, pode desativar em produção)
      try {
        await prisma.webhookLog.create({
          data: {
            instance_name: payload.instance || 'unknown',
            event_type: payload.event || 'unknown',
            payload: payload,
          },
        });
      } catch (logErr) {
        console.error('[WEBHOOK] Erro ao salvar log:', logErr);
      }

      // ═══════════════════════════════════════════════
      // EVENTO 1: Status de Conexão
      // ═══════════════════════════════════════════════
      if (
        (payload.event === 'connection.update' ||
          payload.event === 'CONNECTION_UPDATE' ||
          payload.event === 'status.instance') &&
        payload.data
      ) {
        const dataNode = Array.isArray(payload.data) ? payload.data[0] : payload.data;
        const instanceName = payload.instance || payload.instanceName || dataNode.instance;

        if (!instanceName) {
          return reply.send({ error: 'Instance not found' });
        }

        const state = dataNode.state || dataNode.status || 'disconnected';
        await prisma.conexaoWhatsApp.updateMany({
          where: { evolution_instance_name: instanceName },
          data: { evolution_status: state, updated_at: new Date() },
        });

        // Emitir evento via Socket.io (se disponível)
        const io = (app as any).io;
        if (io) {
          io.emit('whatsapp:status', { instanceName, state });
        }

        return reply.send({ success: true, status: state });
      }

      // ═══════════════════════════════════════════════
      // EVENTO 2: Mensagens
      // ═══════════════════════════════════════════════
      if (
        (payload.event === 'messages.upsert' || payload.event === 'MESSAGES_UPSERT') &&
        payload.data
      ) {
        const dataNode = Array.isArray(payload.data) ? payload.data[0] : payload.data;
        const messageData = dataNode.message;
        const instanceName = payload.instance || payload.instanceName || dataNode.instance;

        if (!messageData || !instanceName) {
          return reply.send({ error: 'Sem messageData ou instanceName' });
        }

        const remoteJid = dataNode.key?.remoteJid;
        const fromMe = dataNode.key?.fromMe;
        if (!remoteJid || remoteJid.includes('@g.us')) {
          return reply.send({ message: 'Ignorado (grupo ou sem JID)' });
        }

        const senderNumber = remoteJid.split('@')[0];

        // Extrair texto
        let textContent = '';
        if (messageData.conversation) textContent = messageData.conversation;
        else if (messageData.extendedTextMessage?.text) textContent = messageData.extendedTextMessage.text;
        else if (messageData.imageMessage) textContent = messageData.imageMessage.caption || '[Imagem]';
        else if (messageData.videoMessage) textContent = messageData.videoMessage.caption || '[Vídeo]';
        else if (messageData.audioMessage) textContent = '[Áudio]';
        else if (messageData.documentMessage) textContent = messageData.documentMessage.title || messageData.documentMessage.fileName || '[Documento]';

        // 1. Achar Empresa e Conexão
        const conexao = await prisma.conexaoWhatsApp.findFirst({
          where: { evolution_instance_name: instanceName },
          select: { id: true, empresa_id: true },
        });

        if (!conexao) {
          return reply.send({ error: 'Instância não vinculada' });
        }

        const empresaId = conexao.empresa_id;

        // ── RASTREAMENTO: Meta Ads ──
        const contextInfo = dataNode.contextInfo || messageData.contextInfo || messageData.extendedTextMessage?.contextInfo;

        let leadSource = 'Orgânico';
        let metaConversionData: string | null = null;
        let adTitle: string | null = null;
        let adBody: string | null = null;
        let adSourceUrl: string | null = null;
        let adThumbnailUrl: string | null = null;
        let adSourceId: string | null = null;
        let adSourceApp: string | null = null;

        if (contextInfo?.conversionSource === 'FB_Ads' || contextInfo?.externalAdReply) {
          if (contextInfo.conversionSource === 'FB_Ads') leadSource = 'Meta Ads';

          if (contextInfo.conversionData) {
            try {
              const cdValues = Object.values(contextInfo.conversionData) as number[];
              const cdArray = new Uint8Array(cdValues.map((v) => Number(v)));
              metaConversionData = new TextDecoder().decode(cdArray);
            } catch (e) {
              console.error('[WEBHOOK] Erro ao decodificar conversionData:', e);
            }
          }

          if (contextInfo.externalAdReply) {
            adTitle = contextInfo.externalAdReply.title;
            adBody = contextInfo.externalAdReply.body;
            adSourceUrl = contextInfo.externalAdReply.sourceUrl;
            adSourceId = contextInfo.externalAdReply.sourceId;
            adSourceApp = contextInfo.externalAdReply.sourceApp;

            // Thumbnail
            const thumbData = contextInfo.externalAdReply.thumbnail;
            if (thumbData && typeof thumbData === 'object') {
              try {
                const thumbValues = Object.values(thumbData) as number[];
                const thumbArray = new Uint8Array(thumbValues.map((v) => Number(v)));
                adThumbnailUrl = `data:image/jpeg;base64,${Buffer.from(thumbArray).toString('base64')}`;
              } catch (e) {
                console.error('[WEBHOOK] Erro thumb:', e);
              }
            }
            if (!adThumbnailUrl) {
              adThumbnailUrl = contextInfo.externalAdReply.thumbnailUrl || contextInfo.externalAdReply.originalImageUrl;
            }

            // Enriquecimento Meta Graph API
            const empresa = await prisma.empresa.findUnique({
              where: { id: empresaId },
              select: { meta_access_token: true },
            });

            if (adSourceId && empresa?.meta_access_token) {
              try {
                console.log(`[WEBHOOK] Buscando detalhes do anúncio ${adSourceId}...`);
                const metaRes = await fetch(
                  `https://graph.facebook.com/v20.0/${adSourceId}?fields=campaign{name},adset{name},name&access_token=${empresa.meta_access_token}`
                );
                if (metaRes.ok) {
                  const metaData = await metaRes.json();
                  if (metaData.campaign?.name) leadSource = metaData.campaign.name;
                  console.log(`[WEBHOOK] Meta API: Campaign=${metaData.campaign?.name}, Adset=${metaData.adset?.name}`);
                }
              } catch (metaErr) {
                console.error('[WEBHOOK] Meta API Error:', metaErr);
              }
            }

            if (leadSource === 'Orgânico') leadSource = 'Meta Ads';
          }
        }

        // Regex SRC (fonte customizada no texto)
        if (textContent) {
          const srcRegex = /\[SRC:(.*?)\]/;
          const match = textContent.match(srcRegex);
          if (match) {
            leadSource = match[1];
            textContent = textContent.replace(srcRegex, '').trim();
          } else if (textContent.toLowerCase().includes('vim pelo link da bio')) {
            leadSource = 'Instagram Bio';
          }
        }

        // 2. Achar ou Criar Lead
        let lead = await prisma.lead.findFirst({
          where: { empresa_id: empresaId, telefone_jid: senderNumber },
          select: { id: true, nome: true, avatar: true, conexao_id: true },
        });

        const profilePicUrl = !fromMe && dataNode.profilePicUrl ? dataNode.profilePicUrl : null;
        const pushNameFromPayload = !fromMe && dataNode.pushName ? dataNode.pushName : null;

        if (!lead) {
          const newLead = await prisma.lead.create({
            data: {
              empresa_id: empresaId,
              conexao_id: conexao.id,
              telefone_jid: senderNumber,
              nome: pushNameFromPayload || senderNumber,
              avatar: profilePicUrl,
              estagio: 'novo',
              temperatura: 'frio',
              source: leadSource,
              meta_conversion_data: metaConversionData,
              ad_title: adTitle,
              ad_body: adBody,
              ad_source_url: adSourceUrl,
              ad_thumbnail_url: adThumbnailUrl,
              ad_source_id: adSourceId,
              ad_source_app: adSourceApp,
              campanha: leadSource !== 'Orgânico' ? leadSource : null,
              veiculo: adSourceApp || undefined,
            },
            select: { id: true },
          });
          lead = { id: newLead.id, nome: pushNameFromPayload || senderNumber, avatar: profilePicUrl, conexao_id: conexao.id };
        } else {
          const updatePayload: any = { ultima_interacao: new Date() };
          if (pushNameFromPayload) updatePayload.nome = pushNameFromPayload;
          if (profilePicUrl) updatePayload.avatar = profilePicUrl;
          if (leadSource !== 'Orgânico') {
            updatePayload.source = leadSource;
            if (metaConversionData) updatePayload.meta_conversion_data = metaConversionData;
            if (adTitle) updatePayload.ad_title = adTitle;
            if (adBody) updatePayload.ad_body = adBody;
            if (adSourceUrl) updatePayload.ad_source_url = adSourceUrl;
            if (adThumbnailUrl) updatePayload.ad_thumbnail_url = adThumbnailUrl;
            if (adSourceId) updatePayload.ad_source_id = adSourceId;
            if (adSourceApp) updatePayload.ad_source_app = adSourceApp;
            if (leadSource !== 'Orgânico') updatePayload.campanha = leadSource;
            if (adSourceApp) updatePayload.veiculo = adSourceApp;
          }
          await prisma.lead.update({ where: { id: lead.id }, data: updatePayload });
        }

        // ── PROCESSAMENTO DE MÍDIA (BASE64) ──
        let midiaUrl: string | null = null;
        const mediaNode = messageData.imageMessage || messageData.videoMessage || messageData.audioMessage;
        let base64Data = messageData.base64 || mediaNode?.base64 || dataNode.base64;

        // Fallback: buscar base64 via API da Evolution
        if (!base64Data && mediaNode) {
          console.log(`[WEBHOOK] Base64 ausente. Tentando via API Evolution...`);
          try {
            const fetchRes = await fetch(`${env.EVO_URL}/chat/getBase64FromMediaMessage/${instanceName}`, {
              method: 'POST',
              headers: { apikey: env.EVO_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: dataNode.message }),
            });
            if (fetchRes.ok) {
              const resJson = await fetchRes.json();
              if (resJson.base64) base64Data = resJson.base64;
            }
          } catch (apiErr) {
            console.error('[WEBHOOK] Erro fetch base64:', apiErr);
          }
        }

        if (base64Data) {
          // TODO: Implementar upload para MinIO
          // Por enquanto, salvamos a referência
          const isAudio = !!messageData.audioMessage;
          const isVideo = !!messageData.videoMessage;
          const extension = isAudio ? 'ogg' : isVideo ? 'mp4' : 'jpg';
          midiaUrl = `pending_upload_${Date.now()}_${senderNumber}.${extension}`;

          // Transcrição de áudio via Whisper
          if (isAudio && base64Data) {
            try {
              const empresa = await prisma.empresa.findUnique({
                where: { id: empresaId },
                select: { configuracao_ia: true },
              });
              const config = empresa?.configuracao_ia as any;
              const openAiKey = config?.llm_api_key;

              if (openAiKey) {
                const binaryData = Buffer.from(base64Data, 'base64');
                const formData = new FormData();
                formData.append('file', new Blob([binaryData], { type: 'audio/ogg' }), 'audio.ogg');
                formData.append('model', 'whisper-1');

                const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${openAiKey}` },
                  body: formData,
                });

                if (whisperRes.ok) {
                  const whisperData = await whisperRes.json();
                  if (whisperData.text) textContent = `[Transcrição de Áudio]: ${whisperData.text}`;
                }
              }
            } catch (e) {
              console.error('[WEBHOOK] Whisper Error:', e);
            }
          }
        }

        // 3. Salvar Mensagem
        if (lead) {
          await prisma.mensagem.create({
            data: {
              lead_id: lead.id,
              texto: textContent,
              origem: fromMe ? 'vendedor' : 'cliente',
              midia_url: midiaUrl,
            },
          });

          // Adicionar à fila LLM
          await prisma.llmQueue.upsert({
            where: { lead_id: lead.id },
            update: { status: 'pending', last_message_at: new Date(), updated_at: new Date() },
            create: { lead_id: lead.id, empresa_id: empresaId, status: 'pending', last_message_at: new Date() },
          });

          // Emitir evento via Socket.io
          const io = (app as any).io;
          if (io) {
            io.to(`empresa:${empresaId}`).emit('lead:message', {
              lead_id: lead.id,
              texto: textContent,
              origem: fromMe ? 'vendedor' : 'cliente',
              midia_url: midiaUrl,
            });
          }
        }

        return reply.send({ success: true, lead_id: lead?.id, midia_url: midiaUrl });
      }

      // EVENTO 3: Atualização de Mensagem
      if (payload.event === 'messages.update' || payload.event === 'MESSAGES_UPDATE') {
        console.log('[WEBHOOK] Evento MESSAGES_UPDATE recebido');
      }

      return reply.send({ message: 'Evento não tratado' });
    } catch (error: any) {
      console.error('[WEBHOOK] Internal Error:', error);
      return reply.send({ error: error.message });
    }
  });
}
