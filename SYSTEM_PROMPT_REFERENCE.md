# System Prompt Quick Reference

## 📍 Where to Find the System Prompt

### File: `backend/src/functions/generateQuestions.ts`
### Lines: ~62-90

```typescript
const agentInstructions = `You are a university professor creating quiz questions to test student attention and understanding.

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

ONLY create MULTIPLE CHOICE questions with 4 options and 1 correct answer.

ALWAYS respond with valid JSON in this exact format (no markdown, no code blocks):
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
}`;
```

## 🔧 How It's Used

### Step 1: System Prompt Defined
```typescript
// In generateQuestions.ts
const agentInstructions = `You are a professor...`;  // ← System prompt here
```

### Step 2: Passed to Agent Service
```typescript
// In generateQuestions.ts
const agentResponse = await agentClient.runSingleInteraction({
  agentName: 'QuizQuestionGenerator',
  instructions: agentInstructions,  // ← System prompt passed here
  userMessage: userMessage
});
```

### Step 3: Agent Created with Instructions
```typescript
// In agentService.ts - createAgent()
const agentData = {
  name: config.name,
  instructions: config.instructions,  // ← System prompt stored in agent
  model: model,
  tools: []
};

// Sent to Azure
POST /agents
Body: agentData  // ← Contains system prompt
```

## 🎯 Key Terminology

| Term | Meaning | Where Used |
|------|---------|------------|
| **System Prompt** | Instructions that define agent behavior | OpenAI terminology |
| **Instructions** | Same as system prompt | Azure AI Foundry terminology |
| **agentInstructions** | Variable name in our code | generateQuestions.ts |
| **config.instructions** | Parameter name | agentService.ts |

## 📝 How to Modify the System Prompt

### Option 1: Direct Edit (Simple)
Edit the `agentInstructions` variable in `generateQuestions.ts`:

```typescript
const agentInstructions = `Your new system prompt here...`;
```

### Option 2: Dynamic Prompt (Advanced)
Make the prompt dynamic based on context:

```typescript
const agentInstructions = `You are a ${analysis.topic} expert creating quiz questions.

Difficulty Level: ${difficultyFilter}
Question Count: ${count}

Create questions that:
- Match the ${difficultyFilter} difficulty level
- Focus on ${analysis.topic}
- Test understanding of: ${analysis.keyPoints?.join(', ')}

Format: JSON with questions array...`;
```

### Option 3: Template-Based (Flexible)
Create prompt templates:

```typescript
const promptTemplates = {
  easy: `You are a friendly tutor creating simple quiz questions...`,
  medium: `You are a university professor creating standard quiz questions...`,
  hard: `You are an expert examiner creating challenging quiz questions...`
};

const agentInstructions = promptTemplates[difficultyFilter.toLowerCase()] || promptTemplates.medium;
```

## 🔍 Debugging the System Prompt

### Log the Prompt
```typescript
context.log('Agent Instructions:', agentInstructions);

const agentResponse = await agentClient.runSingleInteraction({
  agentName: 'QuizQuestionGenerator',
  instructions: agentInstructions,
  userMessage: userMessage
});
```

### Test Different Prompts
```typescript
// Test prompt variations
const testPrompts = [
  `You are a strict professor...`,
  `You are a friendly tutor...`,
  `You are an AI assistant...`
];

for (const prompt of testPrompts) {
  const response = await agentClient.runSingleInteraction({
    agentName: 'QuizQuestionGenerator',
    instructions: prompt,
    userMessage: userMessage
  });
  context.log('Response with prompt:', prompt, response);
}
```

## 📊 System Prompt Best Practices

### 1. Be Specific
❌ Bad: `Generate questions`
✅ Good: `Generate 3 multiple-choice questions with 4 options each`

### 2. Define Output Format
❌ Bad: `Return questions`
✅ Good: `Return JSON: {"questions": [{"text": "...", "options": [...]}]}`

