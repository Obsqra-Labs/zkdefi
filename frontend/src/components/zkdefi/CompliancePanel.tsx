"use client";

import { useState } from "react";
import { useAccount } from "@starknet-react/core";
import { ProofVisualizer } from "./ProofVisualizer";
import { toastSuccess, toastError } from "@/lib/toast";
import { Eye, Shield, CheckCircle2, ArrowRight, Copy, HelpCircle, TrendingUp, AlertTriangle, BadgeCheck, Layers } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { addActivityEvent } from "./ActivityLog";
import { useApp } from "@/lib/AppContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";
const DISCLOSURE_ADDRESS = process.env.NEXT_PUBLIC_SELECTIVE_DISCLOSURE_ADDRESS || "";

type Step = 1 | 2 | 3;

interface StatementType {
  value: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  endpoint: string;
  fields: FieldConfig[];
}

interface FieldConfig {
  name: string;
  label: string;
  type: "number" | "select" | "multi-select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  suffix?: string;
}

const STATEMENT_TYPES: StatementType[] = [
  {
    value: "yield_above",
    label: "Yield Above Threshold",
    description: "Prove your yield exceeds a threshold without revealing exact amount",
    icon: <TrendingUp className="w-4 h-4" />,
    endpoint: "/disclosure/generate",
    fields: [
      { name: "threshold", label: "Minimum Yield", type: "number", placeholder: "100", suffix: "%" },
    ],
  },
  {
    value: "balance_above",
    label: "Balance Above Threshold",
    description: "Prove your balance exceeds a threshold for KYC or access",
    icon: <BadgeCheck className="w-4 h-4" />,
    endpoint: "/disclosure/generate",
    fields: [
      { name: "threshold", label: "Minimum Balance", type: "number", placeholder: "1000" },
    ],
  },
  {
    value: "risk_compliance",
    label: "Risk Compliance",
    description: "Prove your portfolio risk is below a threshold",
    icon: <AlertTriangle className="w-4 h-4" />,
    endpoint: "/disclosure/risk_compliance",
    fields: [
      { name: "max_risk_threshold", label: "Max Risk", type: "number", placeholder: "20", suffix: "%" },
      {
        name: "risk_metric",
        label: "Risk Metric",
        type: "select",
        options: [
          { value: "var", label: "Value at Risk (VaR)" },
          { value: "sharpe", label: "Sharpe Ratio" },
          { value: "max_drawdown", label: "Max Drawdown" },
        ],
      },
    ],
  },
  {
    value: "performance",
    label: "Performance Proof",
    description: "Prove your APY was above threshold for a period",
    icon: <TrendingUp className="w-4 h-4" />,
    endpoint: "/disclosure/performance",
    fields: [
      { name: "min_apy", label: "Minimum APY", type: "number", placeholder: "10", suffix: "%" },
      { name: "period_days", label: "Period", type: "number", placeholder: "30", suffix: "days" },
    ],
  },
  {
    value: "kyc_eligibility",
    label: "KYC Eligibility",
    description: "Prove financial standing for regulatory compliance",
    icon: <BadgeCheck className="w-4 h-4" />,
    endpoint: "/disclosure/kyc_eligibility",
    fields: [
      { name: "min_balance", label: "Minimum Balance", type: "number", placeholder: "100000" },
    ],
  },
  {
    value: "portfolio_aggregation",
    label: "Portfolio Aggregation",
    description: "Prove total value across protocols without revealing breakdown",
    icon: <Layers className="w-4 h-4" />,
    endpoint: "/disclosure/aggregation",
    fields: [
      { name: "min_total_value", label: "Minimum Total Value", type: "number", placeholder: "5000" },
      {
        name: "protocol_ids",
        label: "Protocols",
        type: "multi-select",
        options: [
          { value: "0", label: "Pools" },
          { value: "1", label: "Ekubo" },
          { value: "2", label: "JediSwap" },
        ],
      },
    ],
  },
];

function shortStringToFelt(s: string): string {
  if (!s || s.length > 31) return "0";
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 256 + s.charCodeAt(i);
  return n.toString();
}

