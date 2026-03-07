/**
 * Generate Questions API Endpoint
 * Uses Azure AI Foundry Agent to generate quiz questions from slide analysis
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { getAgentClient } from '../utils/agentService';
import { randomUUID } from 'crypto';

interface NormalizedQuestion {
  text: string;
  type: 'MULTIPLE_CHOICE';
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  options: string[];
  correctAnswer: string;
  explanation: string;
}

function parseJsonFromAgentContent(content: string): any {
  let cleanContent = content.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();

  const firstBrace = cleanContent.indexOf('{');
  const lastBrace = cleanContent.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleanContent);
}

function extractRawQuestions(payload: any): any[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const candidates = [
    payload.questions,
    payload.items,
    payload.quizQuestions,
    payload.data?.questions,
    payload.result?.questions
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeQuestion(raw: any, defaultDifficulty: string): NormalizedQuestion | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const text = String(raw.text || raw.question || raw.prompt || '').trim();
  if (!text) {
    return null;
  }

  const optionsCandidate = Array.isArray(raw.options)
    ? raw.options
    : Array.isArray(raw.choices)
      ? raw.choices
      : [];

  const options = optionsCandidate
    .map((option: any) => {
      if (typeof option === 'string') {
        return option.trim();
      }
      if (option && typeof option === 'object') {
        return String(option.text || option.label || option.value || '').trim();
      }
      return '';
    })
    .filter((value: string) => value.length > 0)
    .slice(0, 4);

  if (options.length < 2) {
    return null;
  }

  const allowedDifficulties = new Set(['EASY', 'MEDIUM', 'HARD']);
  const difficulty = String(raw.difficulty || defaultDifficulty || 'MEDIUM').toUpperCase();
  const normalizedDifficulty = allowedDifficulties.has(difficulty) ? (difficulty as 'EASY' | 'MEDIUM' | 'HARD') : 'MEDIUM';

  let correctAnswer = String(raw.correctAnswer || raw.answer || '').trim();
  if (!correctAnswer && Number.isInteger(raw.correctOptionIndex)) {
    correctAnswer = options[raw.correctOptionIndex] || '';
  }
  if (!correctAnswer && Number.isInteger(raw.correctIndex)) {
    correctAnswer = options[raw.correctIndex] || '';
  }
  if (!correctAnswer || !options.includes(correctAnswer)) {
    correctAnswer = options[0];
  }

  const explanation = String(raw.explanation || raw.reason || '').trim();

  return {
    text,
    type: 'MULTIPLE_CHOICE',
    difficulty: normalizedDifficulty,
    options,
    correctAnswer,
    explanation
  };
}

export async function generateQuestions(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/quiz/generate-questions request');

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

    const difficultyFilter = String(difficulty || analysis.difficulty || 'MEDIUM').toUpperCase();
    const requestedCount = Math.min(10, Math.max(1, Number(count) || 3));

    // Use Azure AI Foundry Agent to generate questions
    // Agent is pre-configured in infrastructure with instructions
    const agentClient = getAgentClient();

    const userMessage = `Based on this slide content:
${slideContent}

Generate ${requestedCount} MULTIPLE CHOICE quiz questions at ${difficultyFilter} difficulty level.

FORMATTING REQUIREMENTS:
- Question text: Maximum 15 words, one clear sentence
- Options: Maximum 8 words each, concise and distinct
- Use simple vocabulary appropriate for the difficulty level
- ONLY generate MULTIPLE_CHOICE questions (no SHORT_ANSWER)

Return ONLY valid JSON (no markdown, no code blocks).`;

    context.log('Calling AI Agent to generate questions...');
    
    const runGeneration = async (prompt: string): Promise<NormalizedQuestion[]> => {
      let response;
      try {
        response = await agentClient.runSingleInteraction({
          agentName: 'QuizQuestionGenerator',
          userMessage: prompt
        });
      } catch (error: any) {
        context.error('Agent interaction failed:', error);
        throw new Error(`Agent failed: ${error.message}`);
      }

      if (!response.content) {
        return [];
      }

      try {
        const parsed = parseJsonFromAgentContent(response.content);
        const rawQuestions = extractRawQuestions(parsed);
        return rawQuestions
          .map((raw) => normalizeQuestion(raw, difficultyFilter))
          .filter((question): question is NormalizedQuestion => question !== null)
          .slice(0, requestedCount);
      } catch (parseError: any) {
        context.warn('Failed to parse agent response on attempt:', parseError.message);
        return [];
      }
    };

    let questions = await runGeneration(userMessage);

    if (questions.length === 0) {
      context.warn('Agent returned zero parseable questions, retrying with strict correction prompt');
      const correctionPrompt = `${userMessage}

IMPORTANT: Your previous response was invalid or empty.
Return exactly this JSON shape:
{
  "questions": [
    {
      "text": "Question text",
      "type": "MULTIPLE_CHOICE",
      "difficulty": "${difficultyFilter}",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Option A",
      "explanation": "Brief explanation"
    }
  ]
}
No markdown. No extra text.`;

      questions = await runGeneration(correctionPrompt);
    }

    if (questions.length === 0) {
      throw new Error('Agent returned zero valid questions after retry');
    }

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
        options: JSON.stringify(q.options),
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
        options: q.options,
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
