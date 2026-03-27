import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';

// ══════════════════════════════════════════════════════════════
// FILA LLM — Processamento de IA para Qualificação de Leads
// Migração do process-llm-queue e ia-processor do Supabase
// ══════════════════════════════════════════════════════════════

const QUEUE_NAME = 'gestor-leads:llm-process';
const DEBOUNCE_MS = 3 * 60 * 1000; // 3 minutos de debounce
const POLL_INTERVAL_MS = 30 * 1000; // Verificar a cada 30 segundos

export const llmQueue = new Queue(QUEUE_NAME, { connection: redis });

// Worker que processa a fila
export function startLlmWorker() {
  console.log('🤖 Worker LLM iniciado — aguardando leads para qualificar...');

  // Polling periódico: busca leads na tabela llm_queue que estão
  // com status 'pending' e última mensagem há mais de 3 minutos
  const pollInterval = setInterval(async () => {
    try {
      const thresholdDate = new Date(Date.now() - DEBOUNCE_MS);

      const queueItems = await prisma.llmQueue.findMany({
        where: {
          status: 'pending',
          last_message_at: { lte: thresholdDate },
        },
        take: 10,
      });

      if (queueItems.length === 0) return;

      console.log(`[LLM Worker] ${queueItems.length} lead(s) prontos para processamento`);

      for (const item of queueItems) {
        await processLead(item.lead_id, item.empresa_id, item.id);
      }
    } catch (error) {
      console.error('[LLM Worker] Erro no polling:', error);
    }
  }, POLL_INTERVAL_MS);

  // Limpar intervalo no encerramento
  process.on('SIGTERM', () => clearInterval(pollInterval));
  process.on('SIGINT', () => clearInterval(pollInterval));
}

async function processLead(leadId: string, empresaId: string, queueId: string) {
  try {
    // Marcar como processando
    await prisma.llmQueue.update({
      where: { id: queueId },
      data: { status: 'processing' },
    });

    // Buscar configuração IA da empresa
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { configuracao_ia: true },
    });

    const config = empresa?.configuracao_ia as any;
    if (!config || !config.llm_api_key) {
      console.log(`[LLM] Empresa ${empresaId} sem chave API. Pulando lead ${leadId}.`);
      await prisma.llmQueue.delete({ where: { id: queueId } });
      return;
    }

    // Buscar histórico de mensagens
    const historico = await prisma.mensagem.findMany({
      where: { lead_id: leadId },
      orderBy: { hora: 'asc' },
      take: 100,
    });

    if (!historico || historico.length === 0) {
      await prisma.llmQueue.delete({ where: { id: queueId } });
      return;
    }

    const chatText = historico
      .map((m) => `[${new Date(m.hora).toLocaleTimeString('pt-BR')}] ${m.origem.toUpperCase()}: ${m.texto}`)
      .join('\n');

    // Montar prompt
    const prompt = buildSystemPrompt(config);

    // Chamar LLM
    if (config.llm_provider === 'openai' || !config.llm_provider) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.llm_api_key}`,
        },
        body: JSON.stringify({
          model: config.llm_model || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `HISTORICO DA CONVERSA:\n${chatText}` },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      });

      if (!res.ok) {
        const errorRaw = await res.text();
        throw new Error('Falha na chamada LLM: ' + errorRaw);
      }

      const llmData = await res.json();
      const jsonString = llmData.choices[0].message.content;
      const analise = JSON.parse(jsonString);

      // Salvar conclusões da IA no lead
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          temperatura: analise.temperatura || 'frio',
          estagio: analise.estagio || 'atendimento',
          resumo_ia: analise.resumoIA || analise.resumo_ia || '',
          sugestao_ia: analise.sugestaoIA || analise.sugestao_ia || '',
          alertas: analise.alertas || [],
        },
      });

      console.log(
        `[LLM] ✅ Lead ${leadId}: temp=${analise.temperatura}, estagio=${analise.estagio}`
      );
    }

    // Remover da fila
    await prisma.llmQueue.delete({ where: { id: queueId } });
    console.log(`[LLM] Lead ${leadId} processado e removido da fila`);
  } catch (error: any) {
    console.error(`[LLM] ❌ Erro ao processar Lead ${leadId}:`, error.message);
    // Devolver para fila como pending com incremento de retries
    await prisma.llmQueue.update({
      where: { id: queueId },
      data: { status: 'pending', retries: { increment: 1 } },
    });
  }
}

function buildSystemPrompt(config: any): string {
  const defaultJson = `{
  "temperatura": "quente|morno|frio",
  "estagio": "novo|atendimento|negociacao|agendado|fechado",
  "resumoIA": "...",
  "sugestaoIA": "...",
  "alertas": ["alerta1", "alerta2"]
}`;

  const gatilhos = Object.entries(config.gatilhosEstagios || {})
    .map(([e, regras]: any) => (regras && regras.length ? `[${e.toUpperCase()}]: ${regras.join(', ')}` : ''))
    .filter(Boolean)
    .join('\n');

  return `Você é um Analista de Vendas Sênior atuando no nicho de ${config.segmento || 'empresas'}.
Produto: "${config.tipoProduto || 'N/A'}".

Missão: Leia o histórico e retorne a análise num arquivo JSON perfeitamente estruturado.
NÃO INCLUA MARKDOWN, RETORNE APENAS AS CHAVES DO JSON.
Modelo requerido:
${defaultJson}

REGRAS TEMPERATURA:
Quente se: ${config.criteriosLeadQuente?.join(', ') || 'demonstrar intenção.'}
Frio se for só curiosidade.

REGRAS QUALIFICAÇÃO/ESTÁGIO:
${config.regrasQualificacao?.join('\n') || ''}
${gatilhos || 'Aja pelo bom senso'}

INSTRUÇÕES EXTRAS DO DIRETOR:
${config.instrucoesAdicionais || 'Nenhuma.'}`;
}
