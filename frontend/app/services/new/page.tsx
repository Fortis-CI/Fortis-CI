'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { registerService, importServices } from '../../../services/api';

type TabMode = 'form' | 'import';

export default function RegisterServicePage() {
  const router = useRouter();
  const [mode, setMode] = useState<TabMode>('form');

  // Form mode state
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [healthEndpoint, setHealthEndpoint] = useState('');
  const [environment, setEnvironment] = useState('production');
  const [dependencies, setDependencies] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);

  // Import mode state
  const [importJson, setImportJson] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormMsg(null);

    try {
      const depArray = dependencies
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);

      await registerService({
        name,
        repoUrl,
        healthEndpoint,
        environment,
        dependencies: depArray.length > 0 ? depArray : undefined,
      });

      setFormMsg('✅ Service registered successfully!');
      setTimeout(() => router.push('/services'), 1500);
    } catch (err) {
      setFormMsg(`❌ ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImport() {
    setSubmitting(true);
    setImportMsg(null);

    try {
      const parsed = JSON.parse(importJson);
      const services = Array.isArray(parsed) ? parsed : parsed.services;

      if (!services || !Array.isArray(services)) {
        throw new Error('JSON must be an array or { "services": [...] }');
      }

      const result = await importServices(services);
      setImportMsg(`✅ ${result.message}`);
    } catch (err) {
      setImportMsg(`❌ ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Register Service</h1>
        <p>Add a new service to track its deployments and health status</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button
          className={`btn ${mode === 'form' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setMode('form')}
        >
          Manual Registration
        </button>
        <button
          className={`btn ${mode === 'import' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setMode('import')}
        >
          JSON Import
        </button>
      </div>

      {mode === 'form' ? (
        <div className="card" style={{ maxWidth: 600 }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="svc-name">Service Name *</label>
              <input
                id="svc-name"
                className="form-input"
                type="text"
                placeholder="e.g. user-api"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="svc-repo">Repository URL *</label>
              <input
                id="svc-repo"
                className="form-input"
                type="url"
                placeholder="https://github.com/org/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="svc-health">Health Endpoint *</label>
              <input
                id="svc-health"
                className="form-input"
                type="url"
                placeholder="https://your-service.com/health"
                value={healthEndpoint}
                onChange={(e) => setHealthEndpoint(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="svc-env">Environment</label>
              <select
                id="svc-env"
                className="form-select"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
              >
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="development">Development</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="svc-deps">Dependencies (comma-separated)</label>
              <input
                id="svc-deps"
                className="form-input"
                type="text"
                placeholder="e.g. postgres, redis, auth-service"
                value={dependencies}
                onChange={(e) => setDependencies(e.target.value)}
              />
            </div>

            {formMsg && (
              <p style={{
                marginBottom: 16,
                fontSize: '0.85rem',
                color: formMsg.startsWith('✅') ? 'var(--status-healthy)' : 'var(--status-unhealthy)',
              }}>
                {formMsg}
              </p>
            )}

            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Registering...' : 'Register Service'}
            </button>
          </form>
        </div>
      ) : (
        <div className="card" style={{ maxWidth: 600 }}>
          <div className="form-group">
            <label className="form-label">JSON Payload</label>
            <textarea
              className="form-textarea mono"
              style={{ minHeight: 200 }}
              placeholder={`[
  {
    "name": "user-api",
    "repo": "https://github.com/org/user-api",
    "health_url": "https://user-api.example.com/health",
    "environment": "production",
    "dependencies": ["postgres", "redis"]
  }
]`}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
            />
          </div>

          {importMsg && (
            <p style={{
              marginBottom: 16,
              fontSize: '0.85rem',
              color: importMsg.startsWith('✅') ? 'var(--status-healthy)' : 'var(--status-unhealthy)',
            }}>
              {importMsg}
            </p>
          )}

          <button
            className="btn btn-primary"
            onClick={handleImport}
            disabled={submitting || !importJson.trim()}
          >
            {submitting ? 'Importing...' : 'Import Services'}
          </button>
        </div>
      )}
    </div>
  );
}
