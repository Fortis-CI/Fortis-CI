/**
 * api.ts — Typed API Client for Fortis-CI Backend
 *
 * All frontend API calls go through this module.
 * Uses the NEXT_PUBLIC_API_URL environment variable (default: http://localhost:3001).
 */

import {
  ServiceWithHealth,
  DeploymentWithCommit,
  ApiResponse,
  HealthCheck,
  CachedHealth,
} from '../types/deployment';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error: ${res.status}`);
  }

  return res.json();
}

// ─── Services ─────────────────────────────────────────────────────────────────

export async function fetchServices(): Promise<ServiceWithHealth[]> {
  const res = await apiFetch<ApiResponse<ServiceWithHealth[]>>('/api/services');
  return res.data;
}

export async function fetchService(id: string): Promise<ServiceWithHealth> {
  const res = await apiFetch<ApiResponse<ServiceWithHealth>>(`/api/services/${id}`);
  return res.data;
}

export async function registerService(data: {
  name: string;
  repoUrl: string;
  healthEndpoint: string;
  environment?: string;
  dependencies?: string[];
}): Promise<ServiceWithHealth> {
  const res = await apiFetch<ApiResponse<ServiceWithHealth>>('/api/services', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function importServices(services: Array<{
  name: string;
  repo: string;
  health_url: string;
  environment?: string;
  dependencies?: string[];
}>): Promise<{ message: string; data: Array<{ name: string; status: string; id?: string }> }> {
  return apiFetch('/api/services/import', {
    method: 'POST',
    body: JSON.stringify({ services }),
  });
}

export async function deleteService(id: string): Promise<void> {
  await apiFetch(`/api/services/${id}`, { method: 'DELETE' });
}

// ─── Deployments ──────────────────────────────────────────────────────────────

export async function fetchDeployments(
  serviceId?: string,
  limit = 50,
  offset = 0
): Promise<DeploymentWithCommit[]> {
  const params = new URLSearchParams();
  if (serviceId) params.set('serviceId', serviceId);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const res = await apiFetch<ApiResponse<DeploymentWithCommit[]>>(
    `/api/deployments?${params.toString()}`
  );
  return res.data;
}

export async function fetchDeployment(id: string): Promise<DeploymentWithCommit> {
  const res = await apiFetch<ApiResponse<DeploymentWithCommit>>(`/api/deployments/${id}`);
  return res.data;
}

export async function triggerRedeploy(id: string): Promise<{ message: string }> {
  return apiFetch(`/api/deployments/${id}/redeploy`, { method: 'POST' });
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function fetchHealthStatus(): Promise<ServiceWithHealth[]> {
  const res = await apiFetch<ApiResponse<ServiceWithHealth[]>>('/api/health-status');
  return res.data;
}

export async function fetchHealthHistory(
  serviceId: string,
  limit = 10
): Promise<{ latest: CachedHealth | null; history: HealthCheck[] }> {
  const res = await apiFetch<ApiResponse<{ latest: CachedHealth | null; history: HealthCheck[] }>>(
    `/api/health-status/${serviceId}?limit=${limit}`
  );
  return res.data;
}
