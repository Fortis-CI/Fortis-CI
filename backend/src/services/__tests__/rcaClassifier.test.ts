import { classifyArgoCDFailure, classifyHealthIncident } from '../rcaClassifier';

describe('RCA Classifier', () => {
  describe('classifyArgoCDFailure', () => {
    it('should classify ImagePullBackOff as DEPLOYMENT_FAILURE with 1.0 confidence', () => {
      const result = classifyArgoCDFailure('Pod status is ImagePullBackOff');
      expect(result.category).toBe('DEPLOYMENT_FAILURE');
      expect(result.confidenceScore).toBe(1.0);
    });

    it('should classify Invalid Credentials as DEPLOYMENT_FAILURE with 0.95 confidence', () => {
      const result = classifyArgoCDFailure('authentication failure: invalid credentials');
      expect(result.category).toBe('DEPLOYMENT_FAILURE');
      expect(result.confidenceScore).toBe(0.95);
    });

    it('should classify unhandled exceptions as APPLICATION_FAILURE with 0.98 confidence', () => {
      const result = classifyArgoCDFailure('TypeError: Cannot read properties of undefined');
      expect(result.category).toBe('APPLICATION_FAILURE');
      expect(result.confidenceScore).toBe(0.98);
    });

    it('should classify node network issues as INFRASTRUCTURE_FAILURE with 0.95 confidence', () => {
      const result = classifyArgoCDFailure('network is unreachable');
      expect(result.category).toBe('INFRASTRUCTURE_FAILURE');
      expect(result.confidenceScore).toBe(0.95);
    });

    it('should fallback to DEPLOYMENT_FAILURE with 0.6 confidence for unknown sync errors', () => {
      const result = classifyArgoCDFailure('unknown sync error occurred');
      expect(result.category).toBe('DEPLOYMENT_FAILURE');
      expect(result.confidenceScore).toBe(0.6);
    });
  });

  describe('classifyHealthIncident', () => {
    it('should classify 503 Service Unavailable as INFRASTRUCTURE_FAILURE with 0.85 confidence', () => {
      const result = classifyHealthIncident('HTTP error: 503 service unavailable');
      expect(result.category).toBe('INFRASTRUCTURE_FAILURE');
      expect(result.confidenceScore).toBe(0.85);
    });

    it('should classify OOM as APPLICATION_FAILURE with 0.98 confidence', () => {
      const result = classifyHealthIncident('Process exited: OOM');
      expect(result.category).toBe('APPLICATION_FAILURE');
      expect(result.confidenceScore).toBe(0.98);
    });

    it('should classify timeout as INFRASTRUCTURE_FAILURE with 0.9 confidence', () => {
      const result = classifyHealthIncident('Request timeout after 10000ms');
      expect(result.category).toBe('INFRASTRUCTURE_FAILURE');
      expect(result.confidenceScore).toBe(0.9);
    });
  });
});
