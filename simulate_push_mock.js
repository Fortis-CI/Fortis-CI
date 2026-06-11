const crypto = require('crypto');

const WEBHOOK_SECRET = '8be84389eaf184d5c8a5cdd61a6b4c10455099a0eaddd7195c833039fbb94c4d';

async function simulatePush() {
  const service = process.argv[2] || "payment-gateway";
  const conclusionArg = process.argv[3] || "success";
  const repo = "ganeshak11/" + service;

  const runId = Math.floor(Math.random() * 1000000);
  const commitSha = crypto.randomBytes(20).toString('hex');
  const now = new Date().toISOString();

  // We are simulating a pipeline deployment 
  const payload = {
    action: "completed",
    workflow_run: {
      id: runId,
      name: `Deploy ${service}`,
      head_branch: "main",
      status: "completed",
      conclusion: conclusionArg, 
      created_at: now,
      updated_at: now,
      actor: { login: "ganeshak11" },
      head_sha: commitSha,
      head_commit: {
        id: commitSha,
        message: conclusionArg === 'success' 
          ? `✨ FEATURE: Deploy new ${service} logic`
          : `💥 BREAKING: Deploy new ${service} logic`,
        author: { name: "ganeshak11", email: "ganeshak11@test.com" },
        timestamp: now
      },
      repository: {
        full_name: repo
      }
    }
  };

  const payloadStr = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadStr).digest('hex');

  console.log(`🚀 Simulating GitHub Webhook for Repo: ${repo} (Commit: ${commitSha.substring(0, 7)})`);
  
  try {
    const res = await fetch('http://localhost:3001/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature,
        'x-github-delivery': crypto.randomUUID()
      },
      body: payloadStr
    });

    const responseText = await res.text();
    console.log(`✅ Webhook Accepted! Response:`, responseText);

  } catch (error) {
    console.error("❌ Failed to send webhook:", error);
  }
}

simulatePush();
