/**
 * Universal Identity Service
 * 
 * Creates privacy-preserving identity commitments that link addresses
 * across chains without revealing the mapping publicly.
 * 
 * Flow:
 * 1. User proves ownership of addresses on each chain (signatures)
 * 2. Generate secret salt (stored locally, encrypted)
 * 3. Compute identity commitment = hash(addresses + salt)
 * 4. Submit to backend for RISC Zero credit proof generation
 * 5. Register commitment + tier on-chain
 */

import { poseidonHash } from './poseidon';

// Types
interface LinkedAddresses {
  ethereum?: string;
  starknet: string;
  arbitrum?: string;
  optimism?: string;
  base?: string;
}

interface ChainSignature {
  chain: string;
  address: string;
  signature: string;
  message: string;
}

interface IdentityData {
  commitment: string;
  addresses: LinkedAddresses;
  salt: string;
  signatures: ChainSignature[];
  createdAt: number;
  version: number;
}

interface CreditProofResult {
  commitment: string;
  tier: 'AAA' | 'AA' | 'A' | 'B' | 'C';
  score: number;
  proof: string[];
  factors: string[];
}

// Constants
const IDENTITY_STORAGE_KEY = 'zkdefi_identity';
const IDENTITY_VERSION = 1;
const LINK_MESSAGE = 'Link to zkde.fi Universal Identity';

/**
 * UniversalIdentity - Manages cross-chain identity commitments
 */
export class UniversalIdentity {
  private apiBaseUrl: string;

  constructor(apiBaseUrl: string = '/api/v1') {
    this.apiBaseUrl = apiBaseUrl;
  }

  /**
   * Create a new universal identity commitment
   * Links multiple chain addresses into a single privacy-preserving commitment
   */
  async createIdentity(
    addresses: LinkedAddresses,
    signMessage: (chain: string, message: string) => Promise<string>
  ): Promise<IdentityData> {
    // 1. Generate signatures on each chain to prove ownership
    const signatures: ChainSignature[] = [];

    // Starknet is required
    const starknetSig = await signMessage('starknet', LINK_MESSAGE);
    signatures.push({
      chain: 'starknet',
      address: addresses.starknet,
      signature: starknetSig,
      message: LINK_MESSAGE,
    });

    // Optional: Ethereum
    if (addresses.ethereum) {
      try {
        const ethSig = await signMessage('ethereum', LINK_MESSAGE);
        signatures.push({
          chain: 'ethereum',
          address: addresses.ethereum,
          signature: ethSig,
          message: LINK_MESSAGE,
        });
      } catch (e) {
        console.warn('Ethereum signature skipped:', e);
      }
    }

    // Optional: Other chains
    for (const chain of ['arbitrum', 'optimism', 'base'] as const) {
      const addr = addresses[chain];
      if (addr) {
        try {
          const sig = await signMessage(chain, LINK_MESSAGE);
          signatures.push({
            chain,
            address: addr,
            signature: sig,
            message: LINK_MESSAGE,
          });
        } catch (e) {
          console.warn(`${chain} signature skipped:`, e);
        }
      }
    }

    // 2. Generate secret salt
    const salt = this.generateSalt();

    // 3. Compute identity commitment
    const commitment = this.computeCommitment(addresses, salt);

    // 4. Create identity data
    const identityData: IdentityData = {
      commitment,
      addresses,
      salt,
      signatures,
      createdAt: Date.now(),
      version: IDENTITY_VERSION,
    };

    // 5. Store locally (encrypted in production)
    this.storeIdentity(identityData);

    return identityData;
  }

  /**
   * Load existing identity from local storage
   */
  loadIdentity(): IdentityData | null {
    try {
      const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);
      if (!stored) return null;

      const data = JSON.parse(stored) as IdentityData;
      if (data.version !== IDENTITY_VERSION) {
        console.warn('Identity version mismatch, migration needed');
        return null;
      }

      return data;
    } catch (e) {
      console.error('Failed to load identity:', e);
      return null;
    }
  }

  /**
   * Check if user has an existing identity
   */
  hasIdentity(): boolean {
    return this.loadIdentity() !== null;
  }

  /**
   * Get the identity commitment if exists
   */
  getCommitment(): string | null {
    const identity = this.loadIdentity();
    return identity?.commitment ?? null;
  }

  /**
   * Generate credit proof using RISC Zero
   * Aggregates cross-chain history privately and returns tier
   */
  async generateCreditProof(identity?: IdentityData): Promise<CreditProofResult> {
    const id = identity ?? this.loadIdentity();
    if (!id) {
      throw new Error('No identity found. Create identity first.');
    }

    // Call backend to generate RISC Zero proof
    const response = await fetch(`${this.apiBaseUrl}/identity/credit-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commitment: id.commitment,
        addresses: id.addresses,
        signatures: id.signatures,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Credit proof generation failed');
    }

    return await response.json();
  }

  /**
   * Register identity and credit tier on-chain
   */
  async registerOnChain(
    proof: CreditProofResult,
    execute: (calldata: any) => Promise<string>
  ): Promise<string> {
    // Get calldata for registration
    const calldataResponse = await fetch(`${this.apiBaseUrl}/identity/register-calldata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commitment: proof.commitment,
        tier: proof.tier,
        proof: proof.proof,
      }),
    });

    if (!calldataResponse.ok) {
      const error = await calldataResponse.json();
      throw new Error(error.detail || 'Failed to prepare registration calldata');
    }

    const calldata = await calldataResponse.json();

    // Execute transaction
    const txHash = await execute(calldata);
    return txHash;
  }

  /**
   * Clear local identity (for logout/reset)
   */
  clearIdentity(): void {
    localStorage.removeItem(IDENTITY_STORAGE_KEY);
  }

  // Private methods

  private generateSalt(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return '0x' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private computeCommitment(addresses: LinkedAddresses, salt: string): string {
    // Convert addresses to field elements for Poseidon hash
    const inputs: bigint[] = [];

    // Add addresses in deterministic order
    inputs.push(this.addressToField(addresses.starknet));
    inputs.push(this.addressToField(addresses.ethereum || '0x0'));
    inputs.push(this.addressToField(addresses.arbitrum || '0x0'));
    inputs.push(this.addressToField(addresses.optimism || '0x0'));
    inputs.push(this.addressToField(addresses.base || '0x0'));
    inputs.push(BigInt(salt));

    // Compute Poseidon hash
    const hash = poseidonHash(inputs);
    return '0x' + hash.toString(16).padStart(64, '0');
  }

  private addressToField(address: string): bigint {
    if (!address || address === '0x0') return BigInt(0);
    return BigInt(address);
  }

  private storeIdentity(data: IdentityData): void {
    // In production, this should be encrypted
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(data));
  }
}

// Singleton instance
let _identityService: UniversalIdentity | null = null;

export function getIdentityService(apiBaseUrl?: string): UniversalIdentity {
  if (!_identityService) {
    _identityService = new UniversalIdentity(apiBaseUrl);
  }
  return _identityService;
}

// React hook-friendly exports
export function useIdentity() {
  const service = getIdentityService();
  return {
    hasIdentity: () => service.hasIdentity(),
    getCommitment: () => service.getCommitment(),
    loadIdentity: () => service.loadIdentity(),
    createIdentity: service.createIdentity.bind(service),
    generateCreditProof: service.generateCreditProof.bind(service),
    registerOnChain: service.registerOnChain.bind(service),
    clearIdentity: () => service.clearIdentity(),
  };
}
