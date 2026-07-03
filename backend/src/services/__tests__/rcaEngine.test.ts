import { analyzeDeploymentLogs } from '../rcaEngine';
import * as logFetcher from '../logFetcher';
import * as graphService from '../graphService';
import * as rollbackEngine from '../rollbackEngine';

jest.mock('../logFetcher');
jest.mock('../graphService');
jest.mock('../rollbackEngine');

describe('RCA Engine', () => {
  const owner = 'org';
  const repo = 'repo';
  const runId = 1234;
  const deploymentId = 'deploy-1';

  beforeEach(() => {
    jest.clearAllMocks();
    (graphService.getDeploymentById as jest.Mock).mockResolvedValue({
      id: deploymentId,
      serviceId: 'svc-1',
      commit: { sha: 'sha123' }
    });
    (rollbackEngine.triggerRollback as jest.Mock).mockResolvedValue(undefined);
  });

  it('should return null if logs are not fetched', async () => {
    (logFetcher.fetchWorkflowLogs as jest.Mock).mockResolvedValue(null);

    const result = await analyzeDeploymentLogs(owner, repo, runId, deploymentId);
    expect(result).toBeNull();
  });

  it('should detect DB connection error and trigger Tier 2 rollback', async () => {
    const mockLogs = `Starting app...\nConnecting to DB...\nError: ECONNREFUSED 127.0.0.1:5432\nExiting...`;
    (logFetcher.fetchWorkflowLogs as jest.Mock).mockResolvedValue(mockLogs);

    const result = await analyzeDeploymentLogs(owner, repo, runId, deploymentId);

    expect(result).toBe('db_connection');
    expect(graphService.createErrorPattern).toHaveBeenCalledWith(
      deploymentId,
      'Database Connection Error',
      'Error: ECONNREFUSED 127.0.0.1:5432',
      0.95
    );
    expect(rollbackEngine.triggerRollback).toHaveBeenCalledWith(
      'svc-1',
      deploymentId,
      'sha123',
      'Critical Error Detected: Database Connection Error'
    );
  });

  it('should detect Slow Query but NOT trigger rollback', async () => {
    const mockLogs = `Running query...\nquery wait timeout\nContinuing...`;
    (logFetcher.fetchWorkflowLogs as jest.Mock).mockResolvedValue(mockLogs);

    const result = await analyzeDeploymentLogs(owner, repo, runId, deploymentId);

    expect(result).toBe('slow_query');
    expect(graphService.createErrorPattern).toHaveBeenCalledWith(
      deploymentId,
      'Slow Query Timeout',
      'query wait timeout',
      0.8
    );
    // Confidence is 0.8, which is < 0.90, so rollback should not be triggered
    expect(rollbackEngine.triggerRollback).not.toHaveBeenCalled();
  });
});
