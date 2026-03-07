/**
 * Submit Quiz Answer API Endpoint
 * Students submit answers and get AI evaluation
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { broadcastQuizResult } from '../utils/signalrBroadcast';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';

// Simple answer evaluation - multiple choice only
async function evaluateAnswer(
  question: string,
  correctAnswer: string,
  studentAnswer: string,
  questionType: string,
  context: InvocationContext
): Promise<{ isCorrect: boolean; score: number; feedback: string }> {
  
  // Exact match comparison
  const isCorrect = studentAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
  
  return {
    isCorrect,
    score: isCorrect ? 100 : 0,
    feedback: isCorrect 
      ? 'Correct!' 
      : `Incorrect. The correct answer is: ${correctAnswer}`
  };
}

export async function submitQuizAnswer(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/quiz/submit-answer request');

  try {
    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }    const studentEmail = principal.userDetails;
    
    // Require Student role
    if (!hasRole(principal, 'Student') && !hasRole(principal, 'student')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Student role required', timestamp: Date.now() } }
      };
    }

    const sessionId = request.params.sessionId;
    const body = await request.json() as any;
    const { responseId, answer } = body;
    
    if (!sessionId || !responseId || !answer) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId, responseId, or answer', timestamp: Date.now() } }
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const responsesTable = getTableClient(TableNames.QUIZ_RESPONSES);
    const questionsTable = getTableClient(TableNames.QUIZ_QUESTIONS);
    const metricsTable = getTableClient(TableNames.QUIZ_METRICS);

    // Get response record
    const response = await responsesTable.getEntity(sessionId, responseId);

    // Verify this response belongs to the student
    if (response.studentId !== studentEmail) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'This question was not assigned to you', timestamp: now } }
      };
    }

    // Check if already answered
    if (response.status === 'ANSWERED') {
      return {
        status: 400,
        jsonBody: { error: { code: 'ALREADY_ANSWERED', message: 'Question already answered', timestamp: now } }
      };
    }

    // Check if expired
    context.log('Time check:', {
      now,
      expiresAt: response.expiresAt,
      sentAt: response.sentAt,
      timeLimit: (response.expiresAt as number) - (response.sentAt as number),
      timeElapsed: now - (response.sentAt as number),
      isExpired: now > (response.expiresAt as number)
    });
    
    if (now > (response.expiresAt as number)) {
      await responsesTable.updateEntity({
        partitionKey: sessionId,
        rowKey: responseId,
        status: 'EXPIRED'
      }, 'Merge');

      return {
        status: 400,
        jsonBody: { error: { code: 'EXPIRED', message: 'Time limit exceeded', timestamp: now } }
      };
    }

    // Get question details
    const question = await questionsTable.getEntity(sessionId, response.questionId as string);

    // Evaluate answer
    const evaluation = await evaluateAnswer(
      question.question as string,
      question.correctAnswer as string,
      answer,
      question.questionType as string,
      context
    );

    // Calculate response time
    const responseTime = now - (response.sentAt as number);

    // Update response record
    await responsesTable.updateEntity({
      partitionKey: sessionId,
      rowKey: responseId,
      answer,
      isCorrect: evaluation.isCorrect,
      score: evaluation.score,
      aiEvaluation: evaluation.feedback,
      responseTime,
      submittedAt: now,
      status: 'ANSWERED'
    }, 'Merge');

    // Update metrics
    try {
      const metric = await metricsTable.getEntity(sessionId, studentEmail);
      
      const totalQuestions = (metric.totalQuestions as number || 0) + 1;
      const correctAnswers = (metric.correctAnswers as number || 0) + (evaluation.isCorrect ? 1 : 0);
      const prevAvgTime = metric.averageResponseTime as number || 0;
      const newAvgTime = ((prevAvgTime * (totalQuestions - 1)) + responseTime) / totalQuestions;
      
      // Calculate engagement score
      const accuracy = (correctAnswers / totalQuestions) * 50;
      const timeLimit = question.timeLimit as number || 60;
      const speedRatio = responseTime / timeLimit;
      const speed = Math.max(0, (1 - speedRatio) * 30);
      const participation = Math.min(totalQuestions * 4, 20);
      const engagementScore = Math.round(accuracy + speed + participation);

      await metricsTable.updateEntity({
        partitionKey: sessionId,
        rowKey: studentEmail,
        totalQuestions,
        correctAnswers,
        averageResponseTime: newAvgTime,
        engagementScore
      }, 'Merge');

    } catch {
      // Create new metric
      const engagementScore = evaluation.isCorrect ? 70 : 50;
      
      await metricsTable.createEntity({
        partitionKey: sessionId,
        rowKey: studentEmail,
        totalQuestions: 1,
        correctAnswers: evaluation.isCorrect ? 1 : 0,
        questionCount: 1,
        averageResponseTime: responseTime,
        engagementScore,
        lastQuestionAt: now
      });
    }

    // Broadcast result to teacher
    await broadcastQuizResult(sessionId, {
      responseId,
      studentId: studentEmail,
      isCorrect: evaluation.isCorrect,
      score: evaluation.score,
      responseTime
    }, context);

    context.log(`Student ${studentEmail} answered question: ${evaluation.isCorrect ? 'CORRECT' : 'INCORRECT'} (${evaluation.score}/100)`);

    return {
      status: 200,
      jsonBody: {
        isCorrect: evaluation.isCorrect,
        score: evaluation.score,
        feedback: evaluation.feedback,
        correctAnswer: question.correctAnswer,
        responseTime
      }
    };

  } catch (error: any) {
    context.error('Error submitting quiz answer:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to submit answer',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('submitQuizAnswer', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/quiz/submit-answer',
  authLevel: 'anonymous',
  handler: submitQuizAnswer
});
