import Fastify from 'fastify';
import cors from '@fastify/cors';
import http from 'http';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { setupWebSocket } from './websocket/socket.js';
import { startLlmWorker } from './workers/llm-processor.worker.js';

// Rotas
import { authRoutes } from './modules/auth/auth.routes.js';
import { companyRoutes } from './modules/companies/company.routes.js';
import { leadRoutes } from './modules/leads/lead.routes.js';
import { messageRoutes } from './modules/messages/message.routes.js';
import { userRoutes } from './modules/users/user.routes.js';
import { whatsappRoutes } from './modules/whatsapp/whatsapp.routes.js';
import { webhookRoutes } from './modules/whatsapp/webhook.routes.js';
import { metaCapiRoutes } from './modules/meta/capi.routes.js';

async function bootstrap() {
  console.log('🚀 Iniciando Gestor de Leads API...');

  // 1. Conectar no banco
  await connectDatabase();

  // 2. Criar servidor Fastify
  const app = Fastify({
    logger: env.NODE_ENV === 'development',
    trustProxy: true,
  });

  // 3. CORS
  await app.register(cors, {
    origin: true, // Permite todas as origens (em produção, restringir)
    credentials: true,
  });

  // 4. Error handler global
  app.setErrorHandler((error: any, request, reply) => {
    console.error('[ERROR]', error);

    if (error.validation) {
      return reply.status(400).send({
        error: 'Dados inválidos',
        details: error.validation,
      });
    }

    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
      error: error.message || 'Internal Server Error',
    });
  });

  // 5. Health check
  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  // 6. Registrar rotas
  await app.register(authRoutes);
  await app.register(companyRoutes);
  await app.register(leadRoutes);
  await app.register(messageRoutes);
  await app.register(userRoutes);
  await app.register(whatsappRoutes);
  await app.register(webhookRoutes);
  await app.register(metaCapiRoutes);

  // 7. Iniciar servidor HTTP
  const serverInstance = await app.listen({ port: env.PORT, host: env.HOST });
  console.log(`✅ API rodando em ${serverInstance}`);

  // 8. Configurar WebSocket (Socket.io)
  const rawServer = app.server as http.Server;
  const io = setupWebSocket(rawServer);
  (app as any).io = io; // Disponibilizar io nas rotas

  // 9. Iniciar Worker LLM
  startLlmWorker();

  // 10. Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Encerrando servidor...');
    await app.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('❌ Falha ao iniciar servidor:', err);
  process.exit(1);
});
