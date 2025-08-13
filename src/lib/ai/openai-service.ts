import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface TranslationRequest {
  text: string;
  fromLanguage: string;
  toLanguage: string;
  context?: string;
}

export interface ContentSuggestionRequest {
  originalText: string;
  context: string;
  tone?: 'professional' | 'casual' | 'marketing' | 'technical';
  goal?: 'improve' | 'shorten' | 'expand' | 'optimize';
}

export interface AIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  tokensUsed?: number;
}

export class OpenAIService {
  private static instance: OpenAIService;

  static getInstance(): OpenAIService {
    if (!OpenAIService.instance) {
      OpenAIService.instance = new OpenAIService();
    }
    return OpenAIService.instance;
  }

  /**
   * Translate text to a target language
   */
  async translateText(request: TranslationRequest): Promise<AIResponse<string>> {
    try {
      const prompt = this.buildTranslationPrompt(request);
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a professional translator. Translate the given text accurately while maintaining the original tone, style, and intent. Return only the translated text without any additional formatting or explanations.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      const translatedText = completion.choices[0]?.message?.content?.trim();
      
      if (!translatedText) {
        throw new Error('No translation received from OpenAI');
      }

      return {
        success: true,
        data: translatedText,
        tokensUsed: completion.usage?.total_tokens,
      };
    } catch (error) {
      console.error('Translation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Translation failed',
      };
    }
  }

  /**
   * Generate content suggestions for improvement
   */
  async generateContentSuggestion(request: ContentSuggestionRequest): Promise<AIResponse<string[]>> {
    try {
      const prompt = this.buildContentSuggestionPrompt(request);
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a professional copywriter and content strategist. Generate 3 different variations of the given text based on the specified goal and tone. Return each suggestion on a new line, numbered 1-3.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 800,
      });

      const suggestions = completion.choices[0]?.message?.content?.trim();
      
      if (!suggestions) {
        throw new Error('No suggestions received from OpenAI');
      }

      // Parse numbered suggestions
      const suggestionList = suggestions
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.replace(/^\d+\.\s*/, '').trim())
        .filter(suggestion => suggestion.length > 0);

      return {
        success: true,
        data: suggestionList,
        tokensUsed: completion.usage?.total_tokens,
      };
    } catch (error) {
      console.error('Content suggestion error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Content suggestion failed',
      };
    }
  }

  /**
   * Batch translate multiple content elements
   */
  async batchTranslate(
    elements: { id: string; text: string }[],
    fromLanguage: string,
    toLanguage: string,
    context?: string
  ): Promise<AIResponse<{ id: string; originalText: string; translatedText: string }[]>> {
    try {
      const translations = await Promise.all(
        elements.map(async (element) => {
          const result = await this.translateText({
            text: element.text,
            fromLanguage,
            toLanguage,
            context,
          });

          return {
            id: element.id,
            originalText: element.text,
            translatedText: result.success ? result.data! : element.text,
            success: result.success,
            tokensUsed: result.tokensUsed || 0,
          };
        })
      );

      const successfulTranslations = translations.filter(t => t.success);
      const totalTokens = translations.reduce((sum, t) => sum + t.tokensUsed, 0);

      return {
        success: true,
        data: successfulTranslations,
        tokensUsed: totalTokens,
      };
    } catch (error) {
      console.error('Batch translation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Batch translation failed',
      };
    }
  }

  /**
   * Detect language of text
   */
  async detectLanguage(text: string): Promise<AIResponse<string>> {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Detect the language of the given text. Return only the language code (e.g., "en", "es", "fr", "de", etc.) without any additional text.'
          },
          {
            role: 'user',
            content: `Detect the language of this text: "${text}"`
          }
        ],
        temperature: 0.1,
        max_tokens: 10,
      });

      const languageCode = completion.choices[0]?.message?.content?.trim().toLowerCase();
      
      if (!languageCode) {
        throw new Error('No language detection received from OpenAI');
      }

      return {
        success: true,
        data: languageCode,
        tokensUsed: completion.usage?.total_tokens,
      };
    } catch (error) {
      console.error('Language detection error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Language detection failed',
      };
    }
  }

  private buildTranslationPrompt(request: TranslationRequest): string {
    const contextNote = request.context ? `\n\nContext: This text is from ${request.context}` : '';
    
    return `Translate the following text from ${request.fromLanguage} to ${request.toLanguage}:

"${request.text}"${contextNote}

Requirements:
- Maintain the original tone and style
- Keep the same level of formality
- Preserve any technical terms appropriately
- Return only the translated text`;
  }

  private buildContentSuggestionPrompt(request: ContentSuggestionRequest): string {
    const toneNote = request.tone ? `Tone: ${request.tone}` : '';
    const goalNote = request.goal ? `Goal: ${request.goal} the text` : '';
    
    return `Original text: "${request.originalText}"

Context: ${request.context}
${toneNote}
${goalNote}

Generate 3 different variations of this text that:
- Maintain the core message
- ${request.goal === 'improve' ? 'Improve clarity and impact' : ''}
- ${request.goal === 'shorten' ? 'Make it more concise' : ''}
- ${request.goal === 'expand' ? 'Provide more detail and explanation' : ''}
- ${request.goal === 'optimize' ? 'Optimize for engagement and conversion' : ''}
- Match the ${request.tone || 'original'} tone

Return 3 numbered suggestions:`;
  }
}

export const aiService = OpenAIService.getInstance();