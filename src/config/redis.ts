import Redis from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Necessário para BullMQ
  enableReadyCheck: false,
});

redis.on('connect', () => {
  console.log('✅ Redis conectado com sucesso');
});

redis.on('error', (err) => {
  console.error('❌ Erro Redis:', err.message);
});
