"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { privacyVaultService } from "@/services/PrivacyVaultService";
import { PrivacyPoolPanel } from "./PrivacyPoolPanel";

interface PrivacySidebarProps {
  userAddress: string | null;
}

interface ShieldedPool {
  token: string;
  amount: number;
  commitment_count: number;
}

export function PrivacySidebar({ userAddress }: PrivacySidebarProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [totalShielded, setTotalShielded] = useState(0);
  const [pools, setPools] = useState<ShieldedPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  useEffect(() => {
    if (!userAddress) return;
    let cancelled = false;
    setLoading(true);
    privacyVaultService
      .getShieldedBalance(userAddress)
      .then((data) => {
        if (cancelled) return;
        setTotalShielded(data.total_shielded_usd);
        setPools(data.pools);
      })
      .catch(() => {
        if (!cancelled) {
          setTotalShielded(0);
          setPools([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userAddress]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  if (!userAddress) return null;

  return (
    <>
      <div
        className={`flex flex-col bg-slate-900 border-l border-slate-700 transition-all ${
          collapsed ? "w-10" : "w-56"
        }`}
      >
        {/* Toggle */}
        <button
          onClick={toggle}
          className="flex items-center justify-center py-3 hover:bg-slate-800 transition-colors"
        >
          {collapsed ? (
            <ChevronLeft className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {/* Collapsed icon */}
        {collapsed && (
          <div className="flex flex-col items-center gap-2 py-4">
            <Shield className="w-4 h-4 text-violet-400" />
            <span className="text-[10px] text-slate-500 [writing-mode:vertical-lr]">
              Privacy
            </span>
          </div>
        )}

        {/* Expanded content */}
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col gap-3 px-3 pb-3 overflow-y-auto"
            >
              <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-violet-400" />
                Shielded Balance
              </h4>

              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-500 mx-auto" />
              ) : (
                <>
                  <div className="text-lg font-bold text-violet-300">
                    ${Number(totalShielded).toFixed(2)}
                  </div>
                  <div className="space-y-1">
                    {pools.map((p) => (
                      <div
                        key={p.token}
                        className="flex justify-between text-xs px-2 py-1.5 bg-slate-800 rounded border border-slate-700"
                      >
                        <span className="text-slate-300">{p.token}</span>
                        <span className="font-medium">{Number(p.amount).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setShowPanel(true)}
                  className="flex-1 py-1.5 text-xs font-medium bg-violet-700 hover:bg-violet-600 rounded transition-colors"
                >
                  Deposit
                </button>
                <button
                  onClick={() => setShowPanel(true)}
                  className="flex-1 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Withdraw
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modal overlay for PrivacyPoolPanel */}
      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowPanel(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 rounded-xl border border-slate-700 p-4 w-full max-w-md shadow-xl"
            >
              <PrivacyPoolPanel
                userAddress={userAddress}
                onSuccess={() => setShowPanel(false)}
                onError={() => {}}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