### 3. Set Constraints
❌ Bad: `Create questions`
✅ Good: `Create questions (max 15 words each, 8 words per option)`

### 4. Provide Examples
```typescript
const agentInstructions = `You are a professor creating quiz questions.

Example question:
{
  "text": "What is a Promise in JavaScript?",
  "type": "MULTIPLE_CHOICE",
  "options": ["Async pattern", "Sync function", "Variable type", "Loop structure"],
  "correctAnswer": "Async pattern"
}

Now create similar questions...`;
```

## 🎨 System Prompt Examples

### Example 1: Strict Academic
```typescript
const agentInstructions = `You are a strict university professor.

Requirements:
- Questions must test deep understanding
- No trivial or obvious questions
- Include edge cases and corner cases
- Explanations must cite concepts

Format: JSON with questions array`;
```

### Example 2: Friendly Tutor
```typescript
const agentInstructions = `You are a friendly tutor helping students learn.

Requirements:
- Questions should be encouraging
- Include helpful hints in explanations
- Use simple, clear language
- Focus on core concepts

Format: JSON with questions array`;
```

### Example 3: Adaptive Difficulty
```typescript
const agentInstructions = `You are an adaptive learning system.

Difficulty: ${difficultyFilter}
- EASY: Basic recall, simple concepts
- MEDIUM: Application, understanding
- HARD: Analysis, synthesis, evaluation

Adjust question complexity accordingly.

Format: JSON with questions array`;
```

## 🔄 System Prompt vs User Message

### System Prompt (Instructions)
- **Purpose**: Define agent's role and behavior
- **When**: Set once when creating agent
- **Content**: General instructions, format, constraints
- **Example**: "You are a professor creating quiz questions..."

### User Message
- **Purpose**: Provide specific task/input
- **When**: Sent with each request
- **Content**: Specific data, context, request
- **Example**: "Generate 3 questions about JavaScript Promises..."

### Combined Effect
```
System Prompt: "You are a professor..."
     +
User Message: "Generate 3 questions about Promises..."
     =
Agent Response: [3 well-formatted quiz questions about Promises]
```

## 📚 Related Files

1. **System Prompt Definition**: `backend/src/functions/generateQuestions.ts` (line ~62)
2. **Agent Service**: `backend/src/utils/agentService.ts`
3. **Complete Flow**: `AGENT_SYSTEM_PROMPT_FLOW.md`
4. **Architecture**: `AGENT_ARCHITECTURE.md`

## 🚀 Quick Test

Test your system prompt changes:

```bash
# 1. Update the prompt in generateQuestions.ts
# 2. Build
cd backend
npm run build

# 3. Test locally
npm start

# 4. Call the endpoint
curl -X POST http://localhost:7071/api/sessions/test/quiz/generate-questions \
  -H "Content-Type: application/json" \
  -d '{
    "analysis": {
      "topic": "JavaScript",
      "summary": "Test"
    },
    "count": 1
  }'
```

## 💡 Pro Tips

1. **Keep it concise**: Shorter prompts often work better
2. **Be explicit**: Specify exactly what you want
3. **Test variations**: Try different phrasings
4. **Use examples**: Show the format you want
5. **Set constraints**: Define limits and rules
6. **Version control**: Track prompt changes in git

## ❓ Common Questions

**Q: Can I use different prompts for different difficulty levels?**
A: Yes! Use conditional logic:
```typescript
const agentInstructions = difficultyFilter === 'HARD' 
  ? `You are a strict examiner...`
  : `You are a friendly tutor...`;
```

**Q: Can I include variables in the prompt?**
A: Yes! Use template literals:
```typescript
const agentInstructions = `You are teaching ${analysis.topic}...`;
```

**Q: How long can the system prompt be?**
A: Typically up to ~4000 tokens, but shorter is better for performance.

**Q: Can I change the prompt without redeploying?**
A: Not directly, but you could store prompts in configuration/database and load them dynamically.

---

**Remember**: The system prompt (instructions) is the key to controlling agent behavior!
