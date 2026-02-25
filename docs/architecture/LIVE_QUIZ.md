# Live Quiz - AI-Powered Attention Tracking

Interactive quiz system using AI to analyze lecture slides in real-time and quiz students automatically.

---

## Quick Start (Teachers)

### 3-Step Setup

1. **Start Screen Share** → Click "🖥️ Start Screen Share" button
2. **Set Frequency** → Choose capture interval (15s - 5min)
3. **AI Takes Over** → System automatically captures, analyzes, generates questions, and sends to students

That's it! The system runs automatically while you teach.

---

## Overview

Teachers share their screen during a session. The system continuously captures screenshots at configurable intervals, analyzes content with AI, generates relevant questions, and automatically sends them to students. This creates a seamless, attention-tracking quiz experience without interrupting the lecture flow.

---

## Features

### For Teachers
- 🖥️ One-click screen sharing
- ⏱️ Configurable capture frequency (15s - 5min)
- 🤖 Fully automated AI workflow
- 📊 Real-time statistics dashboard
- 🎯 Zero manual intervention needed
- 📈 Continuous engagement tracking

### For Students
- 🔔 Real-time question notifications
- 🖼️ Slide context shown with question
- ⏰ Countdown timer
- ✅ Immediate feedback
- 📈 Personal engagement score

---

## How It Works

### Automated Teacher Flow

1. **Start Session** - Open session dashboard
2. **Click "Start Screen Share"** - Browser requests screen permission
3. **Select Screen** - Choose which screen/window to share
4. **Set Frequency** - Choose how often to capture (default: 30s)
5. **System Runs Automatically**:
   - Captures screenshot every N seconds
   - AI analyzes slide content (2-3s)
   - AI generates 1 question per capture
   - AI selects student fairly
   - Question sent automatically via SignalR
6. **Monitor Stats** - View captures, questions, and sends in real-time
7. **Stop When Done** - Click "Stop Screen Share"

### Student Flow (Same as Before)

1. **In Session** - Viewing session dashboard
2. **Receive Question** - Pop-up notification
3. **Read Question** - See slide context
4. **Answer** - Type answer or select option
5. **Submit** - Before timer expires
6. **See Result** - Immediate feedback with score
7. **View Stats** - Personal engagement score

---

## Capture Frequency Options

**Available Intervals**:
- **15 seconds** - High frequency (4 questions/minute)
- **30 seconds** - Balanced (2 questions/minute) ⭐ Recommended
- **60 seconds** - Moderate (1 question/minute)
- **2 minutes** - Low frequency (0.5 questions/minute)
- **5 minutes** - Very low (0.2 questions/minute)

**Recommendations**:
- **Fast-paced lecture**: 30-60 seconds
- **Detailed explanations**: 2-5 minutes
- **Code demonstrations**: 60-120 seconds
- **Theory-heavy content**: 30-60 seconds

---

## Fair Question Distribution

**How Questions Are Sent**:
- ✅ Questions sent to ALL present students simultaneously
- ✅ Every student gets every question
- ✅ Real-time delivery via SignalR (or 5-second polling fallback)
- ✅ Each student has their own response record

**Benefits**:
- Maximum engagement - no one is left out
- Fair opportunity for all students to participate
- Better assessment of class understanding
- No complex selection algorithm needed

**Example**:
```
Session with 30 students, 10 questions:
- All 30 students receive all 10 questions
- Each student can answer at their own pace
- Teacher sees aggregate results
```

---

## Engagement Scoring

**Score Calculation** (0-100):
- **Accuracy**: 50% weight (correct answers)
- **Speed**: 30% weight (response time)
- **Participation**: 20% weight (questions answered)

**Score Ranges**:
- 80-100: Highly engaged
- 60-79: Engaged
- 40-59: Moderately engaged
- 0-39: Low engagement

---

## Setup (Azure OpenAI Required)

### Prerequisites

1. Azure OpenAI Service
2. Azure Blob Storage (already configured)
3. Azure SignalR Service (already configured)
4. Azure Table Storage (already configured)

### Azure OpenAI Configuration

**Required Models**:
1. **GPT-4o** - Question generation and answer evaluation
2. **GPT-4o Vision** - Slide analysis

**Environment Variables**:
```bash
AZURE_OPENAI_ENDPOINT=https://your-openai.openai.azure.com/
AZURE_OPENAI_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_VISION_DEPLOYMENT=gpt-4o-vision
```

### Quick Setup

```bash
# Create Azure OpenAI resource
az cognitiveservices account create \
  --name qr-attendance-openai \
  --resource-group rg-qr-attendance-prod \
  --kind OpenAI \
  --sku S0 \
  --location eastus

# Deploy GPT-4o
az cognitiveservices account deployment create \
  --name qr-attendance-openai \
  --resource-group rg-qr-attendance-prod \
  --deployment-name gpt-4o \
  --model-name gpt-4o \
  --model-version "2024-08-06" \
  --sku-capacity 10

# Deploy GPT-4o Vision
az cognitiveservices account deployment create \
  --name qr-attendance-openai \
  --resource-group rg-qr-attendance-prod \
  --deployment-name gpt-4o-vision \
  --model-name gpt-4o \
  --model-version "2024-08-06" \
  --sku-capacity 10

# Get credentials
az cognitiveservices account show \
  --name qr-attendance-openai \
  --resource-group rg-qr-attendance-prod \
  --query "properties.endpoint" -o tsv

az cognitiveservices account keys list \
  --name qr-attendance-openai \
  --resource-group rg-qr-attendance-prod \
  --query "key1" -o tsv
```

