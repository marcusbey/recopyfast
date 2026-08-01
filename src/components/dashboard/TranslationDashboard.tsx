"use client";

import { useState } from "react";
import { Globe, Loader2, CheckCircle, AlertCircle, Wand2 } from "lucide-react";

interface ContentElement {
  id: string;
  element_id: string;
  current_content: string;
  selector: string;
}

interface TranslationResult {
  id: string;
  originalText: string;
  translatedText: string;
}

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
];

interface TranslationDashboardProps {
  siteId: string;
  contentElements: ContentElement[];
}

export default function TranslationDashboard({
  siteId,
  contentElements,
}: TranslationDashboardProps) {
  const [isTranslating, setIsTranslating] = useState(false);
  const [fromLanguage, setFromLanguage] = useState("en");
  const [toLanguage, setToLanguage] = useState("es");
  const [selectedElements, setSelectedElements] = useState<string[]>([]);
  const [translationResults, setTranslationResults] = useState<
    TranslationResult[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSelectAll = () => {
    if (selectedElements.length === contentElements.length) {
      setSelectedElements([]);
    } else {
      setSelectedElements(contentElements.map((el) => el.element_id));
    }
  };

  const handleElementToggle = (elementId: string) => {
    setSelectedElements((prev) =>
      prev.includes(elementId)
        ? prev.filter((id) => id !== elementId)
        : [...prev, elementId],
    );
  };

  const handleTranslate = async () => {
    if (selectedElements.length === 0) {
      setError("Please select at least one element to translate");
      return;
    }

    setIsTranslating(true);
    setError(null);
    setSuccess(false);

    try {
      const elementsToTranslate = contentElements
        .filter((el) => selectedElements.includes(el.element_id))
        .map((el) => ({
          id: el.element_id,
          text: el.current_content,
        }));

      const response = await fetch("/api/ai/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          siteId,
          fromLanguage,
          toLanguage,
          elements: elementsToTranslate,
          context: "website content",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Translation failed");
      }

      setTranslationResults(data.translations);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setIsTranslating(false);
    }
  };

  const getLanguageInfo = (code: string) =>
    SUPPORTED_LANGUAGES.find((lang) => lang.code === code) || {
      name: code,
      flag: "🌐",
    };

  return (
    <div className="bg-card rounded-lg shadow-md p-6">
      <div className="flex items-center gap-3 mb-6">
        <Globe className="h-6 w-6 text-tone-info-text" />
        <h2 className="text-xl font-semibold">AI Translation</h2>
        <div className="ml-auto">
          <span className="bg-tone-info-surface text-tone-info-text text-xs font-medium px-2.5 py-0.5 rounded">
            Powered by OpenAI
          </span>
        </div>
      </div>

      {/* Language Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            From Language
          </label>
          <select
            value={fromLanguage}
            onChange={(e) => setFromLanguage(e.target.value)}
            className="w-full border border-input rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.flag} {lang.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            To Language
          </label>
          <select
            value={toLanguage}
            onChange={(e) => setToLanguage(e.target.value)}
            className="w-full border border-input rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.flag} {lang.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Content Selection */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Select Content to Translate</h3>
          <button
            onClick={handleSelectAll}
            className="text-tone-info-text hover:text-tone-info-text text-sm font-medium"
          >
            {selectedElements.length === contentElements.length
              ? "Deselect All"
              : "Select All"}
          </button>
        </div>

        <div className="max-h-64 overflow-y-auto border border-border rounded-md">
          {contentElements.map((element) => (
            <div
              key={element.element_id}
              className="flex items-start gap-3 p-3 border-b border-border hover:bg-surface-1"
            >
              <input
                type="checkbox"
                checked={selectedElements.includes(element.element_id)}
                onChange={() => handleElementToggle(element.element_id)}
                className="mt-1 h-4 w-4 text-tone-info-text rounded border-input"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground mb-1">
                  {element.selector}
                </p>
                <p className="text-sm text-foreground truncate">
                  {element.current_content}
                </p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-sm text-muted-foreground mt-2">
          {selectedElements.length} of {contentElements.length} elements
          selected
        </p>
      </div>

      {/* Action Button */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={handleTranslate}
          disabled={isTranslating || selectedElements.length === 0}
          className="flex items-center gap-2 bg-primary text-white px-6 py-2 rounded-md hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isTranslating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
          {isTranslating ? "Translating..." : "Translate with AI"}
        </button>

        {fromLanguage && toLanguage && (
          <span className="text-sm text-muted-foreground">
            {getLanguageInfo(fromLanguage).flag} →{" "}
            {getLanguageInfo(toLanguage).flag}
          </span>
        )}
      </div>

      {/* Status Messages */}
      {error && (
        <div className="flex items-center gap-2 text-tone-danger-text bg-tone-danger-surface p-3 rounded-md mb-4">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 text-tone-success-text bg-tone-success-surface p-3 rounded-md mb-4">
          <CheckCircle className="h-4 w-4" />
          <span className="text-sm">
            Successfully translated {translationResults.length} elements to{" "}
            {getLanguageInfo(toLanguage).name}
          </span>
        </div>
      )}

      {/* Translation Results */}
      {translationResults.length > 0 && (
        <div>
          <h3 className="text-lg font-medium mb-4">Translation Results</h3>
          <div className="space-y-4">
            {translationResults.map((result) => (
              <div
                key={result.id}
                className="border border-border rounded-md p-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Original ({getLanguageInfo(fromLanguage).name})
                    </label>
                    <p className="text-sm text-foreground">
                      {result.originalText}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Translation ({getLanguageInfo(toLanguage).name})
                    </label>
                    <p className="text-sm text-foreground">
                      {result.translatedText}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
