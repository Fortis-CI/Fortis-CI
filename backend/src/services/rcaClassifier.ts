import { FailureCategory } from '../types/deployment.types';

export interface RCAClassificationResult {
  category: FailureCategory;
  confidenceScore: number;
}

export function classifyArgoCDFailure(errorMessage: string): RCAClassificationResult {
  const msg = errorMessage.toLowerCase();

  // 1. Deployment Failures (High Confidence)
  if (msg.includes('imagepullbackoff') || msg.includes('errimagepull')) {
    return { category: 'DEPLOYMENT_FAILURE', confidenceScore: 1.0 };
  }
  if (msg.includes('failedscheduling') || msg.includes('insufficient cpu') || msg.includes('insufficient memory')) {
    return { category: 'DEPLOYMENT_FAILURE', confidenceScore: 0.95 };
  }
  if (msg.includes('failedmount') || msg.includes('unmounted volumes')) {
    return { category: 'DEPLOYMENT_FAILURE', confidenceScore: 0.9 };
  }
  if (msg.includes('invalid') && (msg.includes('manifest') || msg.includes('yaml'))) {
    return { category: 'DEPLOYMENT_FAILURE', confidenceScore: 1.0 };
  }

  // 2. Deployment Failures (Configuration / Missing Env / Credentials)
  if (
    msg.includes('missing environment variable') ||
    msg.includes('jwt_key') ||
    msg.includes('authentication failure') ||
    msg.includes('invalid credentials') ||
    msg.includes('access refused') ||
    msg.includes('invalid secret') ||
    msg.includes('bad connection string') ||
    msg.includes('missing config map')
  ) {
    return { category: 'DEPLOYMENT_FAILURE', confidenceScore: 0.95 };
  }

  // 3. Application Failures (Startup CrashLoop)
  if (msg.includes('syntaxerror') || msg.includes('exception') || msg.includes('typeerror')) {
    return { category: 'APPLICATION_FAILURE', confidenceScore: 0.98 };
  }
  if (msg.includes('crashloopbackoff') || msg.includes('error: exit code 1')) {
    // CrashLoopBackOff is a symptom. If we don't have deeper container logs proving a config error,
    // we default to APPLICATION_FAILURE assuming the code threw an unhandled exception.
    return { category: 'APPLICATION_FAILURE', confidenceScore: 0.85 };
  }

  // 3. Infrastructure Failures
  if (msg.includes('nodenotready') || msg.includes('network is unreachable')) {
    return { category: 'INFRASTRUCTURE_FAILURE', confidenceScore: 0.95 };
  }

  // Default to Deployment Failure with lower confidence if it failed during the sync phase but we don't recognize the error
  return { category: 'DEPLOYMENT_FAILURE', confidenceScore: 0.6 };
}

export function classifyHealthIncident(healthError: string): RCAClassificationResult {
  const err = healthError.toLowerCase();

  // 0. Deployment / Configuration Failures (High Priority override)
  if (
    err.includes('missing environment variable') ||
    err.includes('jwt_key') ||
    err.includes('authentication failure') ||
    err.includes('invalid credentials') ||
    err.includes('access refused') ||
    err.includes('invalid secret') ||
    err.includes('bad connection string') ||
    err.includes('missing config map')
  ) {
    return { category: 'DEPLOYMENT_FAILURE', confidenceScore: 0.95 };
  }

  // 1. Infrastructure Failures (Network, Cluster, DB Down)
  if (err.includes('econnrefused') || err.includes('timeout') || err.includes('dns') || err.includes('enotfound')) {
    return { category: 'INFRASTRUCTURE_FAILURE', confidenceScore: 0.9 };
  }
  if (err.includes('503 service unavailable') || err.includes('502 bad gateway') || err.includes('504 gateway timeout')) {
    return { category: 'INFRASTRUCTURE_FAILURE', confidenceScore: 0.85 };
  }

  // 2. Application Failures (Runtime Logic Errors)
  if (err.includes('500 internal server error') || err.includes('exception') || err.includes('null pointer')) {
    return { category: 'APPLICATION_FAILURE', confidenceScore: 0.95 };
  }
  if (err.includes('oom') || err.includes('out of memory')) {
    return { category: 'APPLICATION_FAILURE', confidenceScore: 0.98 };
  }

  // Default to Application Failure for runtime degradation
  return { category: 'APPLICATION_FAILURE', confidenceScore: 0.7 };
}
