"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

export function RiskDisclosure() {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // Only show if risk was acknowledged BUT user hasn't completed onboarding
    // This catches users who dismissed the old popup but didn't sign
    const acknowledged = localStorage.getItem("risk-acknowledged");
    const onboardingComplete = localStorage.getItem("onboarding-complete");
    
    // Don't show modal anymore - risk disclosure is now part of onboarding wizard
    // This component is kept for backwards compatibility
    setShowModal(false);
  }, []);

  const handleAcknowledge = () => {
    localStorage.setItem("risk-acknowledged", "true");
    setShowModal(false);
  };

  if (!showModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Risk Disclosure</h2>
          </div>

          <div className="space-y-4 text-sm text-zinc-300">
            <p className="font-medium text-white">
              Please read and acknowledge the following before using zkde.fi:
            </p>

            <div className="space-y-3">
              <div className="flex gap-2">
                <span className="text-amber-400 font-bold">1.</span>
                <p><strong>Loss of funds:</strong> You could lose your entire investment. Cryptocurrency prices are highly volatile and can drop to zero.</p>
              </div>

              <div className="flex gap-2">
                <span className="text-amber-400 font-bold">2.</span>
                <p><strong>Experimental software:</strong> This application is experimental and has not been formally audited. Smart contracts may contain bugs.</p>
              </div>

              <div className="flex gap-2">
                <span className="text-amber-400 font-bold">3.</span>
                <p><strong>Irreversible transactions:</strong> Blockchain transactions cannot be reversed. Mistakes cannot be undone.</p>
              </div>

              <div className="flex gap-2">
                <span className="text-amber-400 font-bold">4.</span>
                <p><strong>No regulatory protection:</strong> Cryptocurrency is not legal tender. Your funds are not protected by deposit insurance or compensation schemes.</p>
              </div>

              <div className="flex gap-2">
                <span className="text-amber-400 font-bold">5.</span>
                <p><strong>Key responsibility:</strong> You are solely responsible for securing your wallet and private keys. Lost keys cannot be recovered.</p>
              </div>

              <div className="flex gap-2">
                <span className="text-amber-400 font-bold">6.</span>
                <p><strong>No financial advice:</strong> Nothing in this application constitutes financial, legal, or tax advice. Do your own research.</p>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mt-4">
              <p className="text-amber-200 font-medium">
                Only use funds you can afford to lose entirely.
              </p>
            </div>
          </div>

          <button
            onClick={handleAcknowledge}
            className="w-full mt-6 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors"
          >
            I understand and accept the risks
          </button>

          <p className="text-xs text-zinc-500 text-center mt-4">
            By clicking above, you acknowledge that you have read and understood these risks.
          </p>
        </div>
      </div>
    </div>
  );
}
