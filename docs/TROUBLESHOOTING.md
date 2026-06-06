# Troubleshooting Playbook

## 1. Webhooks Failing with `401 Unauthorized`
**Symptom:** GitHub shows a red X next to the webhook, and Fortis-CI logs show `Unauthorized`.
**Fix:** 
- Ensure your `GITHUB_WEBHOOK_SECRET` matches the secret configured in your GitHub repository settings.
- If you ran the setup wizard, verify the secret was saved successfully in the `.env` file.

## 2. Deployments stuck in "Pending"
**Symptom:** You push code, but Fortis-CI never updates the deployment status.
**Fix:**
- Ensure the repository name exactly matches the `repoUrl` defined in your `services.yml`. Fortis-CI uses this to link webhooks to services.
- Example: If the repo is `https://github.com/ganeshak11/Fortis-CI`, your `services.yml` must use exactly `ganeshak11/Fortis-CI`.

## 3. "Cannot import X services. Free tier limit is 3."
**Symptom:** When starting Fortis-CI, the backend refuses to import your `services.yml`.
**Fix:**
- You are running Fortis-CI in Open Source Mode, which restricts the number of registered services to 3.
- Upgrade to the Enterprise Edition by setting the `SENTINEL_LICENSE_KEY` environment variable.

## 4. Neo4j Connection Refused
**Symptom:** Backend crashes with `[Neo4j] Failed to connect`.
**Fix:**
- Ensure the `fortis-neo4j` Docker container is running.
- Wait a few seconds and restart the backend; Neo4j can take up to 10 seconds to fully boot and accept connections.
