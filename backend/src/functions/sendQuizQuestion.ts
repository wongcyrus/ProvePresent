/**
 * Send Quiz Question API Endpoint
 * Selects a student fairly and sends them a quiz question
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomUUID } from 'crypto';
import { broadcastQuizQuestion } from '../utils/signalrBroadcast';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';

export async function sendQuizQuestion(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/quiz/send-question request');

  try {
    // Parse authentication
    const principalHeader = request.headers.get('x-ms-client-principal') || request.headers.get('x-client-principal');
    if (!principalHeader) {
      context.log('Missing authentication header');
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }

    const principal = parseUserPrincipal(principalHeader);
    context.log('User:', principal.userDetails);
    
    // Require Teacher role
    if (!hasRole(principal, 'Teacher') && !hasRole(principal, 'teacher')) {
      context.log('User does not have Teacher role');
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const sessionId = request.params.sessionId;
    const body = await request.json() as any;
    const { questionId, studentId, timeLimit = 60 } = body;
    
    context.log('Request body:', { questionId, studentId, timeLimit });
    
    if (!sessionId || !questionId) {
      context.log('Missing sessionId or questionId');
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId or questionId', timestamp: Date.now() } }
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const questionsTable = getTableClient(TableNames.QUIZ_QUESTIONS);
    const responsesTable = getTableClient(TableNames.QUIZ_RESPONSES);
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);

    // Get question details
    context.log('Fetching question:', questionId);
    const question = await questionsTable.getEntity(sessionId, questionId);
    context.log('Question found:', question.question);

    // Get all present students (those who have joined)
    const attendees = [];
    const attendanceRecords = attendanceTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${sessionId}'` }
    });

    for await (const record of attendanceRecords) {
      if (record.joinedAt != null && record.joinedAt !== undefined) {
        attendees.push(record.rowKey as string);
      }
    }

    context.log('Found attendees:', attendees);

    if (attendees.length === 0) {
      context.log('No students present - silently skipping question send');
      return {
        status: 200,
        jsonBody: { 
          skipped: true,
          reason: 'No students present',
          timestamp: now 
        }
      };
    }

    // Create response records for ALL students and broadcast via SignalR
    const responseIds: string[] = [];
    const expiresAt = now + timeLimit;

    for (const studentId of attendees) {
      const responseId = randomUUID();
      
      await responsesTable.createEntity({
        partitionKey: sessionId,
        rowKey: responseId,
        questionId,
        studentId: studentId,
        answer: '',
        isCorrect: false,
        responseTime: 0,
        submittedAt: 0,
        sentAt: now,
        expiresAt,
        status: 'PENDING'
      });

      responseIds.push(responseId);

      // Broadcast question to this student via SignalR
      const questionData = {
        responseId,
        questionId,
        studentId: studentId,
        question: question.question as string,
        questionType: question.questionType as string,
        options: question.options ? JSON.parse(question.options as string) : null,
        timeLimit,
        expiresAt
      };
      
      context.log(`Broadcasting question to student ${studentId}:`, {
        responseId,
        questionId,
        expiresAt
      });
      
      await broadcastQuizQuestion(sessionId, questionData, context);
    }

    context.log(`Sent question ${questionId} to ${attendees.length} students`);

    return {
      status: 200,
      jsonBody: {
        responseIds,
        students: attendees,
        sentAt: now,
        expiresAt
      }
    };

  } catch (error: any) {
    context.error('Error sending quiz question:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to send quiz question',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('sendQuizQuestion', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/quiz/send-question',
  authLevel: 'anonymous',
  handler: sendQuizQuestion
});
