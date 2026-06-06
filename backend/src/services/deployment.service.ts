/**
 * deployment.service.ts
 *
 * Thin wrapper around graphService for deployment-related business logic.
 * The webhookService will import createDeployment and createCommit from here.
 */

export {
  createDeployment,
  getDeploymentById,
  getDeployments,
  createCommit,
  linkSucceededBy,
} from './graphService';
