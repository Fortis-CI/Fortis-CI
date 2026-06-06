# Stage 1: Build
FROM node:18-alpine AS builder
WORKDIR /app

# Install all dependencies (including devDependencies for TypeScript)
COPY package*.json ./
RUN npm ci

# Copy source code and compile TypeScript to /dist
COPY . .
RUN npx tsc && mkdir -p dist/db && cp src/db/schema.cypher dist/db/

# Stage 2: Production Runner
FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the compiled Javascript code
COPY --from=builder /app/dist ./dist

EXPOSE 3001

# Run the compiled app directly
CMD ["node", "dist/app.js"]
