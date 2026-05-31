"use client";

import { useState, useCallback } from "react";

export type WizardStep = "select-element" | "generate" | "review" | "configure";

export interface GeneratedVariant {
  name: string;
  content: string;
  rationale: string;
}

export interface ABTestCreationState {
  step: WizardStep;
  selectedElement: string | null;
  selectedContent: string;
  generating: boolean;
  variants: GeneratedVariant[];
  rationales: Array<{ name: string; rationale: string }>;
  editingIndex: number | null;
  editContent: string;
  generatedTestId: string | null;
  activating: boolean;
  error: string | null;
  minSampleSize: number;
  confidenceThreshold: number;
  autoComplete: boolean;
}

interface UseABTestCreationProps {
  siteId: string;
  elements: Array<{ elementId: string; content: string; type: string }>;
  onComplete?: (testId: string) => void;
}

export function useABTestCreation({
  siteId,
  elements,
  onComplete,
}: UseABTestCreationProps) {
  const [step, setStep] = useState<WizardStep>("select-element");
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [variants, setVariants] = useState<GeneratedVariant[]>([]);
  const [rationales, setRationales] = useState<
    Array<{ name: string; rationale: string }>
  >([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [generatedTestId, setGeneratedTestId] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minSampleSize, setMinSampleSize] = useState(100);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.95);
  const [autoComplete, setAutoComplete] = useState(true);

  const selectElement = useCallback(
    (elementId: string) => {
      setSelectedElement(elementId);
      const el = elements.find((e) => e.elementId === elementId);
      setSelectedContent(el?.content || "");
    },
    [elements],
  );

  const generate = useCallback(async () => {
    if (!selectedElement) return;
    setGenerating(true);
    setError(null);
    setStep("generate");

    try {
      const response = await fetch("/api/ab-tests/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          element_id: selectedElement,
          original_text: selectedContent,
          context: `Website element of type ${elements.find((e) => e.elementId === selectedElement)?.type || "text"}`,
          num_variants: 3,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Generation failed");
        return;
      }

      setGeneratedTestId(data.test.id);
      const testVariants = (data.test.variants || []).filter(
        (v: { is_control: boolean }) => !v.is_control,
      );
      setVariants(
        testVariants.map((v: { name: string; variant_content: string }) => ({
          name: v.name,
          content: v.variant_content,
          rationale: "",
        })),
      );
      setRationales(data.ai_rationales || []);
      setStep("review");
    } catch {
      setError("Failed to generate variants");
    } finally {
      setGenerating(false);
    }
  }, [siteId, selectedElement, selectedContent, elements]);

  const activate = useCallback(async () => {
    setActivating(true);
    setError(null);

    try {
      const response = await fetch("/api/ab-tests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test_id: generatedTestId,
          status: "active",
          auto_complete: autoComplete,
          min_sample_size: minSampleSize,
          confidence_threshold: confidenceThreshold,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        onComplete?.(data.id);
      } else {
        const data = await response.json();
        setError(data.error || "Failed to activate test");
      }
    } catch {
      setError("Failed to activate test");
    } finally {
      setActivating(false);
    }
  }, [
    generatedTestId,
    autoComplete,
    minSampleSize,
    confidenceThreshold,
    onComplete,
  ]);

  const startEditing = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setEditContent(variants[index].content);
    },
    [variants],
  );

  const saveEdit = useCallback(() => {
    if (editingIndex === null) return;
    const updated = [...variants];
    updated[editingIndex] = { ...updated[editingIndex], content: editContent };
    setVariants(updated);
    setEditingIndex(null);
  }, [editingIndex, editContent, variants]);

  const cancelEdit = useCallback(() => {
    setEditingIndex(null);
  }, []);

  return {
    step,
    setStep,
    selectedElement,
    selectedContent,
    generating,
    variants,
    rationales,
    editingIndex,
    editContent,
    setEditContent,
    generatedTestId,
    activating,
    error,
    minSampleSize,
    setMinSampleSize,
    confidenceThreshold,
    setConfidenceThreshold,
    autoComplete,
    setAutoComplete,
    selectElement,
    generate,
    activate,
    startEditing,
    saveEdit,
    cancelEdit,
  };
}
