'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupPage() {
  const router = useRouter();
  const [githubToken, setGithubToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/api/setup/status` : 'http://localhost:3001/api/setup/status')
      .then(res => res.json())
      .then(data => {
        if (data.configured) {
          router.push('/');
        }
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/api/setup` : 'http://localhost:3001/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubToken, webhookSecret }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to setup');
      }

      router.push('/');
      setTimeout(() => window.location.reload(), 500); // Reload app to initialize fully
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '100px auto', padding: 32 }} className="card">
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ marginBottom: 16 }}>Welcome to Fortis-CI</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Let&apos;s get your enterprise deployment intelligence up and running.
        </p>
      </div>

      {error && <div style={{ color: 'var(--status-unhealthy)', marginBottom: 24, padding: 12, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 6 }}>{error}</div>}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>GitHub Token</label>
          <input 
            type="password" 
            value={githubToken} 
            onChange={e => setGithubToken(e.target.value)}
            style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', fontSize: '1rem' }}
            placeholder="ghp_..."
            required
          />
          <small style={{ color: 'var(--text-muted)', marginTop: 8, display: 'block', fontSize: '0.85rem' }}>
            Requires repo and admin:repo_hook scopes. Used to fetch commits and post PR comments.
          </small>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>Webhook Secret</label>
          <input 
            type="password" 
            value={webhookSecret} 
            onChange={e => setWebhookSecret(e.target.value)}
            style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', fontSize: '1rem' }}
            placeholder="A secure random string"
            required
          />
          <small style={{ color: 'var(--text-muted)', marginTop: 8, display: 'block', fontSize: '0.85rem' }}>
            Used to securely sign and verify payloads from GitHub Actions.
          </small>
        </div>

        <button type="submit" className="btn btn-primary" style={{ padding: '14px', marginTop: 16, fontSize: '1.05rem' }} disabled={loading}>
          {loading ? 'Initializing...' : 'Initialize Fortis-CI'}
        </button>
      </form>
    </div>
  );
}
