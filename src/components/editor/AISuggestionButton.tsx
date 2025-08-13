'use client';

import { useState } from 'react';
import { Wand2, Loader2, RefreshCw, Copy, Check } from 'lucide-react';

interface AISuggestion {
  text: string;
  selected: boolean;
}

interface AISuggestionButtonProps {
  currentText: string;
  context?: string;
  onSuggestionSelect: (text: string) => void;
}

const SUGGESTION_GOALS = [
  { value: 'improve', label: 'Improve', description: 'Enhance clarity and impact' },
  { value: 'shorten', label: 'Shorten', description: 'Make more concise' },
  { value: 'expand', label: 'Expand', description: 'Add more detail' },
  { value: 'optimize', label: 'Optimize', description: 'Boost engagement' },
];

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'technical', label: 'Technical' },
];

export default function AISuggestionButton({ 
  currentText, 
  context = 'website content',
  onSuggestionSelect 
}: AISuggestionButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [selectedGoal, setSelectedGoal] = useState('improve');
  const [selectedTone, setSelectedTone] = useState('professional');
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleGenerateSuggestions = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: currentText,
          context,
          tone: selectedTone,
          goal: selectedGoal,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate suggestions');
      }

      setSuggestions(
        data.suggestions.map((text: string) => ({
          text,
          selected: false,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate suggestions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopySuggestion = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleUseSuggestion = (text: string) => {
    onSuggestionSelect(text);
    setIsOpen(false);
    setSuggestions([]);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 transition-colors"
        title="Get AI suggestions"
      >
        <Wand2 className="h-4 w-4" />
        AI Suggest
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-purple-600" />
            <h3 className="text-lg font-semibold">AI Content Suggestions</h3>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {/* Original Text */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Original Text
            </label>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
              <p className="text-sm text-gray-900">{currentText}</p>
            </div>
          </div>

          {/* Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Goal
              </label>
              <select
                value={selectedGoal}
                onChange={(e) => setSelectedGoal(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {SUGGESTION_GOALS.map(goal => (
                  <option key={goal.value} value={goal.value}>
                    {goal.label} - {goal.description}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tone
              </label>
              <select
                value={selectedTone}
                onChange={(e) => setSelectedTone(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {TONE_OPTIONS.map(tone => (
                  <option key={tone.value} value={tone.value}>
                    {tone.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Generate Button */}
          <div className="mb-6">
            <button
              onClick={handleGenerateSuggestions}
              disabled={isLoading}
              className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {isLoading ? 'Generating...' : 'Generate AI Suggestions'}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-gray-700">Suggestions</h4>
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  className="border border-gray-200 rounded-md p-4 hover:border-purple-300 transition-colors"
                >
                  <p className="text-sm text-gray-900 mb-3">{suggestion.text}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleUseSuggestion(suggestion.text)}
                      className="text-xs bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700"
                    >
                      Use This
                    </button>
                    <button
                      onClick={() => handleCopySuggestion(suggestion.text, index)}
                      className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800"
                    >
                      {copiedIndex === index ? (
                        <>
                          <Check className="h-3 w-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty State */}
          {!isLoading && suggestions.length === 0 && !error && (
            <div className="text-center py-8">
              <Wand2 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">
                Click "Generate AI Suggestions" to get improved versions of your content
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}