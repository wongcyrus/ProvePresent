/**
 * Authentication Headers Utility
 * Handles authentication headers for API requests
 * JWT tokens are automatically sent via cookies, no manual headers needed
 */

/**
 * Get the authentication endpoint
 * Always uses /api/auth/me for OTP authentication
 */
export function getAuthEndpoint(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
  return `${apiUrl}/auth/me`;
}

/**
 * Get authentication headers for API requests
 * JWT tokens are sent automatically via cookies with credentials: 'include'
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  return {
    'Content-Type': 'application/json'
  };
}

/**
 * Clear auth cache (no-op for JWT cookie-based auth)
 * Actual logout happens via /api/auth/logout endpoint
 */
export function clearAuthCache() {
  // No-op: JWT tokens are in HttpOnly cookies, cleared by logout endpoint
}
