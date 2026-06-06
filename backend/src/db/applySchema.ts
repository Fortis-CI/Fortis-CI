/**
 * applySchema.ts — Idempotent Neo4j Schema Application
 *
 * Reads schema.cypher and executes each constraint/index command.
 * Safe to run on every boot — IF NOT EXISTS prevents errors.
 *
 * Can be run standalone: `npx ts-node src/db/applySchema.ts`
 * Or imported and called from app.ts on startup.
 */

import { driver } from './index';
import fs from 'fs';
import path from 'path';

async function applySchema() {
  const schemaPath = path.join(__dirname, 'schema.cypher');
  const cypher = fs.readFileSync(schemaPath, 'utf8');

  // Split by semi-colons, filter out comments and empty lines
  const commands = cypher
    .split(';')
    .map((cmd) => cmd.trim())
    .filter((cmd) => cmd.length > 0 && !cmd.startsWith('//'));

  const session = driver.session();
  try {
    console.log(`[Neo4j] Applying schema (${commands.length} commands)...`);
    for (const cmd of commands) {
      // Strip inline comments before executing
      const cleanCmd = cmd
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
        .trim();
      if (cleanCmd.length === 0) continue;

      await session.run(cleanCmd);
    }
    console.log('[Neo4j] Schema applied successfully.');
  } catch (error) {
    console.error('[Neo4j] Error applying schema:', error);
    throw error; // Let caller handle — don't exit process here
  } finally {
    await session.close();
    // NOTE: Do NOT close the driver here — app.ts needs it to stay open
  }
}

// Run standalone if called directly via ts-node
if (require.main === module) {
  applySchema()
    .then(() => driver.close())
    .catch(() => {
      driver.close();
      process.exit(1);
    });
}

export { applySchema };
