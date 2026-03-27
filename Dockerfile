FROM node:20-alpine

WORKDIR /app

# Instalar dependências
COPY package.json package-lock.json* ./
RUN npm install

# Copiar código fonte
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

# Gerar Prisma Client
RUN npx prisma generate

# Build do TypeScript
RUN npm run build

# Expor porta
EXPOSE 3333

# Comando de produção
CMD ["npm", "start"]
