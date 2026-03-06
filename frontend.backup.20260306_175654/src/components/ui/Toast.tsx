"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check, AlertTriangle, X } from "lucide-react";

export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  duration?: number;
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg min-w-[320px] max-w-md bg-zinc-900"
            style={{
              borderColor:
                toast.type === "success"
                  ? "rgb(52 211 153 / 0.3)"
                  : toast.type === "error"
                  ? "rgb(239 68 68 / 0.3)"
                  : "rgb(161 161 170 / 0.3)",
            }}
          >
            {toast.type === "success" && <Check className="w-5 h-5 text-emerald-400 shrink-0" />}
            {toast.type === "error" && <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />}
            <span className="flex-1 text-sm text-zinc-200">{toast.message}</span>
            <button
              onClick={() => onRemove(toast.id)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
