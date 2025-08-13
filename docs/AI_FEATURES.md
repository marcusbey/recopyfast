# AI-Powered Features in ReCopyFast

ReCopyFast now includes powerful AI capabilities powered by OpenAI to enhance content management with intelligent suggestions and automatic translations.

## 🤖 Features Overview

### 1. **AI Content Suggestions**
- Get intelligent content improvements with one click
- Multiple suggestion goals: improve, shorten, expand, optimize
- Different tone options: professional, casual, marketing, technical
- Available directly in the content editor modal

### 2. **Bulk Translation**
- Translate entire websites to different languages
- Support for 12+ major languages
- Batch processing for efficiency
- Automatic language detection
- Preserve original formatting and context

## 🎯 AI Content Suggestions

### How It Works
1. **Edit any content** on your website using ReCopyFast
2. **Click the "🪄 AI Suggest" button** in the editor modal
3. **Choose your goal** and **generate suggestions**
4. **Select the best suggestion** or use it as inspiration

### Suggestion Goals
- **Improve**: Enhance clarity and impact
- **Shorten**: Make content more concise
- **Expand**: Add more detail and explanation
- **Optimize**: Boost engagement and conversion

### Tone Options
- **Professional**: Formal, business-appropriate language
- **Casual**: Friendly, conversational tone
- **Marketing**: Persuasive, action-oriented copy
- **Technical**: Precise, expert-level language

### API Endpoint
```
POST /api/ai/suggest
{
  "text": "Original content",
  "context": "website content",
  "tone": "professional",
  "goal": "improve"
}
```

## 🌍 Bulk Translation

### How It Works
1. **Access the Translation Dashboard** in your ReCopyFast dashboard
2. **Select source and target languages**
3. **Choose which content elements to translate**
4. **Click "Translate with AI"** to process all selected content
5. **Review and publish** the translations

### Supported Languages
- 🇺🇸 English (en)
- 🇪🇸 Spanish (es)
- 🇫🇷 French (fr)
- 🇩🇪 German (de)
- 🇮🇹 Italian (it)
- 🇵🇹 Portuguese (pt)
- 🇯🇵 Japanese (ja)
- 🇰🇷 Korean (ko)
- 🇨🇳 Chinese (zh)
- 🇸🇦 Arabic (ar)
- 🇮🇳 Hindi (hi)
- 🇷🇺 Russian (ru)

### API Endpoint
```
POST /api/ai/translate
{
  "siteId": "site-123",
  "fromLanguage": "en",
  "toLanguage": "es",
  "elements": [
    { "id": "element-1", "text": "Hello world" },
    { "id": "element-2", "text": "Welcome to our site" }
  ],
  "context": "website content"
}
```

## ⚙️ Setup Instructions

