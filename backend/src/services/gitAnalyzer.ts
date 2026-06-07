import { config } from '../config/env';
import { createFileChanged, setDeploymentRiskScore, getFileFailureCount } from './graphService';
import { calculateRiskScore } from '../utils/riskScorer';

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
    }

    const fileNames = files.map((f: any) => f.filename);
    
    // --- Layer 1 Heuristic Risk Scoring ---
    const riskResult = calculateRiskScore(fileNames);
    let score = riskResult.score;
    let label = riskResult.level as string;

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

    // Determine Risk Label if combined score changes tier
    if (finalScore >= 1.0 || riskResult.hasStatefulChanges) {
      label = 'Critical';
      finalScore = 1.0; // Enforce hard 1.0 for stateful
    } else if (finalScore >= 0.7) {
      label = 'High';
    } else if (finalScore >= 0.3) {
      label = 'Medium';
    }

    if (layer2Score > 0 && label !== 'Critical') {
      label += ' (Graph-Enhanced)';
    }

    console.log(`[GitAnalyzer] Analyzed ${files.length} files for ${sha}. Risk Score: ${finalScore.toFixed(2)} (${label})`);

    // Attach to deployment
    await setDeploymentRiskScore(deploymentId, parseFloat(finalScore.toFixed(2)), label, riskResult.hasStatefulChanges);

  } catch (err) {
    console.error(`[GitAnalyzer] Error analyzing commit ${sha}:`, err);
  }
}