export function CompliancePanel() {
  const { address, account, isConnected } = useAccount();
  const { setActivityFeed } = useApp();
  const [selectedType, setSelectedType] = useState<StatementType>(STATEMENT_TYPES[0]);
  const [formData, setFormData] = useState<Record<string, string | string[]>>({});
  const [step, setStep] = useState<Step>(1);
  const [proofHash, setProofHash] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [shareableLink, setShareableLink] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  const handleTypeChange = (value: string) => {
    const type = STATEMENT_TYPES.find((t) => t.value === value);
    if (type) {
      setSelectedType(type);
      setFormData({});
    }
  };

  const handleFieldChange = (name: string, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleGenerate = async () => {
    if (!address) return;
    setStep(2);

    try {
      // Build request body based on selected type
      let body: Record<string, unknown> = { user_address: address };
      
      if (selectedType.value === "yield_above" || selectedType.value === "balance_above") {
        body = {
          ...body,
          statement_type: selectedType.value,
          threshold: parseInt(formData.threshold as string || "0", 10),
          result: "true",
        };
      } else if (selectedType.value === "risk_compliance") {
        body = {
          ...body,
          max_risk_threshold: parseInt(formData.max_risk_threshold as string || "0", 10),
          risk_metric: formData.risk_metric || "var",
        };
      } else if (selectedType.value === "performance") {
        body = {
          ...body,
          min_apy: parseInt(formData.min_apy as string || "0", 10) * 100, // Convert to basis points
          period_days: parseInt(formData.period_days as string || "30", 10),
        };
      } else if (selectedType.value === "kyc_eligibility") {
        body = {
          ...body,
          min_balance: BigInt(formData.min_balance as string || "0") * BigInt(1e18),
        };
      } else if (selectedType.value === "portfolio_aggregation") {
        const protocols = (formData.protocol_ids as string[]) || ["0", "1", "2"];
        body = {
          ...body,
          min_total_value: BigInt(formData.min_total_value as string || "0") * BigInt(1e18),
          protocol_ids: protocols.map((p) => parseInt(p, 10)),
        };
      }

      const res = await fetch(`${API_BASE}/api/v1/zkdefi${selectedType.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.proof_hash) {
        setProofHash(data.proof_hash);
        setStep(3);
        setShareableLink(`${window.location.origin}/proof/${data.proof_hash}`);
        toastSuccess("Disclosure proof generated!");
      } else {
        toastError(data.detail || data.message || "Failed to generate proof");
        setStep(1);
      }
    } catch (e) {
      toastError(`Error: ${e}`);
      setStep(1);
    }
  };

  const handleRegisterOnChain = async () => {
    if (!account || !proofHash || !DISCLOSURE_ADDRESS) {
      toastError(DISCLOSURE_ADDRESS ? "Connect wallet to register." : "Selective disclosure contract not configured.");
      return;
    }

    try {
      const threshold = BigInt(formData.threshold as string || formData.min_balance as string || formData.min_total_value as string || "0");
      const thLow = threshold % BigInt(2 ** 128);
      const thHigh = threshold / BigInt(2 ** 128);
      const statementFelt = shortStringToFelt(selectedType.value);
      const resultFelt = shortStringToFelt("true");
      const proofHashFelt = BigInt(proofHash);

      const { transaction_hash } = await account.execute({
        contractAddress: DISCLOSURE_ADDRESS as `0x${string}`,
        entrypoint: "register_disclosure",
        calldata: [statementFelt, thLow.toString(), thHigh.toString(), resultFelt, proofHashFelt.toString()],
      });

      setTxHash(transaction_hash);
      toastSuccess("Disclosure registered!", {
        action: {
          label: "View on explorer",
          onClick: () => window.open(`https://sepolia.starkscan.co/tx/${transaction_hash}`, "_blank"),
        },
      });

      addActivityEvent(setActivityFeed, {
        type: "disclosure",
        text: `Selective disclosure: ${selectedType.label}`,
        txHash: transaction_hash,
        details: `Proved ${selectedType.label.toLowerCase()} without revealing full history.`,
      });
    } catch (e: unknown) {
      const err = e && typeof e === "object" && "message" in e ? (e as { message: string }).message : String(e);
      toastError(`Failed: ${err}`);
    }
  };

  const resetFlow = () => {
    setStep(1);
    setProofHash(null);
    setTxHash(null);
    setShareableLink(null);
    setFormData({});
  };

  const copyLink = () => {
    if (shareableLink) {
      navigator.clipboard.writeText(shareableLink);
      toastSuccess("Link copied to clipboard");
    }
  };

  const renderField = (field: FieldConfig) => {
    if (field.type === "number") {
      return (
        <div key={field.name}>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            {field.label}
          </label>
          <div className="relative">
            <input
              type="text"
              value={(formData[field.name] as string) || ""}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
            />
            {field.suffix && (
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">
                {field.suffix}
              </span>
            )}
          </div>
        </div>
      );
    }

    if (field.type === "select") {
      return (
        <div key={field.name}>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            {field.label}
          </label>
          <select
            value={(formData[field.name] as string) || field.options?.[0]?.value || ""}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (field.type === "multi-select") {
      const selectedValues = (formData[field.name] as string[]) || [];
      return (
        <div key={field.name}>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            {field.label}
          </label>
          <div className="flex flex-wrap gap-2">
            {field.options?.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  const newValues = selectedValues.includes(opt.value)
                    ? selectedValues.filter((v) => v !== opt.value)
                    : [...selectedValues, opt.value];
                  handleFieldChange(field.name, newValues);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  selectedValues.includes(opt.value)
                    ? "bg-cyan-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="glass rounded-2xl border border-zinc-800 p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-1 flex items-center gap-2">
          <Eye className="w-5 h-5 text-cyan-400" />
          Selective Disclosure
        </h2>
        <p className="text-sm text-zinc-400">
          Prove compliance without revealing your full history
        </p>
      </div>

      {!isConnected && (
        <div className="text-center py-8">
          <p className="text-zinc-400 text-sm mb-2">Connect wallet to generate</p>
        </div>
      )}

      {isConnected && (
        <>
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                {/* Statement Type Selection */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    I want to prove...
                  </label>
                  <div className="space-y-2">
                    {STATEMENT_TYPES.map((type) => (
                      <button
                        key={type.value}
                        onClick={() => handleTypeChange(type.value)}
                        className={`w-full p-3 rounded-lg border text-left transition-all flex items-start gap-3 ${
                          selectedType.value === type.value
                            ? "border-cyan-500 bg-cyan-950/30"
                            : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-600"
                        }`}
                      >
                        <div className={`mt-0.5 ${selectedType.value === type.value ? "text-cyan-400" : "text-zinc-500"}`}>
                          {type.icon}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{type.label}</p>
                            <button
                              type="button"
                              onMouseEnter={() => setShowTooltip(type.value)}
                              onMouseLeave={() => setShowTooltip(null)}
                              className="text-zinc-500 hover:text-zinc-400"
                            >
                              <HelpCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {showTooltip === type.value && (
                            <p className="text-xs text-zinc-400 mt-1">{type.description}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dynamic Fields */}
                <div className="space-y-4 pt-2">
                  {selectedType.fields.map(renderField)}
                </div>

                {/* Use Cases Info */}
                <div className="p-4 rounded-lg bg-cyan-950/20 border border-cyan-500/30">
                  <p className="text-xs text-cyan-300 mb-2 font-medium">Use cases for {selectedType.label}:</p>
                  <ul className="text-xs text-zinc-400 space-y-1">
                    {selectedType.value === "yield_above" && (
                      <>
                        <li>• Access yield-based protocol tiers</li>
                        <li>• Prove performance to investors</li>
                      </>
                    )}
                    {selectedType.value === "balance_above" && (
                      <>
                        <li>• Access balance-gated features</li>
                        <li>• Prove solvency to lenders</li>
                      </>
                    )}
                    {selectedType.value === "risk_compliance" && (
                      <>
                        <li>• Meet institutional risk limits</li>
                        <li>• Prove conservative strategy</li>
                      </>
                    )}
                    {selectedType.value === "performance" && (
                      <>
                        <li>• Qualify for advanced features</li>
                        <li>• Demonstrate trading skill</li>
                      </>
                    )}
                    {selectedType.value === "kyc_eligibility" && (
                      <>
                        <li>• Regulatory compliance</li>
                        <li>• Accredited investor verification</li>
                      </>
                    )}
                    {selectedType.value === "portfolio_aggregation" && (
                      <>
                        <li>• Prove total value without breakdown</li>
                        <li>• Multi-protocol access verification</li>
                      </>
                    )}
                  </ul>
                </div>

                <button
                  onClick={handleGenerate}
                  className="w-full px-6 py-4 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-cyan-500/20 flex items-center justify-center gap-2"
                >
                  <Shield className="w-5 h-5" />
                  Generate Disclosure Proof
                </button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <ProofVisualizer
                  state="generating"
                  progress={50}
                  step="Generating selective disclosure proof..."
                />
              </motion.div>
            )}

            {step === 3 && proofHash && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <ProofVisualizer state="valid" />

                <div className="glass rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-4">
                  <p className="text-sm font-medium text-cyan-300 mb-2">Proof Hash</p>
                  <p className="font-mono text-xs break-all text-zinc-200">{proofHash}</p>
                </div>

                <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-700">
                  <p className="text-xs text-zinc-400 mb-2">Statement proved:</p>
                  <p className="text-sm font-medium text-white">{selectedType.label}</p>
                </div>

                {shareableLink && (
                  <div className="glass rounded-lg border border-zinc-700 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-zinc-300">Shareable Proof</p>
                      <button
                        onClick={copyLink}
                        className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-zinc-400 break-all font-mono">{shareableLink}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={handleRegisterOnChain}
                    disabled={!DISCLOSURE_ADDRESS}
                    className="flex-1 px-6 py-4 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-cyan-500/20"
                  >
                    Register on-chain
                  </button>
                  <button
                    onClick={resetFlow}
                    className="px-6 py-4 border border-zinc-600 hover:bg-zinc-800 rounded-lg font-medium"
                  >
                    Start Over
                  </button>
                </div>

                {txHash && (
                  <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-500/30">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      <p className="text-sm font-medium text-emerald-300">
                        Disclosure registered
                      </p>
                    </div>
                    <a
                      href={`https://sepolia.starkscan.co/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
                    >
                      View on explorer
                      <ArrowRight className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
