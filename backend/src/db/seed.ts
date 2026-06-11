import { executeQuery } from './index';

async function seed() {
  console.log('Seeding Fortis-CI database with demo data...');

  try {
    // 1. Clear existing demo data (optional, but good for idempotency)
    await executeQuery(`MATCH (n) DETACH DELETE n`);
    console.log('Cleared existing graph data.');

    // 2. Create Services
    await executeQuery(`
      CREATE (s1:Service { id: 'srv-frontend-001', name: 'fortis-ci-frontend', repoUrl: 'https://github.com/ganeshak11/Fortis-CI', environment: 'production', healthEndpoint: 'http://localhost:3000/api/health' })
      CREATE (s2:Service { id: 'srv-backend-001', name: 'fortis-ci-backend', repoUrl: 'https://github.com/ganeshak11/Fortis-CI', environment: 'production', healthEndpoint: 'http://localhost:3001/api/health-status' })
      CREATE (s3:Service { id: 'srv-payment-001', name: 'payment-gateway', repoUrl: 'https://github.com/ganeshak11/payment-gateway', environment: 'production', healthEndpoint: 'http://localhost:5000/health/payment' })
      CREATE (s4:Service { id: 'srv-auth-001', name: 'auth-service', repoUrl: 'https://github.com/ganeshak11/auth-service', environment: 'production', healthEndpoint: 'http://localhost:5000/health/auth' })
      CREATE (s5:Service { id: 'srv-db-001', name: 'postgres-db', repoUrl: 'https://github.com/ganeshak11/postgres-db', environment: 'production', healthEndpoint: 'http://localhost:5000/health/db' })
    `);
    console.log('Created Services.');

    // 2.5 Create Dependencies
    await executeQuery(`
      MATCH (frontend:Service {name: 'fortis-ci-frontend'})
      MATCH (backend:Service {name: 'fortis-ci-backend'})
      MATCH (payment:Service {name: 'payment-gateway'})
      MATCH (auth:Service {name: 'auth-service'})
      MATCH (db:Service {name: 'postgres-db'})
      MERGE (frontend)-[:DEPENDS_ON_SERVICE {criticality: 'hard'}]->(backend)
      MERGE (backend)-[:DEPENDS_ON_SERVICE {criticality: 'hard'}]->(payment)
      MERGE (backend)-[:DEPENDS_ON_SERVICE {criticality: 'hard'}]->(auth)
      MERGE (payment)-[:DEPENDS_ON_SERVICE {criticality: 'hard'}]->(auth)
      MERGE (payment)-[:DEPENDS_ON_SERVICE {criticality: 'hard'}]->(db)
      MERGE (auth)-[:DEPENDS_ON_SERVICE {criticality: 'hard'}]->(db)
      
      WITH 1 as dummy
      OPTIONAL MATCH (sentinelFrontend:Service {name: 'sentinel-frontend'})
      OPTIONAL MATCH (sentinelBackend:Service {name: 'sentinel-backend'})
      FOREACH (i IN CASE WHEN sentinelFrontend IS NOT NULL AND sentinelBackend IS NOT NULL THEN [1] ELSE [] END |
        MERGE (sentinelFrontend)-[:DEPENDS_ON_SERVICE {criticality: 'hard'}]->(sentinelBackend)
      )
    `);
    console.log('Created Dependencies.');

    // 3. Create Commits and Files
    await executeQuery(`
      CREATE (c1:Commit { sha: 'a1b2c3d4', message: 'Initial commit', author: 'ganeshak11' })
      CREATE (c2:Commit { sha: 'e5f6g7h8', message: 'Add bug in webhook processing', author: 'ganeshak11' })
      CREATE (c3:Commit { sha: 'i9j0k1l2', message: 'Fix webhook processing bug', author: 'ganeshak11' })
      
      CREATE (f1:File { id: 'file-1', path: 'backend/src/services/webhookService.ts' })
      CREATE (f2:File { id: 'file-2', path: 'frontend/app/page.tsx' })
      
      WITH c1, c2, c3, f1, f2
      CREATE (c1)-[:CHANGED_FILE]->(f2)
      CREATE (c2)-[:CHANGED_FILE]->(f1)
      CREATE (c3)-[:CHANGED_FILE]->(f1)
    `);
    console.log('Created Commits and Files.');

    // 4. Create Deployments
    const now = new Date();
    const tenMinsAgo = new Date(now.getTime() - 10 * 60000);
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60000);
    const twoMinsAgo = new Date(now.getTime() - 2 * 60000);

    await executeQuery(`
      MATCH (backend:Service {name: 'fortis-ci-backend'})
      MATCH (frontend:Service {name: 'fortis-ci-frontend'})
      MATCH (c1:Commit {sha: 'a1b2c3d4'})
      MATCH (c2:Commit {sha: 'e5f6g7h8'})
      MATCH (c3:Commit {sha: 'i9j0k1l2'})
      
      // Deployment 1: Successful Frontend deploy
      CREATE (d1:Deployment {
        id: 'dep-001',
        workflowRunId: 'run-1001',
        workflowName: 'Deploy Frontend',
        status: 'completed',
        conclusion: 'success',
        branch: 'main',
        triggeredBy: 'ganeshak11',
        startedAt: $d1_time,
        completedAt: $d1_time,
        duration: 120,
        serviceId: backend.id
      })
      CREATE (backend)<-[:DEPLOYED_TO]-(d1)-[:BASED_ON]->(c1)

      // Deployment 2: Failed Backend deploy
      CREATE (d2:Deployment {
        id: 'dep-002',
        workflowRunId: 'run-1002',
        workflowName: 'Deploy Backend',
        status: 'completed',
        conclusion: 'failure',
        branch: 'main',
        triggeredBy: 'ganeshak11',
        startedAt: $d2_time,
        completedAt: $d2_time,
        duration: 45,
        serviceId: backend.id
      })
      CREATE (backend)<-[:DEPLOYED_TO]-(d2)-[:BASED_ON]->(c2)

      // Deployment 3: Successful Backend deploy (Fix)
      CREATE (d3:Deployment {
        id: 'dep-003',
        workflowRunId: 'run-1003',
        workflowName: 'Deploy Backend',
        status: 'completed',
        conclusion: 'success',
        branch: 'main',
        triggeredBy: 'ganeshak11',
        startedAt: $d3_time,
        completedAt: $d3_time,
        duration: 110,
        serviceId: backend.id
      })
      CREATE (backend)<-[:DEPLOYED_TO]-(d3)-[:BASED_ON]->(c3)
    `, {
      d1_time: tenMinsAgo.toISOString(),
      d2_time: fiveMinsAgo.toISOString(),
      d3_time: twoMinsAgo.toISOString()
    });
    console.log('Created Deployments.');

    // 5. Create Error Patterns and HealthChecks
    await executeQuery(`
      MATCH (d2:Deployment {id: 'dep-002'})
      MATCH (backend:Service {name: 'fortis-ci-backend'})
      MATCH (f1:File {path: 'backend/src/services/webhookService.ts'})
      
      CREATE (e1:ErrorPattern {
        id: 'err-001',
        type: 'SyntaxError',
        severity: 'critical',
        message: 'Unexpected token in JSON at position 0'
      })
      CREATE (d2)-[:CAUSED_ERROR]->(e1)
      CREATE (e1)-[:RELATED_TO_FILE]->(f1)
      
      CREATE (h1:HealthCheck {
        id: 'hc-001',
        serviceId: backend.id,
        status: 'unhealthy',
        statusCode: 500,
        latencyMs: 0,
        checkedAt: $h1_time,
        error: 'Connection refused'
      })
      CREATE (e1)-[:HAS_HEALTH]->(h1)
      
      CREATE (h2:HealthCheck {
        id: 'hc-002',
        serviceId: backend.id,
        status: 'healthy',
        statusCode: 200,
        latencyMs: 150,
        checkedAt: $h2_time
      })
      
    `, {
      h1_time: fiveMinsAgo.toISOString(),
      h2_time: twoMinsAgo.toISOString()
    });
    console.log('Created ErrorPatterns and HealthChecks.');

    console.log('✅ Seeding complete!');

  } catch (error) {
    console.error('❌ Error during seeding:', error);
  } finally {
    process.exit(0);
  }
}

seed();
