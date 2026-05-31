"use client";

import { ArrowRight } from "lucide-react";

interface WizardStepIndicatorProps {
  steps: Array<{ key: string; label: string }>;
  currentStep: string;
}

export function WizardStepIndicator({
  steps,
  currentStep,
}: WizardStepIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center gap-2">
          {i > 0 && <ArrowRight className="h-3 w-3 text-gray-300" />}
          <span
            className={
              currentStep === step.key
                ? "font-medium text-blue-600"
                : "text-gray-400"
            }
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
