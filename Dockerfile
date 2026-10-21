# ==========================================
# 1. Build Stage
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client and build NestJS app
RUN npx prisma generate
RUN npm run build

# ==========================================
# 2. Production Stage
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts & dependencies
COPY package*.json ./
COPY prisma ./prisma/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 3000

# Sync the database schema with prisma/schema.prisma before starting, so new
# tables/columns (conversations, messages, avatar, bio, ...) exist after a deploy.
# `db push` refuses destructive changes, so it never drops data silently.
# Set DB_SYNC_ON_START=false to skip.
CMD ["sh", "-c", "if [ \"$DB_SYNC_ON_START\" != \"false\" ]; then npx prisma db push --skip-generate || exit 1; fi; exec node dist/main.js"]
