import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

const prisma = new PrismaClient();

async function syncWebhooks() {
  console.log('🔄 Iniciando sincronização de webhooks das instâncias conectadas...');
  
  const conexoes = await prisma.conexaoWhatsApp.findMany();
  console.log(`📡 Encontradas ${conexoes.length} conexões no banco de dados.`);

  if (conexoes.length === 0) {
    console.log('⚠️ Nenhuma conexão encontrada no banco de dados.');
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (const conexao of conexoes) {
    try {
      console.log(`\n🔄 Sincronizando instância: ${conexao.evolution_instance_name}...`);
      
      const webhookUrl = `${env.API_BASE_URL}/api/webhooks/evolution`;
      console.log(`📍 Webhook URL: ${webhookUrl}`);

      const payload = {
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: true,
          base64: true,
          events: [
            'MESSAGES_UPSERT', 
            'MESSAGES_UPDATE', 
            'CONNECTION_UPDATE', 
            'QRCODE_UPDATED',
            'SEND_MESSAGE'
          ],
        },
      };

      const evoRes = await fetch(`${env.EVO_URL}/webhook/set/${conexao.evolution_instance_name}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'apikey': env.EVO_KEY 
        },
        body: JSON.stringify(payload),
      });

      if (evoRes.ok) {
        console.log(`✅ SUCESSO: ${conexao.evolution_instance_name}`);
        successCount++;
      } else {
        const errorText = await evoRes.text();
        console.error(`❌ FALHA: ${conexao.evolution_instance_name} (Status: ${evoRes.status}) - ${errorText}`);
        failCount++;
      }
    } catch (err: any) {
      console.error(`❌ ERRO CRÍTICO em ${conexao.evolution_instance_name}: ${err.message}`);
      failCount++;
    }
  }

  console.log('\n✨ Sincronização concluída!');
  console.log(`✅ Sucessos: ${successCount}`);
  console.log(`❌ Falhas: ${failCount}`);
}

syncWebhooks()
  .catch((err) => {
    console.error('❌ Erro inesperado no script:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
