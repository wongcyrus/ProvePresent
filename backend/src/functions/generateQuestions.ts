/**
 * Generate Questions API Endpoint
 * Uses Azure AI Foundry Agent to generate quiz questions from slide analysis
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { getAgentClient } from '../utils/agentService';
import { randomUUID } from 'crypto';

export async function generateQuestions(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/quiz/generate-questions request');

  try {
    // Parse authentication
    const principalHeader = request.headers.get('x-ms-client-principal') || request.headers.get('x-client-principal');
    if (!principalHeader) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }

    const principal = parseUserPrincipal(principalHeader);
    
    // Require Teacher role
    if (!hasRole(principal, 'Teacher') && !hasRole(principal, 'teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const sessionId = request.params.sessionId;
    const body = await request.json() as any;
    const { slideId, analysis, difficulty, count = 3 } = body;
    
    if (!sessionId || !analysis) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId or analysis', timestamp: Date.now() } }
      };
    }

    // Prepare slide content for the agent
    const slideContent = `
Topic: ${analysis.topic}
Title: ${analysis.title || 'N/A'}
Key Points: ${analysis.keyPoints?.join(', ') || 'N/A'}
Code Examples: ${analysis.codeExamples?.join('\n') || 'N/A'}
Formulas: ${analysis.formulas?.join(', ') || 'N/A'}
Summary: ${analysis.summary || 'N/A'}
`;

    const difficultyFilter = difficulty || analysis.difficulty || 'MEDIUM';

    // Use Azure AI Foundry Agent to generate questions
    // Agent is pre-configured in infrastructure with instructions
    const agentClient = getAgentClient();

    const userMessage = `Based on this slide content:
${slideContent}

Generate ${count} MULTIPLE CHOICE quiz questions at ${difficultyFilter} difficulty level.

FORMATTING REQUIREMENTS:
- Question text: Maximum 15 words, one clear sentence
- Options: Maximum 8 words each, concise and distinct
- Use simple vocabulary appropriate for the difficulty level
- ONLY generate MULTIPLE_CHOICE questions (no SHORT_ANSWER)

Return ONLY valid JSON (no markdown, no code blocks).`;

    context.log('Calling AI Agent to generate questions...');
    
    let agentResponse;
    try {
      agentResponse = await agentClient.runSingleInteraction({
        userMessage: userMessage
      });
    } catch (error: any) {
      context.error('Agent interaction failed:', error);
      throw new Error(`Agent failed: ${error.message}`);
    }

    const content = agentResponse.content;

    if (!content) {
      throw new Error('No content in agent response');
    }

    // Parse the JSON response
    let questionsData;
    try {
      // Remove markdown code blocks if present
      let cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // If the agent echoed the prompt, try to extract just the JSON
      // Look for the first { and last } to extract the JSON object
      const firstBrace = cleanContent.indexOf('{');
      const lastBrace = cleanContent.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);
      }
      
      questionsData = JSON.parse(cleanContent);
    } catch (parseError: any) {
      context.error('Failed to parse agent response:', content);
      throw new Error(`Invalid JSON from agent: ${parseError.message}`);
    }

    const questions = questionsData.questions || [];

    // Store questions in database
    const questionsTable = getTableClient(TableNames.QUIZ_QUESTIONS);
    const now = Math.floor(Date.now() / 1000);

    const storedQuestions = [];

    for (const q of questions) {
      const questionId = randomUUID();
      
      await questionsTable.createEntity({
        partitionKey: sessionId,
        rowKey: questionId,
        slideId: slideId || '',
        slideImageUrl: body.slideImageUrl || '', // Store blob URL for future review
        slideContent: JSON.stringify(analysis),
        question: q.text,
        questionType: q.type,
        options: q.options ? JSON.stringify(q.options) : '',
        correctAnswer: q.correctAnswer,
        explanation: q.explanation || '',
        difficulty: q.difficulty,
        timeLimit: 60, // Default 60 seconds
        createdAt: now,
        createdBy: principal.userDetails
      });

      storedQuestions.push({
        questionId,
        text: q.text,
        type: q.type,
        difficulty: q.difficulty,
        options: q.options || null,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation
      });
    }

    context.log(`Generated ${storedQuestions.length} questions for session ${sessionId}`);

    return {
      status: 200,
      jsonBody: {
        questions: storedQuestions
      }
    };

  } catch (error: any) {
    context.error('Error generating questions:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate questions',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('generateQuestions', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/quiz/generate-questions',
  authLevel: 'anonymous',
  handler: generateQuestions
});
