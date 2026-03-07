/**
 * Get Student Questions
 * Returns pending quiz questions for a student
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';

export async function getStudentQuestions(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/student-questions request');

  try {
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header' } }
      };
    }    
    if (!hasRole(principal, 'Student')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Student role required' } }
      };
    }

    const sessionId = request.params.sessionId;
    const studentId = getUserId(principal);

    context.log(`Getting questions for session: ${sessionId}, student: ${studentId}`);

    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId' } }
      };
    }

    const questionsTable = getTableClient(TableNames.QUIZ_QUESTIONS);
    const responsesTable = getTableClient(TableNames.QUIZ_RESPONSES);
    const now = Math.floor(Date.now() / 1000);

    // Get all pending responses for this student (not answered, not expired)
    const responses = responsesTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${sessionId}' and studentId eq '${studentId}' and status eq 'PENDING'` }
    });

    const pendingQuestions = [];
    const expiredResponses = [];
    let mostRecentQuestion: any = null;
    let mostRecentSentAt = 0;
    let totalResponses = 0;
    
    for await (const response of responses) {
      totalResponses++;
      context.log(`Checking response: ${response.rowKey}, status: ${response.status}, expiresAt: ${response.expiresAt}, now: ${now}`);
      
      // Skip expired questions - don't return them at all
      if ((response.expiresAt as number) <= now) {
        context.log(`Question ${response.questionId} expired, will mark as EXPIRED`);
        expiredResponses.push(response.rowKey as string);
        continue;
      }
      
      // Track the most recent question
      const sentAt = response.sentAt as number;
      context.log(`Question sentAt: ${sentAt}, current mostRecent: ${mostRecentSentAt}`);
      if (sentAt > mostRecentSentAt) {
        mostRecentSentAt = sentAt;
        mostRecentQuestion = response;
        context.log(`New most recent question: ${response.rowKey}`);
      }
    }
    
    context.log(`Total responses found: ${totalResponses}, expired: ${expiredResponses.length}, mostRecent: ${mostRecentQuestion?.rowKey || 'none'}`);
    
    // Only return the most recent question
    if (mostRecentQuestion) {
      try {
        const question = await questionsTable.getEntity(sessionId, mostRecentQuestion.questionId as string);
        
        // Calculate remaining time from server perspective
        const remainingTime = (mostRecentQuestion.expiresAt as number) - now;
        
        pendingQuestions.push({
          questionId: mostRecentQuestion.questionId,
          responseId: mostRecentQuestion.rowKey,
          question: question.question,
          options: JSON.parse(question.options as string),
          slideUrl: question.slideImageUrl,
          sentAt: mostRecentQuestion.sentAt,
          expiresAt: mostRecentQuestion.expiresAt,
          remainingTime
        });
        
        context.log(`Returning most recent question: ${mostRecentQuestion.rowKey}, sent at ${mostRecentSentAt}`);
      } catch (error: any) {
        context.warn(`Question ${mostRecentQuestion.questionId} not found`);
      }
    }

    // Mark all expired responses as EXPIRED (do this after the loop)
    for (const responseId of expiredResponses) {
      try {
        await responsesTable.updateEntity({
          partitionKey: sessionId,
          rowKey: responseId,
          status: 'EXPIRED'
        }, 'Merge');
        context.log(`Marked response ${responseId} as EXPIRED`);
      } catch (error: any) {
        context.warn(`Failed to mark response ${responseId} as expired:`, error.message);
      }
    }

    return {
      status: 200,
      jsonBody: {
        questions: pendingQuestions
      }
    };

  } catch (error: any) {
    context.error('Error getting student questions:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get questions',
          details: error.message
        }
      }
    };
  }
}

app.http('getStudentQuestions', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/student-questions',
  authLevel: 'anonymous',
  handler: getStudentQuestions
});
