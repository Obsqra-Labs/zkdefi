'use client';

import React, { useState, useEffect } from 'react';
import { Lock, Zap } from 'lucide-react';

interface ProofGatedLPForm {
  token_a: string;
  token_b: string;
  amount: string;
  proof: string | File;
}

interface LPResponse {
  status: string;
  transaction_ready: boolean;
  transaction_hash?: string;
  proof_gated_agent_address?: string;
  confidential_transfer_address?: string;
  message?: string;
  error?: string;
}

export const MVPProofGatedLP: React.FC = () => {
  const [proofGatedEnabled, setProofGatedEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<LPResponse | null>(null);
  const [contractAddresses, setContractAddresses] = useState({
    proofGatedAgent: '',
    confidentialTransfer: ''
  });
  const [formData, setFormData] = useState<ProofGatedLPForm>({
    token_a: '',
    token_b: '',
    amount: '',
    proof: ''
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAddresses = async () => {
      try {
        const res = await fetch('/api/v1/phase4a/contracts');
        const data = await res.json();
        setContractAddresses({
          proofGatedAgent: data.proof_gated_agent_address || '',
          confidentialTransfer: data.confidential_transfer_address || ''
        });
      } catch (err) {
        console.error('Failed to fetch contract addresses:', err);
      }
    };

    fetchAddresses();
  }, []);

  const handleToggleProofGated = () => {
    setProofGatedEnabled(!proofGatedEnabled);
    setResponse(null);
    setError(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFormData(prev => ({
        ...prev,
        proof: e.target.files![0]
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const formDataToSend = new FormData();
      formDataToSend.append('token_a', formData.token_a);
      formDataToSend.append('token_b', formData.token_b);
      formDataToSend.append('amount', formData.amount);

      if (formData.proof instanceof File) {
        formDataToSend.append('proof', formData.proof);
      } else {
        formDataToSend.append('proof', formData.proof);
      }

      const res = await fetch('/api/v1/phase4a/lp-position/create', {
        method: 'POST',
        body: formDataToSend
      });

      const data: LPResponse = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create proof-gated LP position');
      } else {
        setResponse(data);
        setFormData({
          token_a: '',
          token_b: '',
          amount: '',
          proof: ''
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-lg border border-zinc-700 bg-zinc-900/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2 text-white">
              <Lock className="w-5 h-5 text-violet-400" />
              Proof-Gated LP
            </h3>
            <p className="text-sm text-zinc-400 mt-1">
              {proofGatedEnabled
                ? '🔒 Privacy-preserving with zk proofs'
                : '🔓 Enable for proof verification'}
            </p>
          </div>
          <button
            onClick={handleToggleProofGated}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
              proofGatedEnabled ? 'bg-violet-600' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-zinc-950 transition-transform ${
                proofGatedEnabled ? 'translate-x-7' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {proofGatedEnabled ? (
        <form onSubmit={handleSubmit} className="p-5 rounded-lg border border-zinc-700 bg-zinc-900/30 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1 uppercase">Token A</label>
            <input
              type="text"
              name="token_a"
              value={formData.token_a}
              onChange={handleInputChange}
              placeholder="0x..."
              required
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1 uppercase">Token B</label>
            <input
              type="text"
              name="token_b"
              value={formData.token_b}
              onChange={handleInputChange}
              placeholder="0x..."
              required
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1 uppercase">Amount</label>
            <input
              type="number"
              name="amount"
              value={formData.amount}
              onChange={handleInputChange}
              placeholder="0.0"
              step="0.000001"
              required
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1 uppercase">Proof</label>
            <input
              type="text"
              name="proof"
              value={typeof formData.proof === 'string' ? formData.proof : ''}
              onChange={handleInputChange}
              placeholder="Paste proof or upload file"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-violet-500 mb-2"
            />
            <input
              type="file"
              onChange={handleFileChange}
              accept=".txt,.json,.proof"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-zinc-400 text-xs"
            />
          </div>

          {error && <div className="p-3 rounded bg-red-900/20 border border-red-700/30"><p className="text-xs text-red-400">{error}</p></div>}

          {response && (
            <div className="p-3 rounded bg-emerald-900/20 border border-emerald-700/30">
              <p className="text-xs font-bold text-emerald-400">{response.transaction_ready ? '✓ Ready' : '⏳ Processing'}</p>
              <p className="text-xs text-emerald-300">{response.message || response.status}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 text-white font-semibold text-sm rounded transition-colors"
          >
            {loading ? 'Creating...' : 'Create Position'}
          </button>
        </form>
      ) : null}
    </div>
  );
};
