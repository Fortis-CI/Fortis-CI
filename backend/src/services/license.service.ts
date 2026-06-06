import { config } from '../config/env';

let isEnterpriseActive = false;

/**
 * Validates the SENTINEL_LICENSE_KEY.
 * In a real production system, this would make an HTTP request to license.fortis-ci.io.
 * For this implementation, we simply check if the key is present and starts with 'ENT_'.
 */
export async function validateLicense(): Promise<void> {
  const key = config.SENTINEL_LICENSE_KEY;
  
  if (!key) {
    console.log('[License] Running in Open Source Mode (Free Tier).');
    isEnterpriseActive = false;
    return;
  }

  if (key.startsWith('ENT_')) {
    console.log('[License] Valid Enterprise License detected! Unlocking advanced features.');
    isEnterpriseActive = true;
  } else {
    console.warn('[License] INVALID LICENSE KEY. Falling back to Open Source Mode.');
    isEnterpriseActive = false;
  }
}

/**
 * Returns true if the Fortis-CI instance is running with a valid enterprise license.
 */
export function isEnterprise(): boolean {
  return isEnterpriseActive;
}

/**
 * Returns the maximum number of services allowed for this instance.
 */
export function getMaxServicesAllowed(): number {
  return isEnterpriseActive ? Infinity : 3;
}
