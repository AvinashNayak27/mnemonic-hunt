# Backend-only Dockerfile (web excluded)
FROM node:20-alpine AS builder

WORKDIR /app

# Copy backend package files only
COPY package.json package-lock.json* ./

# Install all deps for build
RUN npm ci

# Copy backend source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package files
COPY package.json package-lock.json* ./

# Install production deps only
RUN npm ci --omit=dev

# Copy built output from builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
