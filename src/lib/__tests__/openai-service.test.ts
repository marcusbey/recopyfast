import { OpenAIService, aiService } from '../ai/openai-service'

// Mock OpenAI
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn()
        }
      }
    }))
  }
})

describe('OpenAIService', () => {
  let mockOpenAI: any
  let service: OpenAIService

  beforeEach(() => {
    jest.clearAllMocks()
    service = OpenAIService.getInstance()
    const OpenAI = require('openai').default
    mockOpenAI = new OpenAI()
  })

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = OpenAIService.getInstance()
      const instance2 = OpenAIService.getInstance()
      expect(instance1).toBe(instance2)
    })

    it('should export a singleton instance', () => {
      expect(aiService).toBeInstanceOf(OpenAIService)
    })
  })

  describe('translateText', () => {
    it('should successfully translate text', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Hola mundo' } }],
        usage: { total_tokens: 50 }
      }
      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

      const result = await service.translateText({
        text: 'Hello world',
        fromLanguage: 'English',
        toLanguage: 'Spanish'
      })

      expect(result.success).toBe(true)
      expect(result.data).toBe('Hola mundo')
      expect(result.tokensUsed).toBe(50)
    })

    it('should handle translation with context', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Translated text' } }],
        usage: { total_tokens: 60 }
      }
      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

      await service.translateText({
        text: 'Test text',
        fromLanguage: 'English',
        toLanguage: 'Spanish',
        context: 'website header'
      })

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0]
      expect(callArgs.messages[1].content).toContain('website header')
    })

    it('should handle translation errors', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('API Error'))

      const result = await service.translateText({
        text: 'Hello world',
        fromLanguage: 'English',
        toLanguage: 'Spanish'
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('API Error')
    })

    it('should handle empty translation response', async () => {
      const mockResponse = {
        choices: [{ message: { content: null } }],
        usage: { total_tokens: 10 }
      }
      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

      const result = await service.translateText({
        text: 'Hello world',
        fromLanguage: 'English',
        toLanguage: 'Spanish'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('No translation received')
    })
  })

  describe('generateContentSuggestion', () => {
    it('should generate content suggestions', async () => {
      const mockResponse = {
        choices: [{ message: { content: '1. Suggestion one\n2. Suggestion two\n3. Suggestion three' } }],
        usage: { total_tokens: 80 }
      }
      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

      const result = await service.generateContentSuggestion({
        originalText: 'Original text',
        context: 'marketing copy',
        tone: 'professional',
        goal: 'improve'
      })

      expect(result.success).toBe(true)
      expect(result.data).toEqual(['Suggestion one', 'Suggestion two', 'Suggestion three'])
      expect(result.tokensUsed).toBe(80)
    })

    it('should handle suggestions with different formatting', async () => {
      const mockResponse = {
        choices: [{ message: { content: '1. First\n\n2. Second\n\n3. Third\n\n' } }],
        usage: { total_tokens: 60 }
      }
      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

      const result = await service.generateContentSuggestion({
        originalText: 'Text',
        context: 'test'
      })

      expect(result.data).toEqual(['First', 'Second', 'Third'])
    })

    it('should handle content suggestion errors', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('Rate limit'))

      const result = await service.generateContentSuggestion({
        originalText: 'Text',
        context: 'test'
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Rate limit')
    })
  })

  describe('batchTranslate', () => {
    it('should translate multiple elements', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Translated' } }],
        usage: { total_tokens: 30 }
      }
      mockOpenAI.chat.completions.create
        .mockResolvedValueOnce(mockResponse)
        .mockResolvedValueOnce(mockResponse)

      const elements = [
        { id: '1', text: 'Hello' },
        { id: '2', text: 'World' }
      ]

      const result = await service.batchTranslate(elements, 'English', 'Spanish')

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(result.data?.[0]).toEqual({
        id: '1',
        originalText: 'Hello',
        translatedText: 'Translated',
        success: true
      })
    })

    it('should handle partial failures in batch translation', async () => {
      mockOpenAI.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Success' } }],
          usage: { total_tokens: 20 }
        })
        .mockRejectedValueOnce(new Error('Failed'))

      const elements = [
        { id: '1', text: 'Hello' },
        { id: '2', text: 'World' }
      ]

      const result = await service.batchTranslate(elements, 'English', 'Spanish')

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1) // Only successful translation
    })
  })

  describe('detectLanguage', () => {
    it('should detect language correctly', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'es' } }],
        usage: { total_tokens: 5 }
      }
      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

      const result = await service.detectLanguage('Hola mundo')

      expect(result.success).toBe(true)
      expect(result.data).toBe('es')
    })

    it('should handle language detection errors', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('Detection failed'))

      const result = await service.detectLanguage('Text')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Detection failed')
    })
  })

  describe('prompt building', () => {
    it('should build translation prompt correctly', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Translated' } }],
        usage: { total_tokens: 30 }
      }
      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

      await service.translateText({
        text: 'Test text',
        fromLanguage: 'English',
        toLanguage: 'Spanish',
        context: 'navigation menu'
      })

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0]
      const userMessage = callArgs.messages[1].content

      expect(userMessage).toContain('Test text')
      expect(userMessage).toContain('English')
      expect(userMessage).toContain('Spanish')
      expect(userMessage).toContain('navigation menu')
    })

    it('should build content suggestion prompt correctly', async () => {
      const mockResponse = {
        choices: [{ message: { content: '1. Test' } }],
        usage: { total_tokens: 30 }
      }
      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

      await service.generateContentSuggestion({
        originalText: 'Original',
        context: 'button text',
        tone: 'casual',
        goal: 'shorten'
      })

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0]
      const userMessage = callArgs.messages[1].content

      expect(userMessage).toContain('Original')
      expect(userMessage).toContain('button text')
      expect(userMessage).toContain('casual')
      expect(userMessage).toContain('shorten')
    })
  })
})