'use client';

import React, { useState, useEffect } from 'react';
import { Eye } from 'lucide-react';

interface ConfidentialTransferForm {
  recipient_address: string;
  amount: string;
  commitment_value: string;
}

interface TransferResponse {
  status: string;
  transaction_ready: boolean;
  transaction_hash?: string;
  fee?: number;
  fee_token?: string;
  message?: string;
  error?: string;
}

export const MVPConfidentialTransfer: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<TransferResponse | null>(null);
  const [contractAddress, setContractAddress] = useState('');
  const [formData, setFormData] = useState<ConfidentialTransferForm>({
    recipient_address: '',
    amount: '',
    commitment_value: ''
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAddress = async () => {
      try {
        const res = await fetch('/api/v1/phase4a/contracts');
        const data = await res.json();
        setContractAddress(data.confidential_transfer_address || '');
      } catch (err) {
        console.error('Failed to fetch contract address:', err);
      }
    };

    fetchAddress();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch('/api/v1/phase4a/transfer/confidential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_address: formData.recipient_address,
          amount: formData.amount,
          commitment_value: formData.commitment_value
        })
      });

      const data: TransferResponse = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to initiate transfer');
      } else {
        setResponse(data);
        setFormData({ recipient_address: '', amount: '', commitment_value: '' });
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
        <h3 className="text-lg font-bold flex items-center gap-2 text-white">
          <Eye className="w-5 h-5 text-emerald-400" />
          Confidential Transfer
        </h3>
        <p className="text-sm text-zinc-400 mt-1">💰 Amount hidden via Pedersen commitments</p>
      </div>

      <form onSubmit={handleSubmit} className="p-5 rounded-lg border border-zinc-700 bg-zinc-900/30 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1 uppercase">Recipient</label>
          <input
            type="text"
            name="recipient_address"
            value={formData.recipient_address}
            onChange={handleInputChange}
            placeholder="0x..."
            required
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1 uppercase">Amount (Hidden)</label>
          <input
            type="number"
            name="amount"
            value={formData.amount}
            onChange={handleInputChange}
            placeholder="0.0"
            step="0.000001"
            required
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1 uppercase">Commitment (Optional)</label>
          <input
            type="text"
            name="commitment_value"
            value={formData.commitment_value}
            onChange={handleInputChange}
            placeholder="Auto-generated if empty"
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {error && <div className="p-3 rounded bg-red-900/20 border border-red-700/30"><p className="text-xs text-red-400">{error}</p></div>}

        {response && (
          <div className="p-3 rounded bg-emerald-900/20 border border-emerald-700/30">
            <p className="text-xs font-bold text-emerald-400">{response.transaction_ready ? '✓ Ready' : '⏳ Processing'}</p>
            <p className="text-xs text-emerald-300">{response.message || response.status}</p>
            {response.fee && <p className="text-xs text-emerald-300 mt-1">Fee: {response.fee} {response.fee_token || 'STRK'}</p>}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white font-semibold text-sm rounded transition-colors"
        >
          {loading ? 'Processing...' : 'Transfer'}
        </button>
      </form>
    </div>
  );
};
