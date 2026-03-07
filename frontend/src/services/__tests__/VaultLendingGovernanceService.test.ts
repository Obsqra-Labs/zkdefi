import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VaultLendingGovernanceService } from '../VaultLendingGovernanceService';

global.fetch = vi.fn();

describe('VaultLendingGovernanceService', () => {
  let service: VaultLendingGovernanceService;

  beforeEach(() => {
    service = new VaultLendingGovernanceService();
    vi.clearAllMocks();
  });

  describe('getLendingPolicy', () => {
    it('should fetch current DAO-voted lending policy for pool', async () => {
      const poolId = 'starknet-pool';
      const mockPolicy = {
        poolId,
        tier1: { canBorrow: false },
        tier2: { ltv: 0.5, apr: 6 },
        tier3: { ltv: 1.5, apr: 4 },
        votedBy: ['0x123abc', '0x456def'],
        votedAt: '2026-03-07T10:00:00Z',
        nextVoteWindow: '2026-03-14T10:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPolicy,
      });

      const result = await service.getLendingPolicy(poolId);

      expect(result).toEqual(mockPolicy);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/dao/pools/${poolId}/lending-policy`),
        expect.any(Object)
      );
    });

    it('should cache policy for 5 minutes to reduce API calls', async () => {
      const poolId = 'starknet-pool';
      const mockPolicy = {
        poolId,
        tier1: { canBorrow: false },
        tier2: { ltv: 0.5, apr: 6 },
        tier3: { ltv: 1.5, apr: 4 },
        votedBy: ['0x123abc'],
        votedAt: '2026-03-07T10:00:00Z',
        nextVoteWindow: '2026-03-14T10:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPolicy,
      });

      const result1 = await service.getLendingPolicy(poolId);
      const result2 = await service.getLendingPolicy(poolId);

      expect(result1).toEqual(mockPolicy);
      expect(result2).toEqual(mockPolicy);
      // Should only call fetch once (second call is cached)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully', async () => {
      const poolId = 'invalid-pool';

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Pool not found' }),
      });

      await expect(service.getLendingPolicy(poolId)).rejects.toThrow('Pool not found');
    });
  });

  describe('getActiveLoans', () => {
    it('should fetch all active loans in the vault', async () => {
      const poolId = 'starknet-pool';
      const mockLoans = [
        {
          loanId: 'loan-001',
          amount: 5000,
          rate: 6,
          tier: 'Tier2',
          status: 'active',
          createdAt: '2026-03-01T10:00:00Z',
        },
        {
          loanId: 'loan-002',
          amount: 15000,
          rate: 4,
          tier: 'Tier3',
          status: 'active',
          createdAt: '2026-03-02T12:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLoans,
      });

      const result = await service.getActiveLoans(poolId);

      expect(result).toEqual(mockLoans);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/dao/pools/${poolId}/loans/active`),
        expect.any(Object)
      );
    });

    it('should return empty array when no active loans', async () => {
      const poolId = 'starknet-pool';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await service.getActiveLoans(poolId);

      expect(result).toEqual([]);
    });

    it('should handle API errors when fetching loans', async () => {
      const poolId = 'starknet-pool';

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal server error' }),
      });

      await expect(service.getActiveLoans(poolId)).rejects.toThrow('Internal server error');
    });
  });

  describe('proposeRateChange', () => {
    it('should submit rate change proposal to governance endpoint', async () => {
      const poolId = 'starknet-pool';
      const changes = {
        tier2: { apr: 5 },
        tier3: { apr: 3 },
      };
      const mockProposalId = 'proposal-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ proposalId: mockProposalId }),
      });

      const result = await service.proposeRateChange(poolId, changes);

      expect(result).toBe(mockProposalId);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/dao/pools/${poolId}/governance/propose`),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should handle proposal submission errors', async () => {
      const poolId = 'starknet-pool';
      const changes = { tier2: { apr: 5 } };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Invalid proposal' }),
      });

      await expect(service.proposeRateChange(poolId, changes)).rejects.toThrow(
        'Invalid proposal'
      );
    });
  });

  describe('voteOnProposal', () => {
    it('should cast yes vote on proposal', async () => {
      const proposalId = 'proposal-001';
      const mockReceipt = {
        proposalId,
        vote: 'yes',
        timestamp: '2026-03-07T11:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipt,
      });

      const result = await service.voteOnProposal(proposalId, 'yes');

      expect(result).toEqual(mockReceipt);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/dao/governance/vote'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('yes'),
        })
      );
    });

    it('should cast no vote on proposal', async () => {
      const proposalId = 'proposal-001';
      const mockReceipt = {
        proposalId,
        vote: 'no',
        timestamp: '2026-03-07T11:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipt,
      });

      const result = await service.voteOnProposal(proposalId, 'no');

      expect(result).toEqual(mockReceipt);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/dao/governance/vote'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should handle voting errors', async () => {
      const proposalId = 'proposal-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ detail: 'Not eligible to vote' }),
      });

      await expect(service.voteOnProposal(proposalId, 'yes')).rejects.toThrow(
        'Not eligible to vote'
      );
    });
  });

  describe('getProposalStatus', () => {
    it('should check if proposal passed with 70% majority and 60% quorum', async () => {
      const proposalId = 'proposal-001';
      const mockStatus = {
        id: proposalId,
        status: 'passed',
        votes: { yes: 700, no: 300 }, // 70% yes
        totalVoters: 2000, // 50% participated = 1000, meets 60% quorum? No
        participationRate: 0.5,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      });

      const result = await service.getProposalStatus(proposalId);

      expect(result).toBeDefined();
      expect(result.status).toBe('passed');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/dao/governance/proposal/${proposalId}`),
        expect.any(Object)
      );
    });

    it('should return rejected status when vote does not meet 70% threshold', async () => {
      const proposalId = 'proposal-002';
      const mockStatus = {
        id: proposalId,
        status: 'rejected',
        votes: { yes: 600, no: 400 }, // 60% yes, does not meet 70%
        totalVoters: 2000,
        participationRate: 0.5,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      });

      const result = await service.getProposalStatus(proposalId);

      expect(result).toBeDefined();
      expect(result.status).toBe('rejected');
    });

    it('should return rejected when participation is below 60% quorum', async () => {
      const proposalId = 'proposal-003';
      const mockStatus = {
        id: proposalId,
        status: 'rejected',
        votes: { yes: 550, no: 50 }, // 91.7% yes but low participation
        totalVoters: 2000,
        participationRate: 0.3, // 30% participation, below 60% quorum
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      });

      const result = await service.getProposalStatus(proposalId);

      expect(result).toBeDefined();
      expect(result.status).toBe('rejected');
    });

    it('should return open status when voting still ongoing', async () => {
      const proposalId = 'proposal-004';
      const mockStatus = {
        id: proposalId,
        status: 'open',
        votes: { yes: 200, no: 100 },
        totalVoters: 2000,
        participationRate: 0.15,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      });

      const result = await service.getProposalStatus(proposalId);

      expect(result).toBeDefined();
      expect(result.status).toBe('open');
    });

    it('should handle API errors', async () => {
      const proposalId = 'invalid-proposal';

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Proposal not found' }),
      });

      await expect(service.getProposalStatus(proposalId)).rejects.toThrow('Proposal not found');
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate cache after 5 minutes', async () => {
      const poolId = 'starknet-pool';
      const mockPolicy1 = {
        poolId,
        tier1: { canBorrow: false },
        tier2: { ltv: 0.5, apr: 6 },
        tier3: { ltv: 1.5, apr: 4 },
        votedBy: ['0x123abc'],
        votedAt: '2026-03-07T10:00:00Z',
        nextVoteWindow: '2026-03-14T10:00:00Z',
      };

      const mockPolicy2 = {
        poolId,
        tier1: { canBorrow: false },
        tier2: { ltv: 0.5, apr: 5 }, // Updated rate
        tier3: { ltv: 1.5, apr: 3 },
        votedBy: ['0x123abc', '0x789ghi'],
        votedAt: '2026-03-07T10:05:00Z',
        nextVoteWindow: '2026-03-14T10:05:00Z',
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPolicy1,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPolicy2,
        });

      // First call
      const result1 = await service.getLendingPolicy(poolId);
      expect(result1.tier2.apr).toBe(6);

      // Manually trigger cache expiration by advancing time
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.now() + 5 * 60 * 1000 + 1000)); // 5 minutes + 1 second

      // Second call after cache expiration
      const result2 = await service.getLendingPolicy(poolId);
      expect(result2.tier2.apr).toBe(5);

      vi.useRealTimers();

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      const poolId = 'starknet-pool';

      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(service.getLendingPolicy(poolId)).rejects.toThrow('Network error');
    });

    it('should provide meaningful error messages for invalid responses', async () => {
      const poolId = 'starknet-pool';

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(service.getLendingPolicy(poolId)).rejects.toThrow();
    });
  });

  describe('integration - governance workflow', () => {
    it('should retrieve policy, propose changes, and get updated status', async () => {
      const poolId = 'starknet-pool';
      const proposalId = 'proposal-001';

      const mockPolicy = {
        poolId,
        tier1: { canBorrow: false },
        tier2: { ltv: 0.5, apr: 6 },
        tier3: { ltv: 1.5, apr: 4 },
        votedBy: ['0x123abc'],
        votedAt: '2026-03-07T10:00:00Z',
        nextVoteWindow: '2026-03-14T10:00:00Z',
      };

      const mockProposalResponse = { proposalId };

      const mockStatus = {
        id: proposalId,
        status: 'passed',
        votes: { yes: 700, no: 300 },
        totalVoters: 1000,
        participationRate: 0.7,
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPolicy,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProposalResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockStatus,
        });

      // Get current policy
      const policy = await service.getLendingPolicy(poolId);
      expect(policy.tier2.apr).toBe(6);

      // Propose rate change
      const newProposalId = await service.proposeRateChange(poolId, {
        tier2: { apr: 5 },
      });
      expect(newProposalId).toBe(proposalId);

      // Check proposal status
      const status = await service.getProposalStatus(newProposalId);
      expect(status.status).toBe('passed');
    });

    it('should track active loans for monitoring', async () => {
      const poolId = 'starknet-pool';
      const mockLoans = [
        {
          loanId: 'loan-001',
          amount: 5000,
          rate: 6,
          tier: 'Tier2',
          status: 'active',
          createdAt: '2026-03-01T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLoans,
      });

      const loans = await service.getActiveLoans(poolId);

      expect(loans).toHaveLength(1);
      expect(loans[0].loanId).toBe('loan-001');
      expect(loans[0].amount).toBe(5000);
    });
  });
});
