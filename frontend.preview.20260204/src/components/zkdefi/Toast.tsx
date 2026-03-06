"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { subscribe, dismiss, getToasts, type Toast } from "@/lib/toast";

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    setToasts(getToasts());
    const unsubscribe = subscribe(setToasts);
    return unsubscribe;
  }, []);

  const icons = {
    success: CheckCircle2,
    error: AlertCircle,
    info: Info,
    warning: AlertTriangle,
  };

  const colors = {
    success: "bg-emerald-600/90 border-emerald-500",
    error: "bg-red-600/90 border-red-500",
    info: "bg-cyan-600/90 border-cyan-500",
    warning: "bg-amber-600/90 border-amber-500",
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-md">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = icons[toast.type];
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.95 }}
              className={`glass rounded-lg border ${colors[toast.type]} p-4 shadow-lg`}
            >
              <div className="flex items-start gap-3">
                <Icon className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{toast.message}</p>
                  {toast.action && (
                    <button
                      onClick={toast.action.onClick}
                      className="mt-2 text-xs font-medium text-white underline hover:no-underline"
                    >
                      {toast.action.label}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="shrink-0 text-white/70 hover:text-white transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
