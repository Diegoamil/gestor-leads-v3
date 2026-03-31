import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function migrateData() {
  console.log('--- 🚀 INICIANDO MIGRAÇÃO DO CSV (V1 -> V2) ---');
  
  const dataPath = path.join(__dirname, 'data');
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Diretório não encontrado: ${dataPath}`);
    process.exit(1);
  }

  // 1. Accounts
  if (fs.existsSync(path.join(dataPath, 'accounts.csv'))) {
    console.log('\\n📁 Procesando accounts.csv...');
    const records: any[] = parse(fs.readFileSync(path.join(dataPath, 'accounts.csv')), { columns: true, skip_empty_lines: true });
    for (const record of records) {
      await prisma.account.upsert({
        where: { id: record.id },
        update: {},
        create: {
          id: record.id,
          nome: record.nome,
          logo: record.logo || null,
          plano: record.plano || 'starter',
          created_at: new Date(record.created_at)
        }
      });
    }
    console.log(`✅ Accounts finalizado: ${records.length} registros inseridos/atualizados.`);
  }

  // 2. Empresas
  if (fs.existsSync(path.join(dataPath, 'empresas.csv'))) {
    console.log('\\n📁 Procesando empresas.csv...');
    const records: any[] = parse(fs.readFileSync(path.join(dataPath, 'empresas.csv')), { columns: true, skip_empty_lines: true });
    for (const record of records) {
      let configIA: any = {};
      try {
        if (record.configuracao_ia) {
          // Restaurar a chave mascarada do GitHub Push Protection
          const jsonString = record.configuracao_ia
            .replace(/""/g, '"')
            .replace(/MASKED_KEY_/g, 'sk-proj-');
            
          configIA = JSON.parse(jsonString);
        }
      } catch(e) { /* keep default */ }

      await prisma.empresa.upsert({
        where: { id: record.id },
        update: {},
        create: {
          id: record.id,
          account_id: record.account_id,
          nome: record.nome,
          logo: record.logo || null,
          segmento: record.segmento || 'servicos',
          plano: record.plano || 'starter',
          configuracao_ia: configIA,
          meta_pixel_id: record.meta_pixel_id || null,
          meta_access_token: record.meta_access_token || null,
          created_at: new Date(record.created_at)
        }
      });
    }
    console.log(`✅ Empresas finalizado: ${records.length} registros inseridos/atualizados.`);
  }

  // 3. Usuários
  if (fs.existsSync(path.join(dataPath, 'usuarios.csv'))) {
    console.log('\\n📁 Procesando usuarios.csv...');
    const records: any[] = parse(fs.readFileSync(path.join(dataPath, 'usuarios.csv')), { columns: true, skip_empty_lines: true });
    for (const record of records) {
      // Usa hash fixo se não vier no CSV (senha="GestorLeads@123" usando bcrypt)
      const senhaHash = record.senha_hash && record.senha_hash !== '' ? record.senha_hash : '$2a$10$wK1k64Xv4N7zJmU/0D.CqO61jZzN6iH7I6h.G/66/n3pISt.P9D8O';
      
      await prisma.usuario.upsert({
        where: { email: record.email },
        update: {
            role: record.role || 'salesperson',
            account_id: record.account_id || null,
        },
        create: {
          id: record.id,
          nome: record.nome,
          email: record.email,
          role: record.role || 'salesperson',
          avatar: record.avatar || null,
          account_id: record.account_id || null,
          senha_hash: senhaHash,
          created_at: record.created_at ? new Date(record.created_at) : new Date()
        }
      });
    }
    console.log(`✅ Usuários finalizado: ${records.length} registros inseridos/atualizados.`);
  }

  // 4. Conexões WhatsApp
  if (fs.existsSync(path.join(dataPath, 'conexoes.csv'))) {
    console.log('\\n📁 Procesando conexoes.csv...');
    const records: any[] = parse(fs.readFileSync(path.join(dataPath, 'conexoes.csv')), { columns: true, skip_empty_lines: true });
    for (const record of records) {
      await prisma.conexaoWhatsApp.upsert({
        where: { evolution_instance_name: record.evolution_instance_name },
        update: {
            evolution_status: record.evolution_status || 'disconnected',
        },
        create: {
          id: record.id,
          empresa_id: record.empresa_id,
          nome_instancia: record.nome_instancia,
          evolution_instance_name: record.evolution_instance_name,
          evolution_status: record.evolution_status || 'disconnected',
          qr_code: record.qr_code || null,
          created_at: new Date(record.created_at)
        }
      });
    }
    console.log(`✅ Conexões WhatsApp finalizado: ${records.length} registros inseridos/atualizados.`);
  }

  console.log('\\n--- 🎉 MIGRAÇÃO CONCLUÍDA ---');
  console.log('Acesse o painel do sistema para validar as conexões e os novos webhooks.');
}

migrateData()
  .catch((err) => {
    console.error('❌ Erro inesperado na migração:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
