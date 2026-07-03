import { v4 as uuidv4 } from 'uuid';
import {
  createService,
  findServiceByRepoUrl,
  createHealthCheck,
  getHealthHistory,
  evaluateBlastRadius
} from '../graphService';
import { driver, executeQuery } from '../../db/index';

jest.mock('../../db/index', () => ({
  driver: {
    session: jest.fn(),
    verifyConnectivity: jest.fn(),
    close: jest.fn(),
  },
  executeQuery: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

describe('Graph Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createService', () => {
    it('should create a service successfully', async () => {
      (uuidv4 as jest.Mock).mockReturnValue('mock-uuid-123');
      const mockResult = {
        records: [
          {
            get: jest.fn().mockReturnValue({
              properties: { id: 'mock-uuid-123', name: 'test-service' },
            }),
          },
        ],
      };
      (executeQuery as jest.Mock).mockResolvedValue(mockResult);

      const result = await createService({
        name: 'test-service',
        repoUrl: 'https://github.com/org/repo',
        environment: 'production',
        healthEndpoint: 'http://localhost:3000/health'
      });

      expect(executeQuery).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: 'mock-uuid-123', name: 'test-service' });
    });
  });

  describe('findServiceByRepoUrl', () => {
    it('should return service by repo url', async () => {
      const mockResult = {
        records: [
          { get: jest.fn().mockReturnValue({ properties: { id: '1', name: 's1' } }) },
        ],
      };
      (executeQuery as jest.Mock).mockResolvedValue(mockResult);

      const result = await findServiceByRepoUrl('https://github.com/org/repo');

      expect(executeQuery).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ repoUrl: 'https://github.com/org/repo' }));
      expect(result).toEqual({ id: '1', name: 's1' });
    });
  });

  describe('HealthCheck functions', () => {
    it('should create a health check record', async () => {
      const mockResult = {
        records: [
          {
            get: jest.fn().mockReturnValue({
              properties: {
                id: 'health-1',
                serviceId: 'svc-1',
                status: 'healthy',
                statusCode: 200,
                responseTimeMs: 123,
                error: null,
                checkedAt: '2026-06-06T00:00:00.000Z',
              },
            }),
          },
        ],
      };
      (executeQuery as jest.Mock).mockResolvedValue(mockResult);

      const result = await createHealthCheck('svc-1', 'healthy', 200, 123, null);

      expect(executeQuery).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        serviceId: 'svc-1',
        status: 'healthy',
        statusCode: 200,
      }));
      expect(result).toEqual({
        id: 'health-1',
        serviceId: 'svc-1',
        status: 'healthy',
        statusCode: 200,
        responseTimeMs: 123,
        error: null,
        checkedAt: '2026-06-06T00:00:00.000Z',
      });
    });
    });
  });
