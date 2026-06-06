/**
 * webhookVerify.ts — HMAC-SHA256 Webhook Signature Verification
 *
 * Verifies that incoming GitHub webhooks are authentic by comparing
 * the X-Hub-Signature-256 header against a locally computed HMAC
 * using the shared GITHUB_WEBHOOK_SECRET.
 *
 * Reference: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */

import crypto from 'crypto';
import { config } from '../config/env';

/**
 * Verify the HMAC-SHA256 signature of a GitHub webhook payload.
 *
 * @param payload - The raw request body as a Buffer
 * @param signature - The X-Hub-Signature-256 header value (e.g., "sha256=abc123...")
 * @returns true if the signature is valid
 */
export function verifyWebhookSignature(payload: Buffer, signature: string | undefined): boolean {
  if (!signature) {
    console.warn('[Webhook] Missing X-Hub-Signature-256 header');
    return false;
  }

  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', config.GITHUB_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    // Lengths differ — signatures don't match
    return false;
  }
}
