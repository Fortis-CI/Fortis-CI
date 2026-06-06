/**
 * webhook.routes.ts
 *
 * Entry point for all GitHub webhook events.
 *
 * POST /webhooks/github — receives GitHub Actions workflow_run events
 *
 * IMPORTANT:
 *  - express.raw() is applied on this route to get the raw Buffer for HMAC validation.
 *  - X-Hub-Signature-256 is verified BEFORE any processing.
 *  - Returns 401 if signature is invalid — never process unverified payloads.
 */

import express, { Router, Request, Response } from 'express';
import { verifyWebhookSignature } from '../utils/webhookVerify';
import { handleGitHubWebhook } from '../controllers/webhook.controller';

const router = Router();

/**
 * POST /webhooks/github
 *
 * Middleware chain:
 *  1. express.raw() — parse body as Buffer (needed for HMAC)
 *  2. Verify HMAC-SHA256 signature
 *  3. Pass to webhook controller
 */
router.post(
  '/github',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    // Step 1: Verify webhook signature
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const isValid = verifyWebhookSignature(req.body as Buffer, signature);

    if (!isValid) {
      console.warn('[Webhook] Invalid signature — rejecting payload');
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    // Step 2: Process the webhook
    await handleGitHubWebhook(req, res);
  }
);

export default router;
