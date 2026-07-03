import { triggerRollback } from '../rollbackEngine';
import * as graphService from '../graphService';
import * as githubService from '../github.service';
import * as notifications from '../notifications';

// Mock dependencies
jest.mock('../graphService');
jest.mock('../github.service');
jest.mock('../notifications');

describe('Rollback Engine', () => {
  let serviceId = 'service-123';
  const failedDeploymentId = 'deploy-fail';
  const failedSha = 'bad123';
  const reason = 'Test Reason';

  beforeEach(() => {
    jest.clearAllMocks();
    serviceId = `service-${Math.random()}`;
    
    // Default mocks
    (graphService.getDeploymentById as jest.Mock).mockResolvedValue({
      id: failedDeploymentId,
      hasStatefulChanges: false
    });
    
    (graphService.findLastHealthyDeployment as jest.Mock).mockResolvedValue({
      id: 'deploy-good',
      workflowRunId: 1001
    });

    (graphService.getServiceById as jest.Mock).mockResolvedValue({
      id: serviceId,
      name: 'Test Service',
      repoUrl: 'https://github.com/org/repo'
    });

    (githubService.parseRepoUrl as jest.Mock).mockReturnValue({
      owner: 'org',
      repo: 'repo'
    });

    (githubService.rerunWorkflow as jest.Mock).mockResolvedValue({
      success: true,
      message: 'Success'
    });
  });

  it('should trigger rollback successfully', async () => {
    await triggerRollback(serviceId, failedDeploymentId, failedSha, reason);

    expect(graphService.getDeploymentById).toHaveBeenCalledWith(failedDeploymentId);
    expect(graphService.findLastHealthyDeployment).toHaveBeenCalledWith(serviceId);
    expect(githubService.rerunWorkflow).toHaveBeenCalledWith('org', 'repo', 1001);
    expect(graphService.createRollbackEvent).toHaveBeenCalledWith(failedDeploymentId, 'deploy-good', reason);
    expect(notifications.sendSlackAlert).toHaveBeenCalled();
  });

  it('should abort rollback if deployment has stateful changes', async () => {
    (graphService.getDeploymentById as jest.Mock).mockResolvedValue({
      id: failedDeploymentId,
      hasStatefulChanges: true
    });

    await triggerRollback(serviceId, failedDeploymentId, failedSha, reason);

    expect(graphService.findLastHealthyDeployment).not.toHaveBeenCalled();
    expect(githubService.rerunWorkflow).not.toHaveBeenCalled();
    expect(notifications.sendSlackAlert).toHaveBeenCalledWith(expect.stringContaining('contains stateful changes'), failedDeploymentId);
  });

  it('should abort if no healthy deployment is found', async () => {
    (graphService.findLastHealthyDeployment as jest.Mock).mockResolvedValue(null);

    await triggerRollback(serviceId, failedDeploymentId, failedSha, reason);

    expect(githubService.rerunWorkflow).not.toHaveBeenCalled();
  });

  it('should alert on GitHub API failure', async () => {
    (githubService.rerunWorkflow as jest.Mock).mockResolvedValue({
      success: false,
      message: 'Failed to rerun'
    });

    await triggerRollback(serviceId, failedDeploymentId, failedSha, reason);

    expect(graphService.createRollbackEvent).not.toHaveBeenCalled();
    expect(notifications.sendSlackAlert).toHaveBeenCalledWith(expect.stringContaining('Automated rollback FAILED'), failedDeploymentId);
  });
});
