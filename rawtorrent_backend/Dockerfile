FROM node:20-alpine AS base

FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create downloads directory - run as root so volume mounts with any
# ownership are accessible. On Windows Docker Desktop the bind-mount
# is always owned by root anyway.
RUN mkdir -p /app/downloads

# The port node backend listens on
EXPOSE 4000
ENV PORT=4000

CMD ["node", "dist/index.js"]
