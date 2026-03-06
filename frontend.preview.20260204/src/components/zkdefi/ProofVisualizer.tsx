"use client";

import { Shield, CheckCircle2, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type ProofState = "idle" | "generating" | "valid" | "error";

interface ProofVisualizerProps {
  state: ProofState;
  progress?: number; // 0-100
  step?: string; // Current step description
  error?: string;
}

const steps = [
  "Creating witness",
  "Generating proof",
  "Verifying locally",
  "Preparing transaction",
];

export function ProofVisualizer({
  state,
  progress = 0,
  step,
  error,
}: ProofVisualizerProps) {
  const currentStepIndex = step
    ? steps.findIndex((s) => step.toLowerCase().includes(s.toLowerCase()))
    : -1;

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-6">
      {/* Shield Icon with Animation */}
      <div className="relative w-24 h-24">
        <AnimatePresence mode="wait">
          {state === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 0.3, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Shield className="w-24 h-24 text-zinc-700" />
            </motion.div>
          )}

          {state === "generating" && (
            <motion.div
              key="generating"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <motion.div
                animate={{
                  scale: [1, 1.1, 1],
                  opacity: [0.7, 1, 0.7],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                <Shield className="w-24 h-24 text-proof-generating" />
              </motion.div>
              <motion.div
                className="absolute inset-0 border-4 border-proof-generating rounded-full"
                animate={{
                  rotate: 360,
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "linear",
                }}
                style={{
                  clipPath: `polygon(50% 0%, 50% 0%, 50% ${100 - progress}%, 50% ${100 - progress}%)`,
                }}
              />
            </motion.div>
          )}

          {state === "valid" && (
            <motion.div
              key="valid"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                }}
              >
                <div className="relative">
                  <Shield className="w-24 h-24 text-proof-valid" />
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <CheckCircle2 className="w-12 h-12 text-proof-valid" />
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {state === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Shield className="w-24 h-24 text-red-500" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Progress Text */}
      <div className="text-center space-y-2 min-h-[60px]">
        <AnimatePresence mode="wait">
          {state === "idle" && (
            <motion.p
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-sm text-zinc-400"
            >
              Ready to generate proof
            </motion.p>
          )}

          {state === "generating" && (
            <motion.div
              key="generating"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-2"
            >
              <p className="text-lg font-medium text-proof-generating">
                Generating zero-knowledge proof...
              </p>
              {step && (
                <p className="text-sm text-zinc-400">{step}</p>
              )}
              {progress > 0 && (
                <div className="w-64 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-proof-generating"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}
              {currentStepIndex >= 0 && (
                <div className="flex gap-2 justify-center mt-4">
                  {steps.map((s, i) => (
                    <div
                      key={s}
                      className={`h-1.5 rounded-full transition-all ${
                        i <= currentStepIndex
                          ? "bg-proof-generating w-8"
                          : "bg-zinc-700 w-1.5"
                      }`}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {state === "valid" && (
            <motion.div
              key="valid"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <p className="text-lg font-medium text-proof-valid">
                Proof ready!
              </p>
              <p className="text-sm text-zinc-400">
                Your proof has been generated and verified
              </p>
            </motion.div>
          )}

          {state === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <p className="text-lg font-medium text-red-500">
                Proof generation failed
              </p>
              {error && (
                <p className="text-sm text-zinc-400">{error}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
