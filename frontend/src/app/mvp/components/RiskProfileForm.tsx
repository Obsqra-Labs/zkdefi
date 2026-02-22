'use client';

import { useState } from 'react';
import { useAccount } from '@starknet-react/core';

interface RiskProfile {
  id: 'conservative' | 'balanced' | 'aggressive';
  label: string;
  description: string;
  icon: string;
  color: string;
  minApy: number;
  maxApy: number;
}

const profiles: RiskProfile[] = [
  {
    id: 'conservative',
    label: 'Conservative',
    description: 'Low risk, stable yields 3-8% APY',
    icon: '🛡️',
    color: 'green',
    minApy: 3,
    maxApy: 8,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Moderate risk, mixed yields 10-18% APY',
    icon: '⚖️',
    color: 'yellow',
    minApy: 10,
    maxApy: 18,
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    description: 'High risk, high yields 25-50% APY',
    icon: '🚀',
    color: 'red',
    minApy: 25,
    maxApy: 50,
  },
];

interface RiskProfileFormProps {
  onSubmit: (data: {
    amount: number;
    riskProfile: 'conservative' | 'balanced' | 'aggressive';
  }) => void;
  isLoading?: boolean;
}

export function RiskProfileForm({ onSubmit, isLoading = false }: RiskProfileFormProps) {
  const { address } = useAccount();
  const [amount, setAmount] = useState(1000);
  const [selectedProfile, setSelectedProfile] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [errors, setErrors] = useState<{ amount?: string }>({});

  const handleSubmit = () => {
    // Validate
    const newErrors: { amount?: string } = {};

    if (!amount || amount <= 0) {
      newErrors.amount = 'Amount must be greater than 0';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (!address) {
      setErrors({ amount: 'Please connect your wallet first' });
      return;
    }

    setErrors({});
    onSubmit({
      amount,
      riskProfile: selectedProfile,
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-2">Yield Optimization Vault</h1>
        <p className="text-gray-600">Deposit tokens and let AI optimize your yield</p>
      </div>

      {/* Amount Input */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <label className="block text-sm font-bold text-gray-900">Deposit Amount</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={amount}
            onChange={(e) => {
              setAmount(parseFloat(e.target.value));
              setErrors({});
            }}
            disabled={isLoading}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
            placeholder="1000"
          />
          <span className="text-lg font-bold text-gray-900 min-w-16">STRK</span>
        </div>
        {errors.amount && (
          <p className="text-sm text-red-600 font-medium">{errors.amount}</p>
        )}
        {!address && (
          <p className="text-sm text-orange-600 font-medium">⚠️ Connect your wallet first</p>
        )}
      </div>

      {/* Risk Profile Selection */}
      <div className="space-y-4">
        <label className="block text-sm font-bold text-gray-900">Select Risk Profile</label>
        <div className="grid grid-cols-3 gap-4">
          {profiles.map((profile) => {
            const isSelected = selectedProfile === profile.id;
            const colorMap: Record<string, string> = {
              green: 'border-green-500 bg-green-50',
              yellow: 'border-yellow-500 bg-yellow-50',
              red: 'border-red-500 bg-red-50',
            };
            const selectedColor = colorMap[profile.color];

            return (
              <button
                key={profile.id}
                onClick={() => {
                  setSelectedProfile(profile.id);
                  setErrors({});
                }}
                disabled={isLoading}
                className={`p-4 rounded-lg border-2 transition transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected ? `border-2 ${selectedColor}` : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <div className="text-4xl mb-2">{profile.icon}</div>
                <div className="font-bold text-sm text-gray-900">{profile.label}</div>
                <div className="text-xs text-gray-600 mt-2">{profile.description}</div>
                <div className="text-xs font-mono text-gray-500 mt-1">
                  {profile.minApy}-{profile.maxApy}% APY
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Profile Details */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-6">
        <h3 className="font-bold text-gray-900 mb-3">Your Profile</h3>
        {profiles.map((p) => {
          if (p.id !== selectedProfile) return null;
          return (
            <div key={p.id} className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-700">Risk Level:</span>
                <span className="font-bold text-gray-900">
                  {p.id === 'conservative' ? '🟢 Low' : p.id === 'balanced' ? '🟡 Moderate' : '🔴 High'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-700">Expected APY:</span>
                <span className="font-bold text-gray-900">{p.minApy}-{p.maxApy}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-700">Primary Strategy:</span>
                <span className="font-bold text-gray-900">
                  {p.id === 'conservative' ? '70% Lending / 30% LP' : p.id === 'balanced' ? '50% / 50%' : '20% Lending / 80% LP'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={isLoading || !address}
        className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 px-6 rounded-lg transition transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2">
            <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
            Analyzing Pools...
          </div>
        ) : !address ? (
          'Connect Wallet First'
        ) : (
          'Analyze & Get Recommendation'
        )}
      </button>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
        <p className="font-medium mb-1">💡 How it works:</p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Select your risk profile and deposit amount</li>
          <li>Our AI analyzes available pools</li>
          <li>You get a personalized recommendation</li>
          <li>Confirm and capital is deployed</li>
          <li>Earn yield automatically</li>
        </ol>
      </div>
    </div>
  );
}