---

## Technical Architecture

### Backend Functions

**New Functions** (5):
1. `analyzeSlide.ts` - Azure OpenAI Vision API integration
2. `generateQuestions.ts` - Question generation logic
3. `sendQuizQuestion.ts` - Send question to all present students
4. `getStudentQuestions.ts` - Get pending questions (polling endpoint)
5. `submitQuizAnswer.ts` - Process and evaluate answer

### Database Tables

**QuizQuestions**:
```
PartitionKey: sessionId
RowKey: questionId
Fields: slideImageUrl, slideContent, question, questionType,
        options, correctAnswer, difficulty, timeLimit, createdAt
```

**QuizResponses**:
```
PartitionKey: sessionId
RowKey: responseId
Fields: questionId, studentId, answer, isCorrect, responseTime,
        submittedAt, aiEvaluation, score
```

**QuizMetrics**:
```
PartitionKey: sessionId
RowKey: studentId
Fields: totalQuestions, correctAnswers, averageResponseTime,
        engagementScore, lastAskedAt
```

### Real-time Updates

**SignalR Events**:
- `quizQuestion` - Question sent to student
- `quizResult` - Answer evaluation result

**Polling Fallback**:
- Quiz polling: 5 seconds (when SignalR unavailable)
- Status polling: 15 seconds
- Automatic detection of SignalR availability

---

## API Endpoints

### Teacher Endpoints

```bash
# Analyze slide
POST /api/sessions/{sessionId}/quiz/analyze-slide
Body: { image: "base64..." } or { imageUrl: "https://..." }
Response: { slideId, imageUrl, analysis: { topic, title, keyPoints, ... } }

# Generate questions
POST /api/sessions/{sessionId}/quiz/generate-questions
Body: { slideId, analysis, difficulty, count }
Response: { questions: [{ questionId, text, type, difficulty, options, ... }] }

# Send question to all present students
POST /api/sessions/{sessionId}/quiz/send-question
Body: { questionId, timeLimit }
Response: { responseIds: [...], students: [...], sentAt, expiresAt }

# Get pending questions for student (polling endpoint)
GET /api/sessions/{sessionId}/student-questions
Response: { questions: [{ questionId, responseId, question, options, ... }] }
```

### Student Endpoints

```bash
# Submit answer
POST /api/sessions/{sessionId}/quiz/submit-answer
Body: { responseId, answer }
Response: { isCorrect, score, feedback, correctAnswer }
```

---

## Usage Tips

### Best Practices

**For Teachers**:
- Use clear, readable slides
- Ask 1-2 questions per 10 minutes
- Mix difficulty levels
- Review engagement metrics regularly
- Provide encouragement for all answers

**For Students**:
- Stay attentive during lecture
- Read questions carefully
- Answer within time limit
- Learn from feedback

### Question Types

**Multiple Choice**:
- Best for factual recall
- Quick to answer
- Easy to evaluate

**Short Answer**:
- Tests understanding
- Requires critical thinking
- AI evaluates quality

---

## Troubleshooting

### AI Not Generating Questions

**Check**:
1. Azure OpenAI endpoint configured
2. API key is valid
3. Models deployed (gpt-4o, gpt-4o-vision)
4. Slide image is clear and readable

### Student Not Receiving Question

**Check**:
1. Student is in active session
2. SignalR connection established
3. Student browser tab is active
4. No network issues

### Answer Evaluation Issues

**Check**:
1. GPT-4o deployment is active
2. API quota not exceeded
3. Answer format is correct
4. Network connectivity

---

## Monitoring

### Check Azure OpenAI Usage

```bash
# View deployments
az cognitiveservices account deployment list \
  --name qr-attendance-openai \
  --resource-group rg-qr-attendance-prod

# Check quota
az cognitiveservices account show \
  --name qr-attendance-openai \
  --resource-group rg-qr-attendance-prod \
  --query "properties.quotaLimit"
```

### View Metrics

```bash
# Get quiz metrics for session
curl https://your-function-app.azurewebsites.net/api/getQuizMetrics?sessionId={id}

# View engagement scores
# Check QuizMetrics table in Azure Storage Explorer
```

---

## Cost Estimation

### Azure OpenAI Costs

**Per Question** (approximate):
- Slide analysis (Vision): $0.01
- Question generation: $0.005
- Answer evaluation: $0.005
- **Total**: ~$0.02 per question

**Monthly** (example):
- 10 sessions/week
- 10 questions/session
- 4 weeks/month
- **Total**: ~$8/month

---

## Related Documentation

- **DEPLOYMENT.md** - Deploy live quiz feature
- **DATABASE_TABLES.md** - Database schema
- **AZURE_ENVIRONMENT.md** - Azure resources
- **DEV_TOOLS.md** - Development commands

---

## Quick Reference

```bash
# Test slide analysis
curl -X POST http://localhost:7071/api/sessions/test-session/quiz/analyze-slide \
  -H "Content-Type: application/json" \
  -d '{"image":"data:image/jpeg;base64,..."}'

# Test question generation
curl -X POST http://localhost:7071/api/sessions/test-session/quiz/generate-questions \
  -H "Content-Type: application/json" \
  -d '{"slideId":"slide-123","analysis":{...},"difficulty":"MEDIUM","count":3}'

# Test send question
curl -X POST http://localhost:7071/api/sessions/test-session/quiz/send-question \
  -H "Content-Type: application/json" \
  -d '{"questionId":"q-123","timeLimit":60}'
```

---

**Ready to engage your students!** 🚀
