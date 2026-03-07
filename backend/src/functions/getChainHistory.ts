/**
 * Get Chain History API Endpoint
 * Returns the sequence of students who held the chain
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
export async function getChainHistory(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/chains/{chainId}/history request');

  try {
    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }    
    // Require Teacher role
    if (!hasRole(principal, 'Teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const sessionId = request.params.sessionId;
    const chainId = request.params.chainId;
    
    if (!sessionId || !chainId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId or chainId', timestamp: Date.now() } }
      };
    }

    // Get chain info
    const chainsTable = getTableClient(TableNames.CHAINS);
    let chain;
    try {
      chain = await chainsTable.getEntity(sessionId, chainId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Chain not found', timestamp: Date.now() } }
        };
      }
      throw error;
    }

    // Get chain history from ChainHistory table
    const chainHistoryTable = getTableClient(TableNames.CHAIN_HISTORY);
    
    const history: any[] = [];
    for await (const record of chainHistoryTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${chainId}'` }
    })) {
      history.push({
        sequence: record.sequence,
        fromHolder: record.fromHolder,
        toHolder: record.toHolder,
        scannedAt: record.scannedAt,
        phase: record.phase
      });
    }

    // Sort by sequence
    history.sort((a, b) => (a.sequence as number) - (b.sequence as number));

    return {
      status: 200,
      jsonBody: {
        chainId,
        phase: chain.phase,
        history,
        totalScans: chain.lastSeq || 0,
        currentHolder: chain.lastHolder
      }
    };

  } catch (error: any) {
    context.error('Error getting chain history:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get chain history',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('getChainHistory', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/chains/{chainId}/history',
  authLevel: 'anonymous',
  handler: getChainHistory
});
