import fs from 'fs';
import yaml from 'js-yaml';
import { createService, createDependsOnService, createLogicalResource, createDependsOnResource } from '../services/graphService';

export async function importYamlServices(filePath: string) {
  // 1. Check if passed via Environment Variable first (Terraform preferred)
  if (process.env.SERVICES_YAML) {
    console.log(`[Service] Found SERVICES_YAML environment variable. Attempting auto-import...`);
    await parseYamlString(process.env.SERVICES_YAML);
    return;
  }

  // 2. Fallback to file path
  if (!fs.existsSync(filePath)) {
    return;
  }

  console.log(`[Service] Found YAML registry at ${filePath}. Attempting auto-import...`);
  try {
    const fileContents = fs.readFileSync(filePath, 'utf8');
    await parseYamlString(fileContents);
  } catch (err) {
    console.error(`[Service] Failed to read YAML file at ${filePath}:`, err);
  }
}

async function parseYamlString(yamlString: string) {
  try {
    const parsed = yaml.load(yamlString) as any;

    if (!parsed || !parsed.services || !Array.isArray(parsed.services)) {
      console.warn('[Service] YAML file does not contain a valid "services" array.');
      return;
    }

    let createdCount = 0;
    
    for (const svc of parsed.services) {
      if (!svc.name || !svc.repo || !svc.health_url) {
        console.warn(`[Service] Skipping invalid service entry:`, svc);
        continue;
      }

      try {
        const service = await createService({
          name: svc.name,
          repoUrl: svc.repo.startsWith('http') ? svc.repo : `https://github.com/${svc.repo}`,
          healthEndpoint: svc.health_url,
          environment: svc.environment || 'production',
        });

        // Parse dependencies
        if (svc.dependencies) {
          // 1. Service Dependencies
          if (svc.dependencies.services && Array.isArray(svc.dependencies.services)) {
            for (const depSvc of svc.dependencies.services) {
              try {
                const criticality = depSvc.criticality === 'soft' ? 'soft' : 'hard';
                await createDependsOnService(service.id, depSvc.name, criticality);
              } catch (err) {
                console.warn(`[Service] Failed to create service dependency ${depSvc.name}:`, err);
              }
            }
          }

          // 2. Resource Dependencies
          if (svc.dependencies.resources && Array.isArray(svc.dependencies.resources)) {
            for (const depRes of svc.dependencies.resources) {
              try {
                await createLogicalResource(depRes.name, depRes.type || 'unknown');
                await createDependsOnResource(service.id, depRes.name);
              } catch (err) {
                console.warn(`[Service] Failed to create resource dependency ${depRes.name}:`, err);
              }
            }
          }
        }
        
        createdCount++;
      } catch (err: any) {
        // If the service already exists, it will throw a constraint error. That's fine.
        if (err.code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
          console.log(`[Service] Service ${svc.name} is already registered.`);
        } else {
          console.warn(`[Service] Failed to import ${svc.name}:`, err.message);
        }
      }
    }
    
    console.log(`[Service] YAML auto-import complete: registered ${createdCount} new services.`);
  } catch (err) {
    console.error(`[Service] Failed to parse YAML content:`, err);
  }
}
