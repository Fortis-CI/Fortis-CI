import AdmZip from 'adm-zip';
import { config } from '../config/env';

/**
 * Fetch GitHub Actions logs as a ZIP archive, extract them in-memory,
 * and return the combined log lines.
 *
 * Implements the v2.0.0 LogFetchJob requirements:
 * - Skips individual files > 5MB.
 * - Caps at 10,000 lines per file to prevent OOM.
 */
export async function fetchWorkflowLogs(
  owner: string,
  repo: string,
  runId: number
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/logs`;
  
  console.log(`[LogFetcher] Downloading logs for ${owner}/${repo} run #${runId}...`);
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
    // fetch natively follows redirects, which GitHub uses to serve the ZIP
  });

  if (!response.ok) {
    if (response.status === 404) {
      console.warn(`[LogFetcher] Logs not found (or expired) for run #${runId}`);
      return '';
    }
    throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  console.log(`[LogFetcher] Downloaded ${buffer.byteLength} bytes. Extracting...`);

  const zip = new AdmZip(buffer);
  const zipEntries = zip.getEntries();
  
  let combinedLogs = '';
  
  for (const entry of zipEntries) {
    // Only parse standard log files
    if (entry.isDirectory || !entry.entryName.endsWith('.txt')) {
      continue;
    }
    
    // Guardrail: Skip entries > 5MB
    if (entry.header.size > 5 * 1024 * 1024) {
      console.warn(`[LogFetcher] Skipping ${entry.entryName} (exceeds 5MB limit)`);
      continue;
    }

    const text = entry.getData().toString('utf8');
    const lines = text.split('\n');
    
    // Guardrail: Max 10,000 lines per file
    const truncatedLines = lines.slice(-10000);
    combinedLogs += `\n--- FILE: ${entry.entryName} ---\n` + truncatedLines.join('\n');
  }

  return combinedLogs;
}
