/**
 * Phase 4A Dashboard - zkdefi
 * Proof-Gated LP Positions & Confidential Transfers
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Contract {
  id: string;
  name: string;
  address: string;
  purpose: string;
  features: string[];
  starkscan: string;
}

interface Phase4AData {
  network: string;
  contracts: Contract[];
  dependencies: {
    garaga_verifier: { address: string; starkscan: string };
    integrity_registry: { address: string; starkscan: string };
  };
}

interface Phase4AStatus {
  phase: string;
  status: string;
  network: string;
  contracts_deployed: number;
  features: string[];
}

export function Phase4ADashboard() {
  const [data, setData] = useState<Phase4AData | null>(null);
  const [status, setStatus] = useState<Phase4AStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [contractsRes, statusRes] = await Promise.all([
          fetch('/api/v1/phase4a/contracts'),
          fetch('/api/v1/phase4a/status'),
        ]);

        if (!contractsRes.ok || !statusRes.ok) {
          throw new Error('Failed to fetch Phase 4A data');
        }

        const contractsData = await contractsRes.json();
        const statusData = await statusRes.json();

        setData(contractsData);
        setStatus(statusData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-700 font-semibold">Error loading Phase 4A</p>
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Phase 4A</h1>
            <p className="text-purple-100 mt-2">
              Proof-Gated LP Positions & Confidential Transfers
            </p>
          </div>
          <div className="text-right">
            <div className="inline-block bg-green-500 text-white px-4 py-2 rounded-full font-semibold">
              🟢 {status?.status.replace(/_/g, ' ')}
            </div>
            <p className="text-purple-100 mt-2 text-sm">
              {status?.network} • {status?.contracts_deployed} Contracts
            </p>
          </div>
        </div>
      </div>

      {/* Contracts Grid */}
      {data && (
        <div>
          <h2 className="text-2xl font-bold mb-4">Deployed Contracts</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {data.contracts.map((contract) => (
              <div
                key={contract.id}
                className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
              >
                <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-4 border-b border-gray-200">
                  <h3 className="text-xl font-bold text-gray-900">
                    {contract.name}
                  </h3>
                  <p className="text-gray-600 text-sm mt-1">{contract.purpose}</p>
                </div>

                <div className="p-4 space-y-4">
                  {/* Address */}
                  <div>
                    <p className="text-gray-600 text-sm font-semibold mb-1">
                      Address
                    </p>
                    <div className="bg-gray-50 p-2 rounded font-mono text-xs break-all text-gray-700">
                      {contract.address}
                    </div>
                  </div>

                  {/* Features */}
                  <div>
                    <p className="text-gray-600 text-sm font-semibold mb-2">
                      Features
                    </p>
                    <ul className="space-y-1">
                      {contract.features.map((feature, idx) => (
                        <li
                          key={idx}
                          className="text-sm text-gray-700 flex items-start"
                        >
                          <span className="text-purple-600 mr-2">✓</span>
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Starkscan Link */}
                  <a
                    href={contract.starkscan}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded text-center text-sm transition-colors"
                  >
                    View on Starkscan ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Features List */}
      {status && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
          <h2 className="text-2xl font-bold mb-4 text-purple-900">
            Phase 4A Features
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {status.features.map((feature, idx) => (
              <div
                key={idx}
                className="bg-white border border-purple-200 rounded-lg p-4"
              >
                <div className="flex items-center space-x-2 mb-2">
                  <span className="text-purple-600 text-2xl">🔐</span>
                  <p className="font-semibold text-gray-900">{feature}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-blue-900 mb-4">Quick Links</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <a
            href="https://sepolia.starkscan.io/contract/0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-blue-600 hover:text-blue-700 font-semibold"
          >
            ProofGatedLpAgent on Starkscan ↗
          </a>
          <a
            href="https://sepolia.starkscan.io/contract/0x0100e1adbb92bb61bf3338a1da17a1bc31022321df2370f4f24a9120fb0e28b3"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-blue-600 hover:text-blue-700 font-semibold"
          >
            ConfidentialTransfer on Starkscan ↗
          </a>
        </div>
      </div>
    </div>
  );
}
