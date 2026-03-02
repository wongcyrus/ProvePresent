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
 * 
 * IMPORTANT: This system uses GPT-5.2-chat which has a 10 image limit per request.
 * For classes with more than 10 students, automatic batching with overlap is implemented.
 * 
 * Overlapping Strategy:
 * - Each batch includes 3 students from the previous batch as "anchor points"
 * - These overlapping students allow us to align batches accurately
 * - Example for 25 students:
 *   - Batch 1: Students 1-10
 *   - Batch 2: Students 8-17 (overlap: 8, 9, 10)
 *   - Batch 3: Students 15-24 (overlap: 15, 16, 17)
 *   - Batch 4: Student 22-25 (overlap: 22, 23, 24)
 */
const GPT_CONFIG = {
  maxTokens: 2000,
  // temperature not set - uses default (1) for model compatibility with reasoning models
  timeoutMs: 60000, // 60 seconds
  maxRetries: 3, // Increased for rate limit handling
  maxImagesPerRequest: 10, // GPT-5.2-chat limit
  batchSize: 10, // Process 10 images per batch
  overlapSize: 3 // Number of students to overlap between batches
};

/**
 * System prompt for GPT position estimation
 */
const SYSTEM_PROMPT = `You are an AI assistant that analyzes classroom photos to estimate student seating positions. You will receive photos taken by students during an online class session. Each photo shows the student's view of the classroom, potentially including the projector screen or whiteboard in the background.

Your task is to estimate the relative seating position of each student based on:
1. Projector screen visibility and angle
2. Projector screen size in the frame
3. Classroom features visible in the background
4. Relative positions compared to other students' photos

IMPORTANT: When analyzing batches of students:
- If this is part of a larger class, students in later batches typically sit BEHIND earlier batches
- Row numbers represent distance from the projector (row 1 = front, higher rows = back)
- Column numbers represent left-right position from teacher's perspective (column 1 = leftmost)
- Analyze the students in this batch relative to each other, but be aware they may be part of a larger seating arrangement

Provide estimates as row and column numbers, with row 1 being closest to the projector and column 1 being leftmost from the teacher's perspective.`;

/**
 * Generate user prompt for GPT analysis
 */
