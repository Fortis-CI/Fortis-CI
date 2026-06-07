import fs from 'fs';
import { createPhysicalInfra, linkHostedOn } from './graphService';

export async function importInfraContract(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[Infra] Contract file not found at ${filePath}`);
    return;
  }

  console.log(`[Infra] Ingesting infrastructure contract from ${filePath}...`);
  try {
    const fileContents = fs.readFileSync(filePath, 'utf8');
    const contract = JSON.parse(fileContents);

    if (!contract.environments || !Array.isArray(contract.environments)) {
      console.warn('[Infra] Invalid contract format: missing environments array.');
      return;
    }

    let createdCount = 0;
    let linkedCount = 0;

    for (const env of contract.environments) {
      const envName = env.name || 'production';

      if (env.physical_infrastructure && Array.isArray(env.physical_infrastructure)) {
        for (const infra of env.physical_infrastructure) {
          if (!infra.id || !infra.name) continue;

          try {
            await createPhysicalInfra(
              infra.id,
              infra.name,
              infra.type || 'unknown',
              infra.provider || 'unknown',
              envName
            );
            createdCount++;

            if (infra.hosts_logical_resources && Array.isArray(infra.hosts_logical_resources)) {
              for (const logicalRes of infra.hosts_logical_resources) {
                await linkHostedOn(logicalRes, infra.id);
                linkedCount++;
              }
            }
          } catch (err) {
            console.warn(`[Infra] Failed to import PhysicalInfra ${infra.id}:`, err);
          }
        }
      }
    }

    console.log(`[Infra] Contract import complete: created ${createdCount} physical nodes, linked ${linkedCount} logical resources.`);
  } catch (err) {
    console.error(`[Infra] Failed to parse JSON contract:`, err);
  }
}
