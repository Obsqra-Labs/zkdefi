"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { LendingPolicy } from "@/services/VaultLendingGovernanceService";
import { VaultLendingGovernanceService } from "@/services/VaultLendingGovernanceService";
import { AlertCircle, Loader2, ChevronRight, CheckCircle2 } from "lucide-react";

export interface LendingProposalFormProps {
  poolId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (proposalId: string) => void;
  currentPolicy: LendingPolicy;
  userVotingPower: number;
  minVotingPower?: number;
}

type ProposalType = "apr" | "ltv" | "idle_reserve" | null;
type Step = 1 | 2 | 3 | 4;

interface FormState {
  proposalType: ProposalType;
  newAprTier2?: number;
  newAprTier3?: number;
  newLtvTier2?: number;
  newLtvTier3?: number;
  idleReserveRatio?: number;
  rationale: string;
}

interface ValidationError {
  field: string;
  message: string;
}

export function LendingProposalForm({
  poolId,
  isOpen,
  onClose,
  onSuccess,
  currentPolicy,
  userVotingPower,
  minVotingPower = 10,
}: LendingProposalFormProps) {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [formData, setFormData] = useState<FormState>({
    proposalType: null,
    rationale: "",
  });
  const [errors, setErrors] = useState<ValidationError[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Don't instantiate in useMemo - just create when needed
  const createGovService = () => new VaultLendingGovernanceService();

  const validateStep = (step: Step): boolean => {
    setErrors(null);
    const newErrors: ValidationError[] = [];

    if (step === 1) {
      if (!formData.proposalType) {
        newErrors.push({
          field: "proposalType",
          message: "Please select a proposal type",
        });
      }
    } else if (step === 2) {
      // Validate that at least one value differs
      let hasChange = false;

      if (formData.proposalType === "apr") {
        const tier2Changed = formData.newAprTier2 !== undefined && formData.newAprTier2 !== currentPolicy.tier2.apr;
        const tier3Changed = formData.newAprTier3 !== undefined && formData.newAprTier3 !== currentPolicy.tier3.apr;
        hasChange = tier2Changed || tier3Changed;

        if (formData.newAprTier2 !== undefined && (formData.newAprTier2 < 1 || formData.newAprTier2 > 20)) {
          newErrors.push({
            field: "apr",
            message: "APR must be between 1% and 20%",
          });
        }
        if (formData.newAprTier3 !== undefined && (formData.newAprTier3 < 1 || formData.newAprTier3 > 20)) {
          newErrors.push({
            field: "apr",
            message: "APR must be between 1% and 20%",
          });
        }
      } else if (formData.proposalType === "ltv") {
        const tier2Changed = formData.newLtvTier2 !== undefined && formData.newLtvTier2 !== currentPolicy.tier2.ltv * 100;
        const tier3Changed = formData.newLtvTier3 !== undefined && formData.newLtvTier3 !== currentPolicy.tier3.ltv * 100;
        hasChange = tier2Changed || tier3Changed;

        if (formData.newLtvTier2 !== undefined && (formData.newLtvTier2 < 30 || formData.newLtvTier2 > 95)) {
          newErrors.push({
            field: "ltv",
            message: "LTV must be between 30% and 95%",
          });
        }
        if (formData.newLtvTier3 !== undefined && (formData.newLtvTier3 < 30 || formData.newLtvTier3 > 95)) {
          newErrors.push({
            field: "ltv",
            message: "LTV must be between 30% and 95%",
          });
        }
      } else if (formData.proposalType === "idle_reserve") {
        if (formData.idleReserveRatio !== undefined && (formData.idleReserveRatio < 5 || formData.idleReserveRatio > 50)) {
          newErrors.push({
            field: "idle_reserve",
            message: "Idle reserve ratio must be between 5% and 50%",
          });
        }
        hasChange = true;
      }

      if (!hasChange) {
        newErrors.push({
          field: "values",
          message: "Proposed values must differ from current policy",
        });
      }
    } else if (step === 3) {
      if (!formData.rationale || formData.rationale.trim().length < 10) {
        newErrors.push({
          field: "rationale",
          message: "Rationale must be at least 10 characters",
        });
      }
      if (formData.rationale.length > 500) {
        newErrors.push({
          field: "rationale",
          message: "Rationale must not exceed 500 characters",
        });
      }
    }

    if (newErrors.length > 0) {
      setErrors(newErrors);
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < 4) {
        setCurrentStep((currentStep + 1) as Step);
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as Step);
      setErrors(null);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(4)) {
      return;
    }

    setLoading(true);
    setSubmitError(null);

    try {
      const changes: any = {};

      if (formData.proposalType === "apr") {
        if (formData.newAprTier2 !== undefined && formData.newAprTier2 !== currentPolicy.tier2.apr) {
          changes.tier2 = {
            apr: formData.newAprTier2,
            ltv: currentPolicy.tier2.ltv,
          };
        }
        if (formData.newAprTier3 !== undefined && formData.newAprTier3 !== currentPolicy.tier3.apr) {
          changes.tier3 = {
            apr: formData.newAprTier3,
            ltv: currentPolicy.tier3.ltv,
          };
        }
      } else if (formData.proposalType === "ltv") {
        if (formData.newLtvTier2 !== undefined && formData.newLtvTier2 !== currentPolicy.tier2.ltv * 100) {
          changes.tier2 = {
            apr: currentPolicy.tier2.apr,
            ltv: formData.newLtvTier2 / 100,
          };
        }
        if (formData.newLtvTier3 !== undefined && formData.newLtvTier3 !== currentPolicy.tier3.ltv * 100) {
          changes.tier3 = {
            apr: currentPolicy.tier3.apr,
            ltv: formData.newLtvTier3 / 100,
          };
        }
      }

      const govService = createGovService();
      const proposalId = await govService.proposeRateChange(poolId, changes);
      onSuccess?.(proposalId);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit proposal";
      setSubmitError(message);
      console.error("Error submitting proposal:", err);
    } finally {
      setLoading(false);
    }
  };

  const hasInsufficientVotingPower = userVotingPower < minVotingPower;

  const stepContent = {
    1: <Step1 formData={formData} setFormData={setFormData} />,
    2: (
      <Step2
        formData={formData}
        setFormData={setFormData}
        currentPolicy={currentPolicy}
      />
    ),
    3: (
      <Step3
        formData={formData}
        setFormData={setFormData}
      />
    ),
    4: (
      <Step4
        formData={formData}
        currentPolicy={currentPolicy}
        userVotingPower={userVotingPower}
        minVotingPower={minVotingPower}
        hasInsufficientVotingPower={hasInsufficientVotingPower}
      />
    ),
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Governance Proposal</DialogTitle>
          <DialogDescription>
            Step {currentStep} of 4 — {currentStep === 1 && "Select proposal type"}
            {currentStep === 2 && "Enter proposed values"}
            {currentStep === 3 && "Add rationale"}
            {currentStep === 4 && "Review and submit"}
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex justify-between mb-6">
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="flex items-center flex-1">
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all ${
                  step === currentStep
                    ? "bg-blue-500 text-white shadow-lg"
                    : step < currentStep
                      ? "bg-green-500 text-white"
                      : "bg-gray-200 text-gray-600"
                }`}
              >
                {step < currentStep ? <CheckCircle2 className="h-5 w-5" /> : step}
              </div>
              {step < 4 && (
                <div
                  className={`flex-1 h-1 mx-2 rounded transition-all ${
                    step < currentStep ? "bg-green-500" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Error Display */}
        {errors && errors.length > 0 && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-900">Validation Error</p>
              <ul className="text-sm text-red-700 mt-1 space-y-1">
                {errors.map((err, idx) => (
                  <li key={idx}>• {err.message}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {submitError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-900">Submission Error</p>
              <p className="text-sm text-red-700 mt-1">{submitError}</p>
            </div>
          </div>
        )}

        {/* Step Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="min-h-[300px]"
          >
            {stepContent[currentStep]}
          </motion.div>
        </AnimatePresence>

        {/* Actions */}
        <div className="flex gap-3 justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1 || loading}
          >
            Back
          </Button>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>

            {currentStep < 4 ? (
              <Button
                onClick={handleNext}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={loading || hasInsufficientVotingPower}
                className="bg-green-600 hover:bg-green-700"
              >
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Submit Proposal
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Step 1: Proposal Type Selection
function Step1({
  formData,
  setFormData,
}: {
  formData: FormState;
  setFormData: (data: FormState) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Select Proposal Type
        </h3>
        <div className="space-y-3">
          {[
            {
              value: "apr",
              label: "Adjust APR",
              description: "Change annual percentage rate for borrowers",
            },
            {
              value: "ltv",
              label: "Adjust LTV",
              description: "Change loan-to-value limits",
            },
            {
              value: "idle_reserve",
              label: "Idle Reserve Ratio",
              description: "Adjust minimum reserve ratio requirement",
            },
          ].map((option) => (
            <label
              key={option.value}
              className={`flex items-start p-4 rounded-lg border-2 transition-all cursor-pointer ${
                formData.proposalType === option.value
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="proposalType"
                value={option.value}
                checked={formData.proposalType === option.value}
                onChange={() =>
                  setFormData({
                    ...formData,
                    proposalType: option.value as ProposalType,
                  })
                }
                className="mr-3 mt-1"
              />
              <div>
                <div className="font-semibold text-gray-900">{option.label}</div>
                <div className="text-sm text-gray-600">{option.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// Step 2: Values Input
function Step2({
  formData,
  setFormData,
  currentPolicy,
}: {
  formData: FormState;
  setFormData: (data: FormState) => void;
  currentPolicy: LendingPolicy;
}) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">
        Enter Proposed Values
      </h3>

      {formData.proposalType === "apr" && (
        <div className="space-y-6">
          <ValueInput
            label="Tier 2 APR"
            currentValue={currentPolicy.tier2.apr}
            newValue={formData.newAprTier2 ?? currentPolicy.tier2.apr}
            onChange={(val) => setFormData({ ...formData, newAprTier2: val })}
            min={1}
            max={20}
            step={0.1}
            unit="%"
          />
          <ValueInput
            label="Tier 3 APR"
            currentValue={currentPolicy.tier3.apr}
            newValue={formData.newAprTier3 ?? currentPolicy.tier3.apr}
            onChange={(val) => setFormData({ ...formData, newAprTier3: val })}
            min={1}
            max={20}
            step={0.1}
            unit="%"
          />
        </div>
      )}

      {formData.proposalType === "ltv" && (
        <div className="space-y-6">
          <ValueInput
            label="Tier 2 LTV"
            currentValue={currentPolicy.tier2.ltv * 100}
            newValue={formData.newLtvTier2 ?? currentPolicy.tier2.ltv * 100}
            onChange={(val) => setFormData({ ...formData, newLtvTier2: val })}
            min={30}
            max={95}
            step={1}
            unit="%"
          />
          <ValueInput
            label="Tier 3 LTV"
            currentValue={currentPolicy.tier3.ltv * 100}
            newValue={formData.newLtvTier3 ?? currentPolicy.tier3.ltv * 100}
            onChange={(val) => setFormData({ ...formData, newLtvTier3: val })}
            min={30}
            max={95}
            step={1}
            unit="%"
          />
        </div>
      )}

      {formData.proposalType === "idle_reserve" && (
        <ValueInput
          label="Idle Reserve Ratio"
          currentValue={10}
          newValue={formData.idleReserveRatio ?? 10}
          onChange={(val) => setFormData({ ...formData, idleReserveRatio: val })}
          min={5}
          max={50}
          step={1}
          unit="%"
        />
      )}
    </div>
  );
}

// Step 3: Rationale
function Step3({
  formData,
  setFormData,
}: {
  formData: FormState;
  setFormData: (data: FormState) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Add Rationale</h3>
      <div>
        <Label htmlFor="rationale" className="font-semibold">
          Why is this change important?
        </Label>
        <textarea
          id="rationale"
          value={formData.rationale}
          onChange={(e) =>
            setFormData({ ...formData, rationale: e.target.value })
          }
          placeholder="Explain why this change would benefit the vault and its governance..."
          className="w-full mt-2 p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          rows={6}
        />
        <div className="text-xs text-gray-500 mt-1">
          {formData.rationale.length} / 500 characters
        </div>
      </div>
    </div>
  );
}

// Step 4: Preview and Submit
function Step4({
  formData,
  currentPolicy,
  userVotingPower,
  minVotingPower,
  hasInsufficientVotingPower,
}: {
  formData: FormState;
  currentPolicy: LendingPolicy;
  userVotingPower: number;
  minVotingPower: number;
  hasInsufficientVotingPower: boolean;
}) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">
        Review Proposal
      </h3>

      {/* Summary */}
      <div className="p-4 bg-gray-50 rounded-lg space-y-3">
        <div className="flex justify-between">
          <span className="text-sm text-gray-600">Proposal Type</span>
          <span className="font-semibold text-gray-900 capitalize">
            {formData.proposalType === "idle_reserve"
              ? "Idle Reserve Ratio"
              : formData.proposalType?.toUpperCase()}
          </span>
        </div>

        {formData.proposalType === "apr" && (
          <>
            {(formData.newAprTier2 !== undefined && formData.newAprTier2 !== currentPolicy.tier2.apr) && (
              <div className="flex justify-between pt-2 border-t">
                <span className="text-sm text-gray-600">Tier 2 APR Change</span>
                <div className="text-right">
                  <div className="text-xs text-gray-500">
                    {(currentPolicy.tier2?.apr ?? 0).toFixed(2)}% → {formData.newAprTier2.toFixed(2)}%
                  </div>
                  <div className="font-semibold text-blue-600">
                    {(formData.newAprTier2 - currentPolicy.tier2.apr > 0 ? "+" : "")}
                    {(formData.newAprTier2 - currentPolicy.tier2.apr).toFixed(2)}%
                  </div>
                </div>
              </div>
            )}
            {(formData.newAprTier3 !== undefined && formData.newAprTier3 !== currentPolicy.tier3.apr) && (
              <div className="flex justify-between pt-2 border-t">
                <span className="text-sm text-gray-600">Tier 3 APR Change</span>
                <div className="text-right">
                  <div className="text-xs text-gray-500">
                    {(currentPolicy.tier3?.apr ?? 0).toFixed(2)}% → {formData.newAprTier3.toFixed(2)}%
                  </div>
                  <div className="font-semibold text-blue-600">
                    {(formData.newAprTier3 - currentPolicy.tier3.apr > 0 ? "+" : "")}
                    {(formData.newAprTier3 - currentPolicy.tier3.apr).toFixed(2)}%
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {formData.proposalType === "ltv" && (
          <>
            {(formData.newLtvTier2 !== undefined && formData.newLtvTier2 !== currentPolicy.tier2.ltv * 100) && (
              <div className="flex justify-between pt-2 border-t">
                <span className="text-sm text-gray-600">Tier 2 LTV Change</span>
                <div className="text-right">
                  <div className="text-xs text-gray-500">
                    {(currentPolicy.tier2.ltv * 100).toFixed(0)}% → {formData.newLtvTier2.toFixed(0)}%
                  </div>
                  <div className="font-semibold text-blue-600">
                    {(formData.newLtvTier2 - (currentPolicy.tier2.ltv * 100) > 0 ? "+" : "")}
                    {(formData.newLtvTier2 - (currentPolicy.tier2.ltv * 100)).toFixed(0)}%
                  </div>
                </div>
              </div>
            )}
            {(formData.newLtvTier3 !== undefined && formData.newLtvTier3 !== currentPolicy.tier3.ltv * 100) && (
              <div className="flex justify-between pt-2 border-t">
                <span className="text-sm text-gray-600">Tier 3 LTV Change</span>
                <div className="text-right">
                  <div className="text-xs text-gray-500">
                    {(currentPolicy.tier3.ltv * 100).toFixed(0)}% → {formData.newLtvTier3.toFixed(0)}%
                  </div>
                  <div className="font-semibold text-blue-600">
                    {(formData.newLtvTier3 - (currentPolicy.tier3.ltv * 100) > 0 ? "+" : "")}
                    {(formData.newLtvTier3 - (currentPolicy.tier3.ltv * 100)).toFixed(0)}%
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Rationale */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm font-semibold text-blue-900">Rationale</p>
        <p className="text-sm text-blue-700 mt-2">{formData.rationale}</p>
      </div>

      {/* Voting Power Check */}
      <div className={`p-4 rounded-lg border ${
        hasInsufficientVotingPower
          ? "bg-red-50 border-red-200"
          : "bg-green-50 border-green-200"
      }`}>
        <div className="flex items-start gap-3">
          {hasInsufficientVotingPower && (
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          )}
          <div>
            <p className={`text-sm font-semibold ${
              hasInsufficientVotingPower
                ? "text-red-900"
                : "text-green-900"
            }`}>
              {hasInsufficientVotingPower
                ? "Insufficient Voting Power"
                : "Sufficient Voting Power"}
            </p>
            <p className={`text-sm mt-1 ${
              hasInsufficientVotingPower
                ? "text-red-700"
                : "text-green-700"
            }`}>
              {hasInsufficientVotingPower
                ? `You have ${userVotingPower} voting power, but ${minVotingPower} is required to submit proposals`
                : `You have ${userVotingPower} voting power (${minVotingPower} required)`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Reusable Value Input Component
function ValueInput({
  label,
  currentValue,
  newValue,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  currentValue: number;
  newValue: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="font-semibold">{label}</Label>
        <span className="text-xs text-gray-600">
          Current: {currentValue.toFixed(2)}{unit}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <Slider
          value={[newValue]}
          onValueChange={(value) => onChange(value[0])}
          min={min}
          max={max}
          step={step}
          className="flex-1"
        />
        <Input
          type="number"
          value={newValue}
          onChange={(e) => {
            const val = parseFloat(e.target.value) || 0;
            onChange(Math.min(max, Math.max(min, val)));
          }}
          step={step}
          min={min}
          max={max}
          className="w-24"
        />
      </div>

      {newValue !== currentValue && (
        <div className="text-xs text-blue-600 font-medium">
          Change: {(newValue - currentValue > 0 ? "+" : "")}
          {(newValue - currentValue).toFixed(2)}{unit}
        </div>
      )}
    </div>
  );
}
