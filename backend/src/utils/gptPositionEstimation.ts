/**
 * GPT Position Estimation Service
 * 
 * This module provides AI-powered seating position estimation using Azure OpenAI vision-capable chat models.
 * It analyzes student photos to estimate their seating positions based on:
 * - Projector screen visibility and angle
 * - Projector screen size in the frame
 * - Classroom features visible in the background
 * - Relative positions compared to other students' photos
 * 
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */

import { InvocationContext } from '@azure/functions';
import {
  PositionEstimationInput,
  PositionEstimationOutput,
  GPTAnalysisResponse,
  SeatingPosition
} from '../types/studentImageCapture';
import { generateReadSasUrl } from './blobStorage';

/**
 * GPT API configuration
 */
const GPT_CONFIG = {
  maxTokens: 2000,
  temperature: 0.3,
  timeoutMs: 60000, // 60 seconds
  maxRetries: 1
};

/**
 * System prompt for GPT position estimation
 */
const SYSTEM_PROMPT = `You are an AI assistant that analyzes classroom photos to estimate student seating positions. You will receive multiple photos taken by students during an online class session. Each photo shows the student's view of the classroom, potentially including the projector screen or whiteboard in the background.

Your task is to estimate the relative seating position of each student based on:
1. Projector screen visibility and angle
2. Projector screen size in the frame
3. Classroom features visible in the background
4. Relative positions compared to other students' photos

Provide estimates as row and column numbers, with row 1 being closest to the projector and column 1 being leftmost from the teacher's perspective.`;

/**
 * Generate user prompt for GPT analysis
 */
function generateUserPrompt(imageCount: number, images: Array<{ studentId: string; url: string }>): string {
  const imageList = images.map((img, i) => `Student ${i + 1} (ID: ${img.studentId}): [Image URL]`).join('\n');
  
  return `Analyze these ${imageCount} student photos and estimate their seating positions:

${imageList}

Respond in JSON format:
{
  "positions": [
    {
      "studentId": "student@email.com",
      "estimatedRow": 2,
      "estimatedColumn": 3,
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reasoning": "Brief explanation"
    }
  ],
  "analysisNotes": "Overall observations about the classroom layout"
}

Consider:
- Students with larger projector screens are likely closer to the front
- Students with similar viewing angles are likely in the same row
- Projector position and angle indicate column position
- If projector is not visible, confidence should be LOW`;
}

/**
 * Parse GPT response to extract JSON
 */
function parseGPTResponse(content: string): GPTAnalysisResponse {
  // Check if GPT refused the request
  if (content.toLowerCase().includes("i'm unable") || 
      content.toLowerCase().includes("i cannot") ||
      content.toLowerCase().includes("i can't")) {
    throw new Error(`GPT refused the request: ${content.substring(0, 200)}`);
  }
  
  // Try to extract JSON from code blocks first
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || 
                    content.match(/```\n([\s\S]*?)\n```/);
  
  const jsonStr = jsonMatch ? jsonMatch[1] : content.trim();
  
  try {
    return JSON.parse(jsonStr) as GPTAnalysisResponse;
  } catch (error) {
    // Provide more context in the error
    const preview = content.substring(0, 200);
    throw new Error(`Failed to parse GPT response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}. Response preview: ${preview}`);
  }
}

/**
 * Call Azure OpenAI vision-capable chat completions API with retry logic
 */
