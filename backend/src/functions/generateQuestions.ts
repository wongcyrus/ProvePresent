/**
 * Generate Questions API Endpoint
 * Uses Azure OpenAI to generate quiz questions from slide analysis
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
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

    // Call Azure OpenAI to generate questions
    const openaiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const openaiKey = process.env.AZURE_OPENAI_KEY;
    const openaiDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.2-chat';

    if (!openaiEndpoint || !openaiKey) {
      throw new Error('Azure OpenAI not configured');
    }

    const slideContent = `
Topic: ${analysis.topic}
Title: ${analysis.title || 'N/A'}
Key Points: ${analysis.keyPoints?.join(', ') || 'N/A'}
Code Examples: ${analysis.codeExamples?.join('\n') || 'N/A'}
Formulas: ${analysis.formulas?.join(', ') || 'N/A'}
Summary: ${analysis.summary || 'N/A'}
`;

    const difficultyFilter = difficulty || analysis.difficulty || 'MEDIUM';

    const apiUrl = `${openaiEndpoint}/openai/deployments/${openaiDeployment}/chat/completions?api-version=2024-10-21`;

    const requestBody = {
      messages: [
        {
          role: 'system',
          content: `You are a university professor creating quiz questions to test student attention and understanding.

IMPORTANT FORMATTING RULES:
- Keep questions SHORT and DIRECT (one sentence when possible)
- Use simple, clear language
- Avoid long, complex sentences
- Break multi-part questions into separate questions
- For options, keep them concise (5-10 words max)

Generate questions that:
- Test comprehension, not just memorization
- Are clear and concise
- Match the specified difficulty level
- Can be answered based on the slide content
- Help identify if students are paying attention

ONLY create MULTIPLE CHOICE questions with 4 options and 1 correct answer.`
        },
        {
          role: 'user',
          content: `Based on this slide content:
${slideContent}

Generate ${count} MULTIPLE CHOICE quiz questions at ${difficultyFilter} difficulty level.

FORMATTING REQUIREMENTS:
- Question text: Maximum 15 words, one clear sentence
- Options: Maximum 8 words each, concise and distinct
- Use simple vocabulary appropriate for the difficulty level
- ONLY generate MULTIPLE_CHOICE questions (no SHORT_ANSWER)

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "questions": [
    {
      "text": "Short, clear question?",
      "type": "MULTIPLE_CHOICE",
      "difficulty": "EASY" or "MEDIUM" or "HARD",
      "options": ["Brief option A", "Brief option B", "Brief option C", "Brief option D"],
      "correctAnswer": "Brief option A",
      "explanation": "Why this is the correct answer"
    }
  ]
}`
        }
      ],
      max_completion_tokens: 2000,
      response_format: { type: "json_object" }
      // temperature not set - uses default (1) for model compatibility
    };

    // Retry logic with exponential backoff for rate limits
    let response;
    let lastError;
    const maxRetries = 3;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': openaiKey
          },
          body: JSON.stringify(requestBody)
        });

        if (response.ok) {
          break; // Success, exit retry loop
        }

        const errorText = await response.text();
        
        // Handle rate limit errors with retry
        if (response.status === 429) {
          let retryAfter = 20;
          try {
            const errorData = JSON.parse(errorText);
            const match = errorData.error?.message?.match(/retry after (\d+) seconds/i);
            if (match) {
              retryAfter = parseInt(match[1]);
            }
          } catch (e) {
            // Use default retry time
          }
          
          if (attempt < maxRetries - 1) {
            context.log(`Rate limit hit, retrying after ${retryAfter} seconds (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            continue;
          }
        }
        
        // Non-rate-limit error or final attempt
        context.error('OpenAI API error:', errorText);
        throw new Error(`OpenAI API error: ${response.status}`);
        
      } catch (error: any) {
        lastError = error;
        if (attempt === maxRetries - 1) {
          throw error;
        }
      }
    }

    if (!response || !response.ok) {
      throw lastError || new Error('Failed to get response from OpenAI');
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    const questionsData = JSON.parse(content);
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
