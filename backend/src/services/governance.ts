import { config } from '../config/env';

/**
 * Analyzes a GitHub Pull Request to generate a proactive risk assessment.
 * This simulates PR Governance checks for v3.0.0.
 */
export async function analyzePullRequest(owner: string, repo: string, prNumber: number): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`;
  
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      console.error(`[Governance] Failed to fetch PR files for ${owner}/${repo}#${prNumber}`);
      return;
    }

    const files = await response.json() as any[];
    
    let riskScore = 0.0;
    const warnings: string[] = [];

    // Layer 1 Heuristics
    riskScore += files.length * 0.02;

    let totalAdditions = 0;
    for (const file of files) {
      totalAdditions += file.additions || 0;
      
      const p = file.filename.toLowerCase();
      if (p.includes('config/') || p.includes('database') || p.includes('.env')) {
        riskScore += 0.20;
        warnings.push(`Critical file modified: \`${file.filename}\``);
      }
    }

    if (totalAdditions > 200) {
      riskScore += 0.15;
      warnings.push(`Large diff size (>200 lines added)`);
    }

    if (riskScore > 1.0) riskScore = 1.0;

    let label = '🟢 Low Risk';
    if (riskScore > 0.7) label = '🔴 High Risk';
    else if (riskScore >= 0.3) label = '🟡 Medium Risk';

    let commentBody = `### Fortis-CI Governance Check\n\n**Risk Score:** ${riskScore.toFixed(2)} (${label})\n\n`;
    if (warnings.length > 0) {
      commentBody += `**Warnings:**\n`;
      warnings.forEach(w => commentBody += `- ${w}\n`);
    } else {
      commentBody += `No critical warnings detected. Safe to merge!`;
    }

    console.log(`\n================ PR GOVERNANCE COMMENT =================`);
    console.log(`Repository: ${owner}/${repo} #PR-${prNumber}`);
    console.log(`Payload:\n${commentBody}`);
    console.log(`========================================================\n`);

  } catch (err) {
    console.error('[Governance] PR Analysis failed:', err);
  }
}
