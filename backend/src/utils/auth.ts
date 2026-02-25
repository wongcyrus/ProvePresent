/**
 * Authentication Utilities
 * Common functions for parsing and validating user authentication
 */

/**
 * Parse the base64-encoded user principal header
 * @param header - The x-ms-client-principal header value
 * @returns Parsed principal object
 * @throws Error if header is invalid
 */
export function parseUserPrincipal(header: string): any {
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    throw new Error('Invalid authentication header');
  }
}

/**
 * Get user ID (email) from principal
 * @param principal - Parsed principal object
 * @returns User email address
 */
export function getUserId(principal: any): string {
  return principal.userDetails || principal.userId;
}

/**
 * Check if user has a specific role
 * Uses email domain-based role assignment for VTC users
 * @param principal - Parsed principal object
 * @param role - Role to check ('teacher' or 'student')
 * @returns True if user has the role
 */
export function hasRole(principal: any, role: string): boolean {
  const email = principal.userDetails || principal.userId || '';
  const emailLower = email.toLowerCase();
  
  // VTC domain-based role assignment
  if (role.toLowerCase() === 'teacher' && 
      emailLower.endsWith('@vtc.edu.hk') && 
      !emailLower.endsWith('@stu.vtc.edu.hk')) {
    return true;
  }
  
  if (role.toLowerCase() === 'student' && 
      emailLower.endsWith('@stu.vtc.edu.hk')) {
    return true;
  }
  
  // Fallback to checking userRoles array
  const roles = principal.userRoles || [];
  return roles.some((r: string) => r.toLowerCase() === role.toLowerCase());
}

/**
 * Get roles from email address (for role assignment)
 * @param email - User email address
 * @returns Array of role names
 */
export function getRolesFromEmail(email: string): string[] {
  const emailLower = email.toLowerCase();
  
  // Teacher: @vtc.edu.hk (excluding @stu.vtc.edu.hk)
  if (emailLower.endsWith('@vtc.edu.hk') && !emailLower.endsWith('@stu.vtc.edu.hk')) {
    return ['teacher'];
  }
  
  // Student: @stu.vtc.edu.hk
  if (emailLower.endsWith('@stu.vtc.edu.hk')) {
    return ['student'];
  }
  
  return [];
}
