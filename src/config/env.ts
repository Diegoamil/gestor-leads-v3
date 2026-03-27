import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3333),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_URL: z.string().default('redis://10.0.1.44:6379'),

  // JWT
  JWT_SECRET: z.string().default('gestor-leads-jwt-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().default('gestor-leads-refresh-secret-change-me'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // MinIO
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('midias-leads'),
  MINIO_USE_SSL: z.coerce.boolean().default(false),

  // Evolution API
  EVO_URL: z.string().default('https://apievo.wootzap.com.br'),
  EVO_KEY: z.string().default('d925d380f3e4f34d9c663817088da9b0'),

  // API URL (para uso externo)
  API_BASE_URL: z.string().default('http://157.180.45.175:3333'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
