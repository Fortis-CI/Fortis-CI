/**
 * riskScorer.ts
 * 
 * Implements Layer 1 (Heuristic) deployment risk scoring based on structural file changes.
 */

export interface RiskScoreResult {
  score: number;
  level: 'Low' | 'Medium' | 'High' | 'Critical';
  hasStatefulChanges: boolean;
  reasons: string[];
}

/**
 * Calculates a deterministic risk score based on the files touched in a Git commit diff.
 * 
 * @param filesChanged Array of file paths changed in the commit
 * @returns RiskScoreResult containing the final score, level, and flags
 */
export function calculateRiskScore(filesChanged: string[]): RiskScoreResult {
  let score = 0;
  let hasStatefulChanges = false;
  const reasons: string[] = [];

  // 1. Changed Files Base Score
  const fileCountScore = Math.min(filesChanged.length * 0.02, 0.30);
  if (fileCountScore > 0) {
    score += fileCountScore;
    reasons.push(`${filesChanged.length} files changed (+${fileCountScore.toFixed(2)})`);
  }

  // 2. Structural Changes
  for (const file of filesChanged) {
    if (file.match(/package\.json$|go\.mod$|requirements\.txt$/)) {
      score += 0.20;
      reasons.push(`Dependency update detected: ${file} (+0.20)`);
    } else if (file.includes('Dockerfile')) {
      score += 0.30;
      reasons.push(`Infrastructure update: ${file} (+0.30)`);
    } else if (file.endsWith('.tf') || file.endsWith('.tfvars')) {
      score += 0.40;
      reasons.push(`Terraform configuration changed: ${file} (+0.40)`);
    } else if (file.includes('/config/') || file.endsWith('.env')) {
      score += 0.20;
      reasons.push(`Configuration change: ${file} (+0.20)`);
    }
    
    // 3. Stateful Changes (CRITICAL)
    if (file.includes('/migrations/') || file.endsWith('.sql') || file.includes('prisma/schema.prisma')) {
      hasStatefulChanges = true;
      score = 1.0;
      reasons.push(`CRITICAL: Stateful migration change detected in ${file}`);
    }
  }

  score = Math.min(score, 1.0);

  let level: 'Low' | 'Medium' | 'High' | 'Critical' = 'Low';
  if (score >= 1.0) level = 'Critical';
  else if (score >= 0.7) level = 'High';
  else if (score >= 0.3) level = 'Medium';

  return { score, level, hasStatefulChanges, reasons };
}
