"use client";

import React, { useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Tier } from "@/services/ReputationGatingService";
import type { LendingPolicy } from "@/services/VaultLendingGovernanceService";
import { VaultLendingGovernanceService } from "@/services/VaultLendingGovernanceService";
import { AlertCircle, Loader2 } from "lucide-react";

interface UserReputation {
  tier: Tier;
  score: number;
  votingPower?: number;
}

interface LendingProposalFormProps {
  poolId: string;
  currentPolicy: LendingPolicy;
  userAddress?: string;
  userReputation?: UserReputation;
  onClose: () => void;
  onProposalCreated: (proposalId: string) => void;
}

export function LendingProposalForm({
  poolId,
  currentPolicy,
  userAddress,
  userReputation,
  onClose,
  onProposalCreated,
}: LendingProposalFormProps) {
  const [proposalType, setProposalType] = useState<"apr" | "ltv">("apr");
  const [tier, setTier] = useState<"tier2" | "tier3">("tier2");
  const [newApr, setNewApr] = useState(
    proposalType === "apr" && tier === "tier2"
      ? currentPolicy.tier2.apr
      : currentPolicy.tier3.apr
  );
  const [newLtv, setNewLtv] = useState(
    proposalType === "ltv" && tier === "tier2"
      ? currentPolicy.tier2.ltv * 100
      : currentPolicy.tier3.ltv * 100
  );
  const [rationale, setRationale] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const govService = new VaultLendingGovernanceService();

  const handleSubmit = async () => {
    if (!userAddress) {
      setError("User address required");
      return;
    }

    if (!rationale.trim()) {
      setError("Please provide rationale for the proposal");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const changes: any = {
        [tier]: {
          ...(proposalType === "apr"
            ? {
                apr: newApr,
                ltv: tier === "tier2" ? currentPolicy.tier2.ltv : currentPolicy.tier3.ltv,
              }
            : {
                apr: tier === "tier2" ? currentPolicy.tier2.apr : currentPolicy.tier3.apr,
                ltv: newLtv / 100,
              }),
        },
      };

      const proposalId = await govService.proposeRateChange(poolId, changes);
      onProposalCreated(proposalId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create proposal";
      setError(message);
      console.error("Error creating proposal:", err);
    } finally {
      setLoading(false);
    }
  };

  const getCurrentValue = () => {
    const tierKey = tier as "tier2" | "tier3";
    if (proposalType === "apr") {
      return currentPolicy[tierKey].apr;
    } else {
      return currentPolicy[tierKey].ltv * 100;
    }
  };

  const getTierLabel = () => {
    return tier === "tier2" ? "Tier 2" : "Tier 3";
  };

  const getMetrics = () => {
    if (tier === "tier2") {
      return {
        minApr: 4,
        maxApr: 8,
        minLtv: 30,
        maxLtv: 70,
        currentApr: currentPolicy.tier2.apr,
        currentLtv: currentPolicy.tier2.ltv * 100,
      };
    } else {
      return {
        minApr: 2,
        maxApr: 6,
        minLtv: 80,
        maxLtv: 200,
        currentApr: currentPolicy.tier3.apr,
        currentLtv: currentPolicy.tier3.ltv * 100,
      };
    }
  };

  const metrics = getMetrics();
  const currentValue = getCurrentValue();

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Propose Policy Change</DialogTitle>
          <DialogDescription>
            Submit a proposal to adjust lending rates or LTV limits for vault governance
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-900">Error</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Tier Selection */}
          <div>
            <Label className="text-base font-semibold">Policy Type</Label>
            <Tabs value={proposalType} onValueChange={(val) => setProposalType(val as any)}>
              <TabsList className="grid w-full grid-cols-2 mt-2">
                <TabsTrigger value="apr">Adjust APR</TabsTrigger>
                <TabsTrigger value="ltv">Adjust LTV</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Reputation Tier Selection */}
          <div>
            <Label className="text-base font-semibold">Reputation Tier</Label>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <button
                onClick={() => setTier("tier2")}
                className={`p-3 rounded-lg border-2 transition-all ${
                  tier === "tier2"
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="font-medium text-gray-900">Tier 2</div>
                <div className="text-xs text-gray-600 mt-1">Moderate leverage</div>
              </button>
              <button
                onClick={() => setTier("tier3")}
                className={`p-3 rounded-lg border-2 transition-all ${
                  tier === "tier3"
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="font-medium text-gray-900">Tier 3</div>
                <div className="text-xs text-gray-600 mt-1">Maximum leverage</div>
              </button>
            </div>
          </div>

          {/* APR/LTV Adjustment */}
          <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="font-semibold">
                  {proposalType === "apr" ? "New APR (%)" : "New LTV (%)"}
                </Label>
                <span className="text-sm text-gray-600">
                  Current: {currentValue.toFixed(proposalType === "apr" ? 1 : 0)}%
                </span>
              </div>

              <div className="flex items-center gap-4">
                <Slider
                  value={[proposalType === "apr" ? newApr : newLtv]}
                  onValueChange={(value) => {
                    if (proposalType === "apr") {
                      setNewApr(value[0]);
                    } else {
                      setNewLtv(value[0]);
                    }
                  }}
                  min={proposalType === "apr" ? metrics.minApr : metrics.minLtv}
                  max={proposalType === "apr" ? metrics.maxApr : metrics.maxLtv}
                  step={0.1}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={proposalType === "apr" ? newApr : newLtv}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    if (proposalType === "apr") {
                      setNewApr(Math.min(metrics.maxApr, Math.max(metrics.minApr, val)));
                    } else {
                      setNewLtv(Math.min(metrics.maxLtv, Math.max(metrics.minLtv, val)));
                    }
                  }}
                  step={0.1}
                  min={proposalType === "apr" ? metrics.minApr : metrics.minLtv}
                  max={proposalType === "apr" ? metrics.maxApr : metrics.maxLtv}
                  className="w-20"
                />
              </div>

              <div className="text-xs text-gray-600 mt-2">
                {proposalType === "apr"
                  ? `APR range: ${metrics.minApr}% - ${metrics.maxApr}%`
                  : `LTV range: ${metrics.minLtv}% - ${metrics.maxLtv}%`}
              </div>

              {/* Change Summary */}
              {currentValue !== (proposalType === "apr" ? newApr : newLtv) && (
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded text-xs">
                  <p className="font-medium text-blue-900">
                    {proposalType === "apr" ? "APR Change" : "LTV Change"}
                  </p>
                  <p className="text-blue-700 mt-1">
                    {getTierLabel()} {proposalType === "apr" ? "APR" : "LTV"}: {currentValue.toFixed(1)}% →{" "}
                    {(proposalType === "apr" ? newApr : newLtv).toFixed(1)}%
                    <br />
                    <span className="font-semibold">
                      {(proposalType === "apr" ? newApr - currentValue : newLtv - currentValue) > 0
                        ? "+"
                        : ""}
                      {(proposalType === "apr" ? newApr - currentValue : newLtv - currentValue).toFixed(
                        1
                      )}
                      %
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Rationale */}
          <div>
            <Label htmlFor="rationale" className="text-base font-semibold">
              Rationale for Change
            </Label>
            <textarea
              id="rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Explain why this change would benefit the vault and its governance..."
              className="w-full mt-2 p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              rows={4}
            />
            <div className="text-xs text-gray-500 mt-1">
              {rationale.length} / 500 characters
            </div>
          </div>

          {/* User Info */}
          {userReputation && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-medium text-blue-900">Your Voting Power</p>
              <p className="text-sm text-blue-700 mt-1">
                {userReputation.tier} with {userReputation.votingPower || 1} vote
                {(userReputation.votingPower || 1) !== 1 ? "s" : ""}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || !userAddress}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit Proposal
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