### 1. Get OpenAI API Key
1. Sign up at [OpenAI Platform](https://platform.openai.com)
2. Generate an API key in your dashboard
3. Add billing information (required for GPT-4)

### 2. Configure Environment Variables
Add to your `.env.local` file:
```bash
OPENAI_API_KEY=sk-your-actual-openai-api-key
```

### 3. Enable Features
Once the API key is configured, AI features will automatically be available:
- AI suggestion button appears in content editor modals
- Translation dashboard becomes accessible
- API endpoints become functional

## 💡 Usage Examples

### Content Improvement Example
**Original**: "Our product is good"
**AI Suggestions**:
1. "Our innovative solution delivers exceptional results"
2. "Experience the superior quality of our product"
3. "Discover why customers choose our outstanding product"

### Translation Example
**English**: "Welcome to our amazing platform"
**Spanish**: "Bienvenido a nuestra increíble plataforma"
**French**: "Bienvenue sur notre plateforme incroyable"

## 🔧 Technical Implementation

### AI Service Architecture
```
Client Request → API Route → OpenAI Service → OpenAI API → Response
```

### Key Components
- **OpenAI Service** (`src/lib/ai/openai-service.ts`)
- **Translation API** (`src/app/api/ai/translate/route.ts`)
- **Suggestion API** (`src/app/api/ai/suggest/route.ts`)
- **Translation Dashboard** (`src/components/dashboard/TranslationDashboard.tsx`)
- **Enhanced Embed Script** (`public/embed/recopyfast.js`)

### Error Handling
- Graceful fallbacks for API failures
- User-friendly error messages
- Retry mechanisms for transient failures
- Token usage tracking

## 📊 Cost Management

### Token Usage
- **Content Suggestions**: ~100-500 tokens per request
- **Translation**: ~50-200 tokens per text element
- **Language Detection**: ~10-20 tokens per request

### Optimization Strategies
- Batch processing for translations
- Caching for repeated content
- Smart truncation for long texts
- Rate limiting to prevent abuse

### Cost Estimation
**Typical Usage (per month)**:
- Small site (100 edits): ~$2-5
- Medium site (1000 edits): ~$10-25
- Large site (10000 edits): ~$50-100

## 🛡️ Security & Privacy

### Data Handling
- Content is sent to OpenAI for processing
- No long-term storage of user content by OpenAI
- Requests are encrypted in transit
- No sensitive data should be processed

### Best Practices
- Review AI suggestions before publishing
- Don't process sensitive/confidential content
- Monitor API usage and costs
- Set up usage alerts in OpenAI dashboard

### Compliance
- OpenAI is GDPR compliant for EU users
- Content processing follows OpenAI's data policies
- Option to disable AI features for sensitive sites

## 🔄 Real-time Integration

### Embed Script Integration
The AI suggestions are seamlessly integrated into the existing content editor:

```javascript
// AI suggestion button automatically appears
// When user clicks text element:
// 1. Editor modal opens
// 2. "🪄 AI Suggest" button is available
// 3. User can generate and apply suggestions
// 4. Changes sync in real-time via WebSocket
```

### Dashboard Integration
Translation features are accessible via the dashboard:
```typescript
// Translation Dashboard Component
<TranslationDashboard 
  siteId="site-123"
  contentElements={elements}
/>
```

## 🚀 Future Enhancements

### Planned Features
- **AI-powered A/B testing**: Generate multiple variations automatically
- **Content optimization**: Analyze performance and suggest improvements
- **Voice and tone consistency**: Maintain brand voice across content
- **SEO optimization**: AI suggestions for better search rankings
- **Content templates**: Pre-trained models for specific industries

### Advanced Integrations
- **Custom AI models**: Fine-tuned for specific brands/industries
- **Multi-modal content**: Image and video content suggestions
- **Content workflows**: Approval processes for AI-generated content
- **Analytics integration**: Track performance of AI-suggested content

## 📚 API Reference

### POST /api/ai/suggest
Generate content suggestions for improvement.

**Request Body**:
```typescript
{
  text: string;           // Original content
  context: string;        // Context (e.g., "website content")
  tone?: string;          // "professional" | "casual" | "marketing" | "technical"
  goal?: string;          // "improve" | "shorten" | "expand" | "optimize"
}
```

**Response**:
```typescript
{
  success: boolean;
  suggestions: string[];  // Array of AI-generated suggestions
  tokensUsed: number;     // Number of tokens consumed
  originalText: string;   // Original text for reference
}
```

### POST /api/ai/translate
Translate multiple content elements to a target language.

**Request Body**:
```typescript
{
  siteId: string;
  fromLanguage: string;   // Source language code
  toLanguage: string;     // Target language code
  elements: Array<{       // Content elements to translate
    id: string;
    text: string;
  }>;
  context?: string;       // Additional context
}
```

**Response**:
```typescript
{
  success: boolean;
  translations: Array<{
    id: string;
    originalText: string;
    translatedText: string;
  }>;
  tokensUsed: number;
  message: string;
}
```

## 💎 Best Practices

### Content Suggestions
1. **Review before applying**: AI suggestions are starting points, not final content
2. **Maintain brand voice**: Ensure suggestions align with your brand
3. **Test performance**: A/B test AI suggestions vs original content
4. **Provide context**: Better context leads to better suggestions

### Translations
1. **Review translations**: AI translations may need cultural adjustments
2. **Consider context**: Website content vs marketing copy may need different approaches
3. **Test with native speakers**: Validate important translations
4. **Update regularly**: Re-translate content when original text changes significantly

This AI integration transforms ReCopyFast from a simple content editor into an intelligent content management system that helps users create better, more engaging content across multiple languages.