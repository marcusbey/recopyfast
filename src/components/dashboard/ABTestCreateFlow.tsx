"use client";

import { useABTestCreation } from "@/hooks/useABTestCreation";
import type { MappedContentElement } from "@/hooks/useContentElements";
import { WizardStepIndicator } from "@/components/dashboard/ab-create/WizardStepIndicator";
import { ABTestElementPicker } from "@/components/dashboard/ab-create/ABTestElementPicker";
import { ABTestGeneratingState } from "@/components/dashboard/ab-create/ABTestGeneratingState";
import { ABTestVariantReview } from "@/components/dashboard/ab-create/ABTestVariantReview";
import { ABTestConfigForm } from "@/components/dashboard/ab-create/ABTestConfigForm";

interface ABTestCreateFlowProps {
  siteId: string;
  elements: MappedContentElement[];
  onComplete?: (testId: string) => void;
  onCancel?: () => void;
}

const WIZARD_STEPS = [
  { key: "select-element", label: "Select Element" },
  { key: "generate", label: "Generate" },
  { key: "review", label: "Review Variants" },
  { key: "configure", label: "Configure & Activate" },
];

export default function ABTestCreateFlow({
  siteId,
  elements,
  onComplete,
  onCancel,
}: ABTestCreateFlowProps) {
  const wizard = useABTestCreation({ siteId, elements, onComplete });

  return (
    <div className="space-y-6">
      <WizardStepIndicator steps={WIZARD_STEPS} currentStep={wizard.step} />

      {wizard.error && (
        <div className="rounded-lg border border-tone-danger-border bg-tone-danger-surface p-3 text-sm text-tone-danger-text">
          {wizard.error}
        </div>
      )}

      {wizard.step === "select-element" && (
        <ABTestElementPicker
          elements={elements}
          selectedElement={wizard.selectedElement}
          onSelect={wizard.selectElement}
          onGenerate={wizard.generate}
          onCancel={() => onCancel?.()}
        />
      )}

      {wizard.step === "generate" && wizard.generating && (
        <ABTestGeneratingState />
      )}

      {wizard.step === "review" && (
        <ABTestVariantReview
          selectedContent={wizard.selectedContent}
          variants={wizard.variants}
          rationales={wizard.rationales}
          editingIndex={wizard.editingIndex}
          editContent={wizard.editContent}
          onEditContentChange={wizard.setEditContent}
          onStartEditing={wizard.startEditing}
          onSaveEdit={wizard.saveEdit}
          onCancelEdit={wizard.cancelEdit}
          onBack={() => wizard.setStep("select-element")}
          onNext={() => wizard.setStep("configure")}
        />
      )}

      {wizard.step === "configure" && (
        <ABTestConfigForm
          minSampleSize={wizard.minSampleSize}
          onMinSampleSizeChange={wizard.setMinSampleSize}
          confidenceThreshold={wizard.confidenceThreshold}
          onConfidenceThresholdChange={wizard.setConfidenceThreshold}
          autoComplete={wizard.autoComplete}
          onAutoCompleteChange={wizard.setAutoComplete}
          activating={wizard.activating}
          onActivate={wizard.activate}
          onBack={() => wizard.setStep("review")}
        />
      )}
    </div>
  );
}
