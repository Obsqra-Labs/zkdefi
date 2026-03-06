"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shield, Lock, Eye, ArrowRight, CheckCircle2 } from "lucide-react";
import { useApp } from "@/lib/AppContext";

export function OnboardingModal() {
  const { onboardingCompleted, setOnboardingCompleted } = useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  // Sync with context once hydrated (context may load onboardingCompleted from localStorage in useEffect)
  useEffect(() => {
    if (!onboardingCompleted) setIsOpen(true);
    else setIsOpen(false);
  }, [onboardingCompleted]);

  const steps = [
    {
      title: "Welcome to zkde.fi",
      description: "Your DeFi actions are proof-gated",
      icon: Shield,
      content: (
        <div className="space-y-4">
          <p className="text-zinc-300">
            Every deposit requires a zero-knowledge proof that verifies your constraints are met.
          </p>
          <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-500/30">
            <p className="text-sm text-emerald-300">
              <strong>No proof, no execution.</strong> This protects you from MEV and ensures your intent stays hidden until verified.
            </p>
          </div>
        </div>
      ),
    },
    {
      title: "Transactions are private",
      description: "Amounts and balances stay hidden",
      icon: Lock,
      content: (
        <div className="space-y-4">
          <p className="text-zinc-300">
            Use stealth transfers to hide amounts on-chain. Only commitments are visible.
          </p>
          <div className="p-4 rounded-lg bg-violet-950/20 border border-violet-500/30">
            <p className="text-sm text-violet-300">
              <strong>Powered by Garaga Groth16</strong> verifier for confidential transactions.
            </p>
          </div>
        </div>
      ),
    },
    {
      title: "Selective disclosure",
      description: "Prove compliance without revealing history",
      icon: Eye,
      content: (
        <div className="space-y-4">
          <p className="text-zinc-300">
            Generate proofs that show you meet requirements without exposing your full transaction history.
          </p>
          <div className="p-4 rounded-lg bg-cyan-950/20 border border-cyan-500/30">
            <p className="text-sm text-cyan-300">
              Perfect for KYC, compliance checks, and proving solvency to lenders.
            </p>
          </div>
        </div>
      ),
    },
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    setOnboardingCompleted(true);
    setIsOpen(false);
  };

  const handleSkip = () => {
    setOnboardingCompleted(true);
    setIsOpen(false);
  };

  if (!isOpen) return null;

  const Icon = steps[currentStep].icon;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleSkip}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="glass rounded-2xl border border-zinc-800 p-8 w-full max-w-lg">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  {steps.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 rounded-full transition-all ${
                        i <= currentStep ? "bg-emerald-500 w-8" : "bg-zinc-700 w-1.5"
                      }`}
                    />
                  ))}
                </div>
                <button
                  onClick={handleSkip}
                  className="text-zinc-400 hover:text-zinc-200 transition-colors"
                  aria-label="Skip"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="text-center mb-8">
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-center mb-6"
                >
                  <div className="w-20 h-20 rounded-full bg-emerald-600/20 flex items-center justify-center">
                    <Icon className="w-10 h-10 text-emerald-400" />
                  </div>
                </motion.div>

                <motion.div
                  key={`content-${currentStep}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <h2 className="text-2xl font-bold mb-2">{steps[currentStep].title}</h2>
                  <p className="text-zinc-400 mb-6">{steps[currentStep].description}</p>
                  {steps[currentStep].content}
                </motion.div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={handleSkip}
                  className="flex-1 px-4 py-3 border border-zinc-600 hover:bg-zinc-800 rounded-lg font-medium transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={handleNext}
                  className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-emerald-500/20 flex items-center justify-center gap-2"
                >
                  {currentStep < steps.length - 1 ? (
                    <>
                      Next
                      <ArrowRight className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      Get Started
                      <CheckCircle2 className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>

              {/* Don't show again checkbox */}
              <div className="mt-6 flex items-center justify-center gap-2">
                <input
                  type="checkbox"
                  id="dont-show"
                  checked={onboardingCompleted}
                  onChange={(e) => {
                    if (e.target.checked) {
                      handleComplete();
                    }
                  }}
                  className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="dont-show" className="text-xs text-zinc-400 cursor-pointer">
                  Don't show this again
                </label>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
