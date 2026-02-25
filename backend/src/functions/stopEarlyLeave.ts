/**
 * Stop Early Leave - REFACTORED (Simplified)
 */
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
export async function stopEarlyLeave(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const principalHeader = request.headers.get('x-ms-client-principal') || request.headers.get('x-client-principal');
    if (!principalHeader) {
      return { status: 401, jsonBody: { error: 'Unauthorized' } };
    }

    const principal = parseUserPrincipal(principalHeader);
    if (!hasRole(principal, 'Teacher')) {
      return { status: 403, jsonBody: { error: 'Forbidden' } };
    }

    const sessionId = request.params.sessionId;
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    const session = await sessionsTable.getEntity('SESSION', sessionId);

    // Update session to stop early leave
    const updatedSession: any = {
      partitionKey: session.partitionKey,
      rowKey: session.rowKey,
      ...session,
      earlyLeaveActive: false,
      currentEarlyTokenId: undefined
    };
    await sessionsTable.updateEntity(updatedSession, 'Replace');

    return { status: 200, jsonBody: { success: true, message: 'Early leave stopped' } };
  } catch (error: any) {
    context.error('Error:', error);
    return { status: 500, jsonBody: { error: 'Internal error' } };
  }
}

app.http('stopEarlyLeave', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/stop-early-leave',
  authLevel: 'anonymous',
  handler: stopEarlyLeave
});
