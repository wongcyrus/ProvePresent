/**
 * Format student ID by removing email domain
 * 
 * Removes common email domains to display clean student IDs:
 * - @stu.vtc.edu.hk
 * - @vtc.edu.hk
 * - Any other @domain.com pattern
 * 
 * @param studentId - Full student ID (may include email domain)
 * @returns Formatted student ID without domain
 * 
 * @example
 * formatStudentId('s123456@stu.vtc.edu.hk') // returns 's123456'
 * formatStudentId('teacher@vtc.edu.hk') // returns 'teacher'
 * formatStudentId('user@example.com') // returns 'user'
 * formatStudentId('s123456') // returns 's123456'
 */
export function formatStudentId(studentId: string | undefined | null): string {
  if (!studentId) return 'Unknown';
  
  // Remove email domain if present
  const atIndex = studentId.indexOf('@');
  if (atIndex > 0) {
    return studentId.substring(0, atIndex);
  }
  
  return studentId;
}

/**
 * Format multiple student IDs
 * 
 * @param studentIds - Array of student IDs
 * @returns Array of formatted student IDs
 */
export function formatStudentIds(studentIds: string[]): string[] {
  return studentIds.map(formatStudentId);
}
