import * as Minio from 'minio';
import { env } from './env.js';

// Cria a instância do cliente MinIO com base nas variáveis de ambiente
export const minioClient = new Minio.Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

/**
 * Função responsável por garantir que o bucket de mídias existe,
 * e se não, cria e configura sua política de acesso público (leitura).
 */
export async function initializeMinio() {
  const bucketName = env.MINIO_BUCKET;

  try {
    const exists = await minioClient.bucketExists(bucketName);
    
    if (exists) {
      console.log(`[MinIO] Bucket "${bucketName}" já existe.`);
    } else {
      console.log(`[MinIO] Criando bucket "${bucketName}"...`);
      // Cria o bucket (opcional: informar a região, default us-east-1)
      await minioClient.makeBucket(bucketName, 'us-east-1');
      console.log(`[MinIO] Bucket "${bucketName}" criado com sucesso.`);

      // Configura a política de acesso para Leitura Pública (apenas GET)
      const policy = {
        Version: "2012-10-17",
        Statement: [
          {
            Action: ["s3:GetObject"],
            Effect: "Allow",
            Principal: {
              AWS: ["*"]
            },
            Resource: [`arn:aws:s3:::${bucketName}/*`]
          }
        ]
      };
      await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
      console.log(`[MinIO] Política pública de leitura configurada para "${bucketName}".`);
    }
  } catch (error) {
    console.error('[MinIO] Erro ao inicializar bucket:', error);
    // Lançar erro ou tratar conforme necessário
    throw error;
  }
}
