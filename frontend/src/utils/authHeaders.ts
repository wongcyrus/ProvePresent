/**
 * Authentication Headers Utility
 * Handles fetching and formatting authentication headers for API requests
 */

let cachedPrincipal: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes (increased from 5)

function encodePrincipalBase64(clientPrincipal: unknown): string {
  const json = JSON.stringify(clientPrincipal);

  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const utf8Bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const byte of utf8Bytes) {
      binary += String.fromCharCode(byte);
    }
    return window.btoa(binary);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json).toString('base64');
  }

  throw new Error('No base64 encoder available');
}

/**
 * Get authentication headers for API requests
 * In production: fetch from /.auth/me and send principal headers for API compatibility
 * In local: sends x-ms-client-principal for emulator compatibility
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  const isLocal = process.env.NEXT_PUBLIC_ENVIRONMENT === 'local';

  // Check cache first
  const now = Date.now();
  if (cachedPrincipal && (now - cacheTimestamp) < CACHE_DURATION) {
    if (isLocal) {
      headers['x-ms-client-principal'] = cachedPrincipal;
    } else {
      headers['x-client-principal'] = cachedPrincipal;
      headers['x-ms-client-principal'] = cachedPrincipal;
    }
    return headers;
  }

  if (isLocal) {
    // Local development
    try {
      const authResponse = await fetch('/api/auth/me', {
        credentials: 'include',
        cache: 'no-store'
      });

      if (authResponse.ok) {
        const authData = await authResponse.json();
        if (authData.clientPrincipal) {
          const principal = encodePrincipalBase64(authData.clientPrincipal);
          
          // Cache it
          cachedPrincipal = principal;
          cacheTimestamp = now;
          
          headers['x-ms-client-principal'] = principal;
        }
      }
    } catch (error) {
      console.error('Failed to fetch local auth:', error);
    }
  }
  else {
    // Production
    try {
      const authResponse = await fetch('/.auth/me', {
        credentials: 'include',
        cache: 'no-store'
      });

      if (authResponse.ok) {
        const authData = await authResponse.json();
        if (authData.clientPrincipal) {
          const principal = encodePrincipalBase64(authData.clientPrincipal);

          cachedPrincipal = principal;
          cacheTimestamp = now;

          headers['x-client-principal'] = principal;
          headers['x-ms-client-principal'] = principal;
        }
      }
    } catch (error) {
      console.error('Failed to fetch production auth:', error);
    }
  }

  return headers;
}

/**
 * Clear the cached principal (e.g., on logout)
 */
export function clearAuthCache() {
  cachedPrincipal = null;
  cacheTimestamp = 0;
}
