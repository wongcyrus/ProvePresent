# GPT-5.2-chat Batching with Overlapping Students

## Overview

GPT-5.2-chat has a 10 image limit per request. This guide explains how we handle classes of any size through automatic batching with overlapping students as anchor points for accurate position alignment.

## Quick Facts

- **Model**: GPT-5.2-chat (gpt-5.2-chat version 2026-02-10)
- **Image Limit**: 10 images per request
- **Solution**: Overlapping batches with anchor-based alignment
- **Overlap Size**: 3 students between consecutive batches
- **API Version**: 2024-10-21 (supports structured outputs)

## How It Works

### 1. Overlapping Batch Strategy

For 25 students, we create overlapping batches:
- **Batch 1**: Students 1-10 (10 students)
- **Batch 2**: Students 8-17 (10 students, 3 overlap with Batch 1)
- **Batch 3**: Students 15-24 (10 students, 3 overlap with Batch 2)
- **Batch 4**: Students 22-25 (4 students, 3 overlap with Batch 3)

**Key Insight**: The overlapping students (8, 9, 10 in Batch 2) appear in BOTH batches, allowing us to compare their positions and calculate the offset between batches.

### 2. Why Overlapping Works

**Without Overlap** (Old approach - doesn't work):
```
Batch 1: Students 1-10  → GPT assigns rows 1-4
Batch 2: Students 11-20 → GPT assigns rows 1-4
Problem: No way to know if student 11 is in front of, behind, or at same depth as student 1
```

**With Overlap** (New approach - works):
```
Batch 1: Students 1-10  → Student 8 at (row 3, col 2)
Batch 2: Students 8-17  → Student 8 at (row 1, col 2)
Solution: Student 8 appears in both! Offset = 3-1 = +2 rows
         Apply +2 row offset to students 11-17
```

### 3. Alignment Algorithm

```typescript
// Step 1: Keep Batch 1 as reference frame
alignedPositions = Batch1.positions

// Step 2: For each subsequent batch
for (batch in Batch2, Batch3, ...) {
  // Find overlapping students
  overlapStudents = batch.positions.filter(pos => 
    pos.studentId in alignedPositions
  )
  
  // Calculate offset from overlapping students
  for (student in overlapStudents) {
    referencePos = alignedPositions[student]
    currentPos = batch.positions[student]
    rowOffset += (referencePos.row - currentPos.row)
    colOffset += (referencePos.col - currentPos.col)
  }
  avgRowOffset = rowOffset / overlapStudents.length
  avgColOffset = colOffset / overlapStudents.length
  
  // Apply offset to new students
  for (student in batch.positions) {
    if (student not in alignedPositions) {
      alignedPositions[student] = {
        row: student.row + avgRowOffset,
        col: student.col + avgColOffset
      }
    }
  }
}
```

### 4. Example: 25 Students

**Batch Creation**:
```
Batch 1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
Batch 2: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]  ← 8,9,10 overlap
Batch 3: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24] ← 15,16,17 overlap
Batch 4: [22, 23, 24, 25]                         ← 22,23,24 overlap
```

**GPT Analysis**:
```
Batch 1 Results:
  Student 1: (row 1, col 1)
  Student 8: (row 3, col 2)  ← Anchor point
  Student 10: (row 4, col 1) ← Anchor point
  ...

Batch 2 Results:
  Student 8: (row 1, col 2)  ← Same student, different position!
  Student 10: (row 2, col 1) ← Same student, different position!
  Student 11: (row 2, col 2)
  Student 17: (row 4, col 3)
  ...
```

**Alignment Calculation**:
```
Overlapping students: 8, 9, 10

Student 8:  Reference (3,2) vs Current (1,2) → Offset (+2, 0)
Student 9:  Reference (3,3) vs Current (1,3) → Offset (+2, 0)
Student 10: Reference (4,1) vs Current (2,1) → Offset (+2, 0)

Average offset: (+2, 0)

Apply to Batch 2 new students:
  Student 11: (2,2) + (2,0) = (4,2)
  Student 17: (4,3) + (2,0) = (6,3)
```

**Final Aligned Seating Plan**:
```
         Col 1       Col 2       Col 3
Row 1  → [1]         [2]         [3]         ← Batch 1
Row 2  → [4]         [5]         [6]
Row 3  → [7]         [8]         [9]
Row 4  → [10]        [11]        [12]        ← Batch 2 (offset +2)
Row 5  → [13]        [14]        [15]
Row 6  → [16]        [17]        [18]
Row 7  → [19]        [20]        [21]        ← Batch 3 (offset +4)
Row 8  → [22]        [23]        [24]
Row 9  → [25]                                ← Batch 4 (offset +6)
```

## Prompts

### System Prompt

```typescript
const SYSTEM_PROMPT = `You are an AI assistant that analyzes classroom photos to estimate student seating positions.

IMPORTANT: When analyzing batches of students:
- If this is part of a larger class, students in later batches typically sit BEHIND earlier batches
- Row numbers represent distance from the projector (row 1 = front, higher rows = back)
- Column numbers represent left-right position from teacher's perspective (column 1 = leftmost)
- Analyze the students in this batch relative to each other, but be aware they may be part of a larger seating arrangement

Provide estimates as row and column numbers.`;
```

### User Prompt with Batch Context

```typescript
function generateUserPrompt(imageCount, images, batchInfo?) {
  let batchContext = '';
  if (batchInfo && batchInfo.total > 1) {
    batchContext = `
IMPORTANT CONTEXT:
- This is batch ${batchInfo.current} of ${batchInfo.total} in a larger class
- Analyze these ${imageCount} students relative to EACH OTHER within this batch
- Assign row and column numbers based on their relative positions
- Students in this batch may sit behind students in earlier batches`;
  }
  return `Analyze these ${imageCount} student photos...${batchContext}`;
}
```

**Why Both Prompt and Normalization?**
- **Prompt**: Helps GPT understand batch context for better analysis
- **Normalization**: Ensures no position conflicts when combining batches
- Both are needed for accurate results

## Structured Outputs

JSON Schema guarantees response format:

```typescript
const responseSchema = {
  type: 'object',
  properties: {
    positions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          studentId: { type: 'string' },
          estimatedRow: { type: 'integer' },
          estimatedColumn: { type: 'integer' },
          confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          reasoning: { type: 'string' }
        },
        required: ['studentId', 'estimatedRow', 'estimatedColumn', 'confidence', 'reasoning']
      }
    },
    analysisNotes: { type: 'string' }
  },
  required: ['positions', 'analysisNotes']
};

// API call
response_format: {
  type: 'json_schema',
  json_schema: {
    name: 'seating_position_analysis',
    schema: responseSchema,
    strict: true
  }
}
```

**Benefits**:
- Guaranteed valid JSON
- All required fields present
- Correct data types
- No parsing errors

## Performance

| Students | Batches | Overlap | Unique | API Calls | Total Time |
|----------|---------|---------|--------|-----------|------------|
| 10 | 1 | 0 | 10 | 1 | ~5-10s |
| 20 | 2 | 3 | 17 | 2 | ~15-20s |
| 30 | 3 | 6 | 24 | 3 | ~25-30s |
| 50 | 5 | 12 | 38 | 5 | ~45-50s |

Formula: `Time ≈ (batches × 10s) + ((batches - 1) × 2s)`

**Note**: With overlap, we analyze more images total (e.g., 27 for 20 students instead of 20), but get much more accurate positioning.

## Advantages of Overlapping Batches

1. **Accurate Position Alignment**: Uses actual GPT analysis of same students to calculate offsets, not blind assumptions
2. **Handles Non-Linear Seating**: Works even if students don't sit in order (front to back)
3. **Robust to Inconsistencies**: Averages multiple anchor points to smooth out GPT variations
4. **Both Row and Column Offsets**: Can detect and correct both vertical and horizontal misalignments
5. **Automatic Fallback**: If no overlap found (shouldn't happen), falls back to simple stacking

## Code Structure

```
estimateSeatingPositions()
├── Generate SAS URLs
├── Check if batching needed (>10 images)
│
├── IF ≤10 images:
│   └── processSingleBatch()
│       ├── Build GPT message
│       ├── Call GPT API once
│       └── Return positions
│
└── IF >10 images:
    └── processBatchedAnalysis()
        ├── Split into OVERLAPPING batches
        │   ├── Batch 1: 0-9
        │   ├── Batch 2: 7-16 (3 overlap)
        │   ├── Batch 3: 14-23 (3 overlap)
        │   └── ...
        ├── FOR each batch:
        │   ├── Build GPT message with batch context
        │   ├── Call GPT API
        │   ├── Parse response
        │   └── Wait 2 seconds
        ├── alignBatchesUsingOverlap()
        │   ├── Keep Batch 1 as reference
        │   ├── For each subsequent batch:
        │   │   ├── Find overlapping students
        │   │   ├── Calculate offset from overlaps
        │   │   └── Apply offset to new students
        │   └── Validate no conflicts
        └── Return aligned positions
```

## Normalization Algorithm

```typescript
function alignBatchesUsingOverlap(batchResults, batches, context) {
  // Start with Batch 1 as reference frame
  const alignedPositions = new Map();
  for (const position of batchResults[0].positions) {
    alignedPositions.set(position.studentId, position);
  }
  
  // Process each subsequent batch
  for (let batchIndex = 1; batchIndex < batchResults.length; batchIndex++) {
    const currentBatch = batchResults[batchIndex];
    
    // Find overlapping students (already in alignedPositions)
    const overlapStudents = currentBatch.positions.filter(pos => 
      alignedPositions.has(pos.studentId)
    );
    
    if (overlapStudents.length === 0) {
      // Fallback: no overlap found, use simple vertical stacking
      const maxRow = Math.max(...alignedPositions.values().map(p => p.estimatedRow));
      for (const position of currentBatch.positions) {
        if (!alignedPositions.has(position.studentId)) {
          alignedPositions.set(position.studentId, {
            ...position,
            estimatedRow: position.estimatedRow + maxRow
          });
        }
      }
      continue;
    }
    
    // Calculate offset by comparing overlapping students
    let totalRowOffset = 0;
    let totalColOffset = 0;
    
    for (const overlapStudent of overlapStudents) {
      const referencePos = alignedPositions.get(overlapStudent.studentId);
      const currentPos = overlapStudent;
      
      totalRowOffset += (referencePos.estimatedRow - currentPos.estimatedRow);
      totalColOffset += (referencePos.estimatedColumn - currentPos.estimatedColumn);
    }
    
    const avgRowOffset = Math.round(totalRowOffset / overlapStudents.length);
    const avgColOffset = Math.round(totalColOffset / overlapStudents.length);
    
    // Apply offset to new students only
    for (const position of currentBatch.positions) {
      if (!alignedPositions.has(position.studentId)) {
        alignedPositions.set(position.studentId, {
          ...position,
          estimatedRow: position.estimatedRow + avgRowOffset,
          estimatedColumn: position.estimatedColumn + avgColOffset
        });
      }
    }
  }
  
  return Array.from(alignedPositions.values());
}
```

## Configuration

```typescript
const GPT_CONFIG = {
  maxTokens: 2000,
  temperature: 0.3,
  timeoutMs: 60000,
  maxRetries: 1,
  maxImagesPerRequest: 10,  // GPT-5.2-chat limit
  batchSize: 10,             // Images per batch
  overlapSize: 3             // Overlapping students between batches
};
```

**Why 3 overlapping students?**
- Provides multiple anchor points for robust offset calculation
- Averages out any inconsistencies in GPT's position estimates
- Balances accuracy vs. efficiency (more overlap = more API calls)

## Logging

Monitor these logs for debugging:

```
Split 25 images into 4 overlapping batches
Batch 1: 10 students (student1, student2, ..., student10)
Batch 2: 10 students (student8, student9, student10, student11, ..., student17)
Batch 3: 10 students (student15, student16, student17, student18, ..., student24)
Batch 4: 4 students (student22, student23, student24, student25)

Processing batch 1/4 (10 images)
Batch 1 completed (2500 tokens used)
Batch 1 parsed 10 positions
Batch 1: Added 10 positions as reference frame
Waiting 2 seconds before next batch...

Processing batch 2/4 (10 images)
Batch 2 completed (2500 tokens used)
Batch 2 parsed 10 positions
Batch 2: Found 3 overlapping students: student8, student9, student10
  student8: Reference (3,2) vs Current (1,2) → Offset (2,0)
  student9: Reference (3,3) vs Current (1,3) → Offset (2,0)
  student10: Reference (4,1) vs Current (2,1) → Offset (2,0)
Batch 2: Calculated offset: Row +2, Column +0
Batch 2: Added 7 new students (3 overlapping students skipped)
Waiting 2 seconds before next batch...

Processing batch 3/4 (10 images)
Batch 3 completed (2500 tokens used)
Batch 3 parsed 10 positions
Batch 3: Found 3 overlapping students: student15, student16, student17
  student15: Reference (5,2) vs Current (1,2) → Offset (4,0)
  student16: Reference (6,1) vs Current (2,1) → Offset (4,0)
  student17: Reference (6,3) vs Current (2,3) → Offset (4,0)
Batch 3: Calculated offset: Row +4, Column +0
Batch 3: Added 7 new students (3 overlapping students skipped)
Waiting 2 seconds before next batch...

Processing batch 4/4 (4 images)
Batch 4 completed (1200 tokens used)
Batch 4 parsed 4 positions
Batch 4: Found 3 overlapping students: student22, student23, student24
  student22: Reference (8,1) vs Current (1,1) → Offset (7,0)
  student23: Reference (8,2) vs Current (1,2) → Offset (7,0)
  student24: Reference (8,3) vs Current (1,3) → Offset (7,0)
Batch 4: Calculated offset: Row +7, Column +0
Batch 4: Added 1 new students (3 overlapping students skipped)

✓ No position conflicts - all 25 students have unique positions
Final seating grid: Rows 1-9, Columns 1-3

Batched analysis complete: 25 unique students from 4 overlapping batches
```

## Deployment

No infrastructure changes needed! Just deploy the backend:

```bash
cd backend
npm run build
npm run deploy
```

## Testing

### Manual Test with Logs

```bash
# Monitor logs
az functionapp log tail \
  --resource-group rg-qr-attendance-dev \
  --name func-qrattendance-dev

# Start capture with 25+ students
# Look for batching logs
```

### Expected Behavior

- ≤10 students: Single batch, no normalization
- 11-20 students: 2 batches, row offset applied
- 21+ students: 3+ batches, cumulative row offsets

## Troubleshooting

### Issue: No overlapping students found
**Symptom**: Log shows "No overlapping students found! Using simple stacking."  
**Cause**: Batch splitting logic error or student IDs don't match  
**Solution**: Check batch creation logic, verify student IDs are consistent

### Issue: Large offset values
**Symptom**: Offset like (+10, +5) seems too large  
**Cause**: GPT assigned very different positions to overlapping students  
**Solution**: This is expected if batches have very different compositions. The offset reflects actual seating differences.

### Issue: Position conflicts after alignment
**Symptom**: Multiple students assigned to same (row, col)  
**Cause**: Inconsistent GPT analysis or rounding errors  
**Solution**: Check overlap size (increase to 4-5 students), review GPT confidence scores

### Issue: Long processing time
**Symptom**: Takes >2 minutes for 50 students  
**Solution**: This is expected (5 batches × 10s + 4 delays × 2s ≈ 58s). With overlap, we analyze 38 unique + 12 overlap = 50 total images.

### Issue: Rate limiting errors
**Symptom**: "Rate limit exceeded" errors in logs  
**Solution**: Increase delay between batches (currently 2s), check Azure OpenAI quota

## References

- [Microsoft Learn: Vision Models](https://learn.microsoft.com/azure/ai-foundry/openai/concepts/gpt-with-vision)
- [Azure OpenAI Structured Outputs](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/structured-outputs)
- [GPT-5.2-chat Documentation](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/reasoning)

## Implementation File

All code is in: `backend/src/utils/gptPositionEstimation.ts`

Key functions:
- `estimateSeatingPositions()` - Entry point
- `processSingleBatch()` - Handles ≤10 images
- `processBatchedAnalysis()` - Handles >10 images with overlapping batches
- `alignBatchesUsingOverlap()` - Aligns batches using overlapping students as anchors
- `generateUserPrompt()` - Creates batch-aware prompts
- `callGPTAPI()` - API call with structured outputs
