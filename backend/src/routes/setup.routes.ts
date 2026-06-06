import { Router } from 'express';
import { config } from '../config/env';
import fs from 'fs';
import path from 'path';

const router = Router();

router.get('/status', (req, res) => {
  const isConfigured = Boolean(config.GITHUB_TOKEN && config.GITHUB_WEBHOOK_SECRET);
  res.json({ configured: isConfigured });
});

router.post('/', (req, res) => {
  const { githubToken, webhookSecret } = req.body;
  
  if (!githubToken || !webhookSecret) {
    res.status(400).json({ error: 'Missing credentials' });
    return;
  }

  // Update in-memory config
  (config as any).GITHUB_TOKEN = githubToken;
  (config as any).GITHUB_WEBHOOK_SECRET = webhookSecret;

  // Persist to .env file for Docker restart
  const envPath = path.join(__dirname, '../../.env');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  const lines = content.split('\n').filter(line => !line.startsWith('GITHUB_TOKEN=') && !line.startsWith('GITHUB_WEBHOOK_SECRET='));
  lines.push(`GITHUB_TOKEN=${githubToken}`);
  lines.push(`GITHUB_WEBHOOK_SECRET=${webhookSecret}`);
  
  fs.writeFileSync(envPath, lines.join('\n'));

  res.json({ message: 'Setup completed successfully!' });
});

export default router;
