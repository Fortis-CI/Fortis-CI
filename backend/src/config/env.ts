/**
 * env.ts — Centralized Environment Configuration
 *
 * All environment variables are validated here using Zod.
 * Import `config` from this file instead of reading process.env directly.
 * The server will fail fast on startup if required vars are missing.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Neo4j
  NEO4J_URI: z.string().default('bolt://localhost:7687'),
  NEO4J_USERNAME: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().default('fortis_password'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // GitHub (Optional initially, filled via setup wizard)
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Enterprise License
  SENTINEL_LICENSE_KEY: z.string().optional(),

  // App
  PORT: z.string().default('3001').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // JWT (optional for V1, required for V2+)
  JWT_SECRET: z.string().default('fortis-ci-dev-secret'),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    for (const issue of parsed.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\n   Copy backend/.env.example to backend/.env and fill in required values.');
    process.exit(1);
  }

  return parsed.data;
}

export const config = loadConfig();
