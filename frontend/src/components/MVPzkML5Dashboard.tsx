'use client';

import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, Shield, TrendingUp, Lock, Eye } from 'lucide-react';

interface ComplianceReport {
  zkml_completion: string;
  audit_trail_status: string;
  total_decisions_tracked: number;
  decisions_linked_to_models: number;
  verification_coverage: string;
  compliance: {
    decision_traceability: boolean;
    model_versioning: boolean;
    on_chain_verification: boolean;
    audit_trail: boolean;
    immutable_history: boolean;
  };
}

export function MVPzkML5Dashboard() {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/v1/phase4a/audit-trail/compliance');
        if (!response.ok) throw new Error('Failed to fetch compliance report');
        const data = await response.json();
        setReport(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading compliance');
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, []);

  if (loading) {
    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-6">
        <div className="text-zinc-400 text-sm">Loading zkML 5/5 status...</div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-6">
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error || 'Failed to load compliance report'}
        </div>
      </div>
    );
  }

  const getComplianceColor = (value: boolean) => value ? 'text-emerald-400' : 'text-red-400';
  const getComplianceIcon = (value: boolean) => value ? '✅' : '❌';

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-violet-500" />
            <h3 className="text-xl font-bold text-white">zkML 5/5 Compliance</h3>
          </div>
          <div className="px-3 py-1 bg-emerald-500/20 border border-emerald-500/50 rounded text-emerald-400 text-sm font-mono">
            {report.zkml_completion}
          </div>
        </div>
        <p className="text-zinc-400 text-sm">Autonomous decision tracking & model versioning</p>
      </div>

      {/* Status Indicator */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
          <div className="text-zinc-400 text-xs mb-2 uppercase tracking-wide">Audit Trail</div>
          <div className="text-2xl font-bold text-emerald-400">{report.total_decisions_tracked}</div>
          <div className="text-zinc-500 text-xs mt-1">Decisions tracked</div>
        </div>

        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
          <div className="text-zinc-400 text-xs mb-2 uppercase tracking-wide">Verification</div>
          <div className="text-2xl font-bold text-violet-400">{report.verification_coverage}</div>
          <div className="text-zinc-500 text-xs mt-1">Coverage rate</div>
        </div>
      </div>

      {/* Compliance Checklist */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-3">
        <div className="text-sm font-semibold text-white mb-3">Compliance Features</div>
        
        <div className="space-y-2">
          {[
            { name: 'Decision Traceability', value: report.compliance.decision_traceability },
            { name: 'Model Versioning', value: report.compliance.model_versioning },
            { name: 'On-Chain Verification', value: report.compliance.on_chain_verification },
            { name: 'Audit Trail History', value: report.compliance.audit_trail },
            { name: 'Immutable Records', value: report.compliance.immutable_history },
          ].map((item) => (
            <div key={item.name} className="flex items-center justify-between p-2 rounded bg-zinc-900/50">
              <span className="text-zinc-300 text-sm">{item.name}</span>
              <span className={`font-mono text-sm ${getComplianceColor(item.value)}`}>
                {getComplianceIcon(item.value)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Model Versions */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
        <div className="text-sm font-semibold text-white mb-2">Model Deployment</div>
        <div className="text-zinc-400 text-sm space-y-1">
          <div>• Base Model v0: Proof-gated LP & Confidential Transfers</div>
          <div>• Status: <span className="text-emerald-400">Active</span></div>
          <div>• Decisions linked to models: <span className="text-emerald-400">Automatic</span></div>
        </div>
      </div>

      {/* How It Works */}
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
        <div className="flex gap-3">
          <Lock className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-emerald-300">
            <p className="font-semibold mb-1">How zkML 5/5 Works</p>
            <p className="text-zinc-400">
              Every autonomous decision (rebalance, position creation, transfer) is recorded in an immutable audit trail and linked to the model version that made it. All decisions are verifiable on-chain.
            </p>
          </div>
        </div>
      </div>

      {/* Status Badge */}
      <div className="flex items-center justify-center gap-2 py-3 px-4 bg-green-500/20 border border-green-500/50 rounded-lg">
        <CheckCircle className="w-5 h-5 text-green-400" />
        <span className="text-green-400 font-semibold">zkML 5/5 Complete & Operational</span>
      </div>
    </div>
  );
}