function generateUserPrompt(imageCount: number, images: Array<{ studentId: string; url: string }>, batchInfo?: { current: number; total: number }): string {
  const imageList = images.map((img, i) => `Student ${i + 1} (ID: ${img.studentId}): [Image URL]`).join('\n');
  
  let batchContext = '';
  if (batchInfo) {
    if (batchInfo.total === 1) {
      // Single batch - all students
      batchContext = `\n\nThis is the complete class of ${imageCount} students. Analyze their seating positions relative to each other.`;
    } else {
      // Multiple batches
      batchContext = `\n\nIMPORTANT CONTEXT:
- This is batch ${batchInfo.current} of ${batchInfo.total} in a larger class
- Analyze these ${imageCount} students relative to EACH OTHER within this batch
- Assign row and column numbers based on their relative positions
- Students in this batch may sit behind students in earlier batches
- Focus on the relative arrangement of these specific students`;
    }
  }
  
  return `Analyze these ${imageCount} student photos and estimate their seating positions:

${imageList}${batchContext}

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
- Students with larger projector screens are likely closer to the front (lower row numbers)
- Students with similar viewing angles are likely in the same row
- Projector position and angle indicate column position
- If projector is not visible, confidence should be LOW
- Assign row numbers starting from 1 for the closest students in THIS batch`;
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
  const deployment = process.env.AZURE_OPENAI_VISION_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.2-chat';
  
  if (!openaiEndpoint || !openaiKey) {
    throw new Error('Azure OpenAI configuration is missing (AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_KEY)');
  }

  context.log(`Using deployment: ${deployment}`);
  const apiUrl = `${openaiEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-10-21`;
  
  // Define JSON Schema for structured output
  const responseSchema = {
    type: 'object',
    properties: {
      positions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            studentId: {
              type: 'string',
              description: 'The student email/ID'
            },
            estimatedRow: {
              type: 'integer',
              description: 'Row number (1 = closest to projector)'
            },
            estimatedColumn: {
              type: 'integer',
              description: 'Column number (1 = leftmost from teacher perspective)'
            },
            confidence: {
              type: 'string',
              enum: ['HIGH', 'MEDIUM', 'LOW'],
              description: 'Confidence level of the position estimate'
            },
            reasoning: {
              type: 'string',
              description: 'Brief explanation of the position estimate'
            }
          },
          required: ['studentId', 'estimatedRow', 'estimatedColumn', 'confidence', 'reasoning'],
          additionalProperties: false
        }
      },
      analysisNotes: {
        type: 'string',
        description: 'Overall observations about the classroom layout'
      }
    },
    required: ['positions', 'analysisNotes'],
    additionalProperties: false
  };
  
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
          max_completion_tokens: GPT_CONFIG.maxTokens,
          // temperature not set - uses default (1) for model compatibility
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'seating_position_analysis',
              description: 'Analysis of student seating positions based on classroom photos',
              schema: responseSchema,
              strict: true
            }
          }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        
        // Handle rate limit errors - retry with backoff
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
          
          context.log(`Rate limit hit, will retry after ${retryAfter} seconds (attempt ${attempt + 1}/${GPT_CONFIG.maxRetries + 1})`);
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue; // Retry
        }
        
        throw new Error(`GPT API error: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      context.log('GPT API call successful with structured output');
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
    // Step 2: Check if batching is needed (more than 10 images)
    // ========================================================================
    
    const needsBatching = imageUrls.length > GPT_CONFIG.maxImagesPerRequest;
    
    if (needsBatching) {
      context.log(`Image count (${imageUrls.length}) exceeds limit of ${GPT_CONFIG.maxImagesPerRequest}. Using batching strategy.`);
      return await processBatchedAnalysis(imageUrls, context);
    }
    
    // ========================================================================
    // Step 3: Single batch processing (10 or fewer images)
    // ========================================================================
    
    context.log('Processing single batch (10 or fewer images)');
    return await processSingleBatch(imageUrls, context);
    
  } catch (error: any) {
    context.error('Position estimation failed:', error);
    throw error;
  }
}

/**
 * Process a single batch of images (10 or fewer)
 */
async function processSingleBatch(
  imageUrls: Array<{ studentId: string; url: string }>,
  context: InvocationContext
): Promise<PositionEstimationOutput> {
  const userPrompt = generateUserPrompt(imageUrls.length, imageUrls);
  
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
        ...imageUrls.map(img => ({
          type: 'image_url',
          image_url: { url: img.url }
        }))
      ]
    }
  ];
  
  context.log('Constructed GPT messages with system prompt and user images');
  
  const result = await callGPTAPI(messages, context);
  
  const content = result.choices?.[0]?.message?.content;
  const tokensUsed = result.usage?.total_tokens || 0;
  
  if (!content) {
    throw new Error('GPT API returned empty content');
  }
  
  context.log(`GPT API returned response (${tokensUsed} tokens used)`);
  
  const analysis = parseGPTResponse(content);
  
  if (!analysis.positions || !Array.isArray(analysis.positions)) {
    throw new Error('GPT response missing positions array');
  }
  
  context.log(`Successfully parsed ${analysis.positions.length} position estimates`);
  
  return {
    positions: analysis.positions,
    analysisNotes: analysis.analysisNotes || 'Position analysis completed'
  };
}

/**
 * Process multiple batches of images (more than 10) with overlapping students
 * Uses overlapping students as anchor points to align batches accurately
 */
async function processBatchedAnalysis(
  imageUrls: Array<{ studentId: string; url: string }>,
  context: InvocationContext
): Promise<PositionEstimationOutput> {
  const batchSize = GPT_CONFIG.batchSize;
  const overlapSize = GPT_CONFIG.overlapSize;
  const batches: Array<Array<{ studentId: string; url: string }>> = [];
  
  // Split into overlapping batches
  // Batch 1: 0-9 (10 students)
  // Batch 2: 7-16 (10 students, 3 overlap with batch 1)
  // Batch 3: 14-23 (10 students, 3 overlap with batch 2)
  let startIndex = 0;
  while (startIndex < imageUrls.length) {
    const endIndex = Math.min(startIndex + batchSize, imageUrls.length);
    batches.push(imageUrls.slice(startIndex, endIndex));
    
    // Move forward by (batchSize - overlapSize) to create overlap
    // If this is the last batch (remaining < batchSize), we're done
    if (endIndex === imageUrls.length) {
      break;
    }
    startIndex += (batchSize - overlapSize);
  }
  
  context.log(`Split ${imageUrls.length} images into ${batches.length} overlapping batches`);
  batches.forEach((batch, i) => {
    const studentIds = batch.map(img => img.studentId).join(', ');
    context.log(`Batch ${i + 1}: ${batch.length} students (${studentIds})`);
  });
  
  const batchResults: Array<{ positions: SeatingPosition[]; notes: string }> = [];
  
  // Process each batch sequentially
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    
    context.log(`Processing batch ${batchNum}/${batches.length} (${batch.length} images)`);
    
    const userPrompt = generateUserPrompt(batch.length, batch, {
      current: batchNum,
      total: batches.length
    });
    
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
          ...batch.map(img => ({
            type: 'image_url',
            image_url: { url: img.url }
          }))
        ]
      }
    ];
    
    const result = await callGPTAPI(messages, context);
    
    const content = result.choices?.[0]?.message?.content;
    const tokensUsed = result.usage?.total_tokens || 0;
    
    if (!content) {
      throw new Error(`GPT API returned empty content for batch ${batchNum}`);
    }
    
    context.log(`Batch ${batchNum} completed (${tokensUsed} tokens used)`);
    
    const analysis = parseGPTResponse(content);
    
    if (!analysis.positions || !Array.isArray(analysis.positions)) {
      throw new Error(`Batch ${batchNum} response missing positions array`);
    }
    
    batchResults.push({
      positions: analysis.positions,
      notes: analysis.analysisNotes || `Batch ${batchNum} analysis`
    });
    
    context.log(`Batch ${batchNum} parsed ${analysis.positions.length} positions`);
    
    // Add delay between batches to avoid rate limiting (except for last batch)
    if (i < batches.length - 1) {
      context.log('Waiting 2 seconds before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Align batches using overlapping students
  context.log('Aligning batches using overlapping students...');
  const alignedPositions = alignBatchesUsingOverlap(batchResults, batches, context);
  
  context.log(`Batched analysis complete: ${alignedPositions.length} unique students from ${batches.length} batches`);
  
  return {
    positions: alignedPositions,
    analysisNotes: `Analyzed ${imageUrls.length} students in ${batches.length} overlapping batches. ${batchResults.map((r, i) => `Batch ${i + 1}: ${r.notes}`).join(' ')}`
  };
}

/**
 * Align batches using overlapping students as anchor points
 * 
 * Strategy:
 * 1. Keep Batch 1 positions as-is (reference frame)
 * 2. For each subsequent batch:
 *    - Find overlapping students (students that appear in both batches)
 *    - Calculate the offset by comparing their positions in both batches
 *    - Apply the offset to all non-overlapping students in the new batch
 * 3. Merge all positions, keeping only one entry per student
 * 
 * Example with 25 students:
 * - Batch 1: Students 1-10 → Positions as-is
 * - Batch 2: Students 8-17 → Compare positions of students 8,9,10 to calculate offset
 * - Batch 3: Students 15-24 → Compare positions of students 15,16,17 to calculate offset
 */
function alignBatchesUsingOverlap(
  batchResults: Array<{ positions: SeatingPosition[]; notes: string }>,
  batches: Array<Array<{ studentId: string; url: string }>>,
  context: InvocationContext
): SeatingPosition[] {
  if (batchResults.length === 1) {
    // Single batch, no alignment needed
    return batchResults[0].positions;
  }
  
  // Start with first batch as reference frame
  const alignedPositions = new Map<string, SeatingPosition>();
  
  // Add all positions from first batch
  for (const position of batchResults[0].positions) {
    alignedPositions.set(position.studentId, position);
  }
  
  context.log(`Batch 1: Added ${batchResults[0].positions.length} positions as reference frame`);
  
  // Process each subsequent batch
  for (let batchIndex = 1; batchIndex < batchResults.length; batchIndex++) {
    const currentBatch = batchResults[batchIndex];
    const currentBatchStudents = batches[batchIndex].map(img => img.studentId);
    const batchNum = batchIndex + 1;
    
    // Find overlapping students (students already in alignedPositions)
    const overlapStudents = currentBatch.positions.filter(pos => 
      alignedPositions.has(pos.studentId)
    );
    
    if (overlapStudents.length === 0) {
      context.warn(`Batch ${batchNum}: No overlapping students found! Using simple stacking.`);
      // Fallback: stack vertically
      const maxRow = Math.max(...Array.from(alignedPositions.values()).map(p => p.estimatedRow));
      for (const position of currentBatch.positions) {
        if (!alignedPositions.has(position.studentId)) {
          alignedPositions.set(position.studentId, {
            ...position,
            estimatedRow: position.estimatedRow + maxRow,
            reasoning: `${position.reasoning} [Batch ${batchNum}, fallback stacking]`
          });
        }
      }
      continue;
    }
    
    context.log(`Batch ${batchNum}: Found ${overlapStudents.length} overlapping students: ${overlapStudents.map(s => s.studentId).join(', ')}`);
    
    // Calculate offset by comparing overlapping students' positions
    let totalRowOffset = 0;
    let totalColOffset = 0;
    let validComparisons = 0;
    
    for (const overlapStudent of overlapStudents) {
      const referencePos = alignedPositions.get(overlapStudent.studentId)!;
      const currentPos = overlapStudent;
      
      const rowDiff = referencePos.estimatedRow - currentPos.estimatedRow;
      const colDiff = referencePos.estimatedColumn - currentPos.estimatedColumn;
      
      context.log(`  ${overlapStudent.studentId}: Reference (${referencePos.estimatedRow},${referencePos.estimatedColumn}) vs Current (${currentPos.estimatedRow},${currentPos.estimatedColumn}) → Offset (${rowDiff},${colDiff})`);
      
      totalRowOffset += rowDiff;
      totalColOffset += colDiff;
      validComparisons++;
    }
    
    // Calculate average offset
    const avgRowOffset = Math.round(totalRowOffset / validComparisons);
    const avgColOffset = Math.round(totalColOffset / validComparisons);
    
    context.log(`Batch ${batchNum}: Calculated offset: Row ${avgRowOffset >= 0 ? '+' : ''}${avgRowOffset}, Column ${avgColOffset >= 0 ? '+' : ''}${avgColOffset}`);
    
    // Apply offset to all non-overlapping students in this batch
    let addedCount = 0;
    for (const position of currentBatch.positions) {
      if (!alignedPositions.has(position.studentId)) {
        alignedPositions.set(position.studentId, {
          ...position,
          estimatedRow: position.estimatedRow + avgRowOffset,
          estimatedColumn: position.estimatedColumn + avgColOffset,
          reasoning: `${position.reasoning} [Batch ${batchNum}, offset (${avgRowOffset},${avgColOffset})]`
        });
        addedCount++;
      }
    }
    
    context.log(`Batch ${batchNum}: Added ${addedCount} new students (${overlapStudents.length} overlapping students skipped)`);
  }
  
  const finalPositions = Array.from(alignedPositions.values());
  
  // Validate the final seating plan
  const positionMap = new Map<string, string>();
  const conflicts: string[] = [];
  
  for (const pos of finalPositions) {
    const key = `${pos.estimatedRow},${pos.estimatedColumn}`;
    if (positionMap.has(key)) {
      conflicts.push(`Position (${pos.estimatedRow}, ${pos.estimatedColumn}) assigned to both ${positionMap.get(key)} and ${pos.studentId}`);
    } else {
      positionMap.set(key, pos.studentId);
    }
  }
  
  if (conflicts.length > 0) {
    context.warn(`Position conflicts detected after alignment:`);
    conflicts.forEach(c => context.warn(`  - ${c}`));
  } else {
    context.log(`✓ No position conflicts - all ${finalPositions.length} students have unique positions`);
  }
  
  // Log the final seating grid dimensions
  const finalMaxRow = Math.max(...finalPositions.map(p => p.estimatedRow));
  const finalMinRow = Math.min(...finalPositions.map(p => p.estimatedRow));
  const finalMaxCol = Math.max(...finalPositions.map(p => p.estimatedColumn));
  const finalMinCol = Math.min(...finalPositions.map(p => p.estimatedColumn));
  context.log(`Final seating grid: Rows ${finalMinRow}-${finalMaxRow}, Columns ${finalMinCol}-${finalMaxCol}`);
  
  return finalPositions;
}