async function callGPTAPI(
  messages: any[],
  context: InvocationContext
): Promise<any> {
  const openaiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const openaiKey = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_VISION_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
  
  if (!openaiEndpoint || !openaiKey) {
    throw new Error('Azure OpenAI configuration is missing (AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_KEY)');
  }

  const apiUrl = `${openaiEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-10-21`;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= GPT_CONFIG.maxRetries; attempt++) {
    try {
      context.log(`Calling GPT API (attempt ${attempt + 1}/${GPT_CONFIG.maxRetries + 1})`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GPT_CONFIG.timeoutMs);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': openaiKey,
        },
        body: JSON.stringify({
          messages,
          max_tokens: GPT_CONFIG.maxTokens,
          temperature: GPT_CONFIG.temperature,
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GPT API error: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      context.log('GPT API call successful');
      return result;
      
    } catch (error: any) {
      lastError = error;
      
      if (error.name === 'AbortError') {
        context.warn(`GPT API timeout after ${GPT_CONFIG.timeoutMs}ms (attempt ${attempt + 1})`);
      } else {
        context.warn(`GPT API error (attempt ${attempt + 1}): ${error.message}`);
      }
      
      // If this is the last attempt, throw the error
      if (attempt === GPT_CONFIG.maxRetries) {
        throw lastError;
      }
      
      // Wait 5 seconds before retry
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  throw lastError || new Error('GPT API call failed after all retries');
}

/**
 * Estimate seating positions from student photos using a vision-capable Azure OpenAI deployment
 * 
 * This function:
 * 1. Generates read SAS URLs for each image
 * 2. Constructs GPT system and user prompts
 * 3. Calls Azure OpenAI chat completions API with multi-image analysis
 * 4. Parses the response to extract position estimates
 * 5. Returns structured position data
 * 
 * @param input - Capture request ID and array of image blob URLs
 * @param context - Azure Functions invocation context
 * @returns Position estimation output with positions and analysis notes
 * @throws Error if GPT API fails, times out, or returns invalid JSON
 * 
 * Validates: Requirements 6.1, 6.2, 6.3
 */
export async function estimateSeatingPositions(
  input: PositionEstimationInput,
  context: InvocationContext
): Promise<PositionEstimationOutput> {
  context.log(`Starting position estimation for capture request: ${input.captureRequestId}`);
  context.log(`Analyzing ${input.imageUrls.length} student photos`);
  
  try {
    // ========================================================================
    // Step 1: Generate read SAS URLs for GPT access
    // ========================================================================
    
    const imageUrls = input.imageUrls.map(img => {
      const sasUrl = generateReadSasUrl(img.blobUrl);
      context.log(`Generated read SAS URL for student: ${img.studentId}`);
      return {
        studentId: img.studentId,
        url: sasUrl
      };
    });
    
    // ========================================================================
    // Step 2: Construct GPT messages with system and user prompts
    // ========================================================================
    
    const userPrompt = generateUserPrompt(input.imageUrls.length, imageUrls);
    
    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userPrompt
          },
          // Add all images to the message
          ...imageUrls.map(img => ({
            type: 'image_url',
            image_url: { url: img.url }
          }))
        ]
      }
    ];
    
    context.log('Constructed GPT messages with system prompt and user images');
    
    // ========================================================================
    // Step 3: Call Azure OpenAI vision-capable chat API
    // ========================================================================
    
    const result = await callGPTAPI(messages, context);
    
    const content = result.choices?.[0]?.message?.content;
    const tokensUsed = result.usage?.total_tokens || 0;
    
    if (!content) {
      throw new Error('GPT API returned empty content');
    }
    
    context.log(`GPT API returned response (${tokensUsed} tokens used)`);
    context.log(`Raw GPT response: ${content.substring(0, 500)}...`); // Log first 500 chars
    
    // ========================================================================
    // Step 4: Parse GPT response to extract positions
    // ========================================================================
    
    let analysis: GPTAnalysisResponse;
    
    try {
      analysis = parseGPTResponse(content);
    } catch (parseError) {
      context.error('Failed to parse GPT response:', parseError);
      context.error('Raw GPT response:', content);
      throw new Error(`GPT response parsing failed: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
    }
    
    // Validate the parsed response
    if (!analysis.positions || !Array.isArray(analysis.positions)) {
      throw new Error('GPT response missing positions array');
    }
    
    if (!analysis.analysisNotes) {
      context.warn('GPT response missing analysisNotes, using default');
      analysis.analysisNotes = 'Position analysis completed';
    }
    
    context.log(`Successfully parsed ${analysis.positions.length} position estimates`);
    
    // ========================================================================
    // Step 5: Return structured position data
    // ========================================================================
    
    const output: PositionEstimationOutput = {
      positions: analysis.positions,
      analysisNotes: analysis.analysisNotes
    };
    
    context.log('Position estimation completed successfully');
    
    return output;
    
  } catch (error: any) {
    context.error('Position estimation failed:', error);
    throw error;
  }
}
