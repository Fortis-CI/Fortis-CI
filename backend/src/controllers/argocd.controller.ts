import { Request, Response } from 'express';
import {
  createOrUpdateRollout,
  createHealthIncident,
  checkWebhookDelivery,
} from '../services/graphService';

export async function handleArgoCDWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body;
    
    // Example payload shape based on approved model:
    // {
    //   "event": "on-sync-running",
    //   "service": "ticketflow-auth",
    //   "infra_commit": "abc123def456",
    //   "image_tag": "v1.4.2",
    //   "timestamp": "2026-06-06T12:00:00Z"
    // }
    
    const { event, service, infra_commit, image_tag, timestamp, delivery_id, error_message } = payload;
    
    if (!event || !service || !infra_commit || !image_tag || !delivery_id) {
      res.status(400).json({ error: 'Missing required payload fields' });
      return;
    }
    
    // Step 1.5: Replay Protection
    const isNew = await checkWebhookDelivery(delivery_id);
    if (!isNew) {
      console.warn(`[ArgoCD] Replay detected for delivery ID: ${delivery_id}. Returning 200 OK.`);
      res.status(200).json({ message: 'Duplicate delivery ignored' });
      return;
    }
    
    console.log(`[ArgoCD] Received ${event} for service ${service} (infra_commit: ${infra_commit})`);
    
    const eventTime = timestamp || new Date().toISOString();
    
    if (event === 'on-health-degraded') {
      await createHealthIncident(service, infra_commit, eventTime, error_message);
      res.status(200).json({ message: 'HealthIncident recorded' });
      return;
    }

    // Map ArgoCD events to RolloutStatus
    let status: 'progressing' | 'sync_complete' | 'success' | 'failed' | null = null;
    
    switch(event) {
      case 'on-sync-running':
        status = 'progressing';
        break;
      case 'on-sync-succeeded':
        status = 'sync_complete';
        break;
      case 'on-deployed':
        status = 'success';
        break;
      case 'on-sync-failed':
        status = 'failed';
        break;
      default:
        console.warn(`[ArgoCD] Unmapped event: ${event}`);
        res.status(200).json({ message: 'Event ignored' });
        return;
    }
    
    // Update or create the Rollout node chain
    await createOrUpdateRollout({
      serviceName: service,
      infraCommitSha: infra_commit,
      imageTag: image_tag,
      status,
      timestamp: eventTime,
      errorMessage: error_message
    });
    
    res.status(200).json({ message: `Rollout status updated to ${status}` });
    
  } catch (error) {
    console.error('[ArgoCD] Processing error:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
}
