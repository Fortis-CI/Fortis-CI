import { config } from '../config/env';
import { createFileChanged, setDeploymentRiskScore, getFileFailureCount } from './graphService';

/**
 * Fetch Git commit diffs from GitHub API, link changed files to the commit
 * in Neo4j, and calculate a Layer 1 Heuristic Risk Score.
 */
export async function analyzeGitDiff(
  owner: string,
  repo: string,
  sha: string,
  deploymentId: string
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      console.error(`[GitAnalyzer] Failed to fetch commit ${sha}: ${response.status}`);
      return;
    }

    const data = (await response.json()) as any;
    const files = data.files || [];

    let score = 0;
    let totalLinesChanged = 0;

    for (const file of files) {
      // Create graph relationship: (Commit)-[:CHANGED_FILE]->(File)
      await createFileChanged(
        sha,
        file.filename,
        file.status,
        file.additions,
        file.deletions
      );

      // --- Layer 1 Heuristic Risk Scoring ---
      // 1. +0.02 per file changed
      score += 0.02;
      totalLinesChanged += (file.additions + file.deletions);

      // 2. High-risk path checks (+0.20 per high-risk file)
      if (
        file.filename.includes('auth/') ||
        file.filename.includes('config/') ||
        file.filename.includes('.env') ||
        file.filename.includes('database') ||
        file.filename.endsWith('schema.cypher') ||
        file.filename.endsWith('.tf') ||
        file.filename.endsWith('.yml')
      ) {
        score += 0.20;
      }
    }

    // 3. Diff size check
    if (totalLinesChanged > 200) {
      score += 0.15;
    }

    // 4. Friday deploy check (UTC)
    const day = new Date().getUTCDay();
    if (day === 5) { // Friday
      score += 0.10;
    } else if (day === 6 || day === 0) { // Weekend
      score += 0.05;
    }

    // --- Layer 2: Graph-Enhanced Risk Scoring ---
    let layer2Score = 0;
    for (const file of files) {
      const failures = await getFileFailureCount(file.filename);
      if (failures > 2) {
        layer2Score += 0.10;
        console.log(`[GitAnalyzer] File ${file.filename} is historically risky (>2 failures). Adding +0.10`);
      }
    }
    
    // Cap Layer 2 penalty at 0.30
    if (layer2Score > 0.30) layer2Score = 0.30;

    let finalScore = score + layer2Score;
    if (finalScore > 1.0) finalScore = 1.0;

    // Determine Risk Label
    let label = 'Low';
    if (finalScore > 0.7) {
      label = 'High';
    } else if (finalScore >= 0.3) {
      label = 'Medium';
    }

    if (layer2Score > 0) {
      label += ' (Graph-Enhanced)';
    }

    console.log(`[GitAnalyzer] Analyzed ${files.length} files for ${sha}. Risk Score: ${finalScore.toFixed(2)} (${label})`);

    // Attach to deployment
    await setDeploymentRiskScore(deploymentId, parseFloat(finalScore.toFixed(2)), label);

  } catch (err) {
    console.error(`[GitAnalyzer] Error analyzing commit ${sha}:`, err);
  }
}
