// AgentPerformanceStore: On-chain agent performance history and attestation
//
// Stores per-agent performance snapshots (returns, volumes, proof counts)
// that feed the AgentReputationScore circuit and the HistoricalPerformanceAttestation circuit.
// Enables provable performance claims — agents generate ZK proofs
// over their on-chain history to build reputation without revealing specifics.

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct PerformanceSnapshot {
    pub agent_id: u256,
    pub period: u64,                // Epoch/period identifier
    pub return_bps: i64,            // Signed return in basis points
    pub volume: u128,               // Trade volume in period
    pub proof_count: u32,           // Number of ZK proofs generated
    pub successful_actions: u32,    // Successful rebalances/trades
    pub failed_actions: u32,        // Failed actions
    pub max_drawdown_bps: u16,      // Period max drawdown in bps
    pub timestamp: u64,
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct AgentStats {
    pub agent_id: u256,
    pub total_volume: u128,
    pub total_periods: u32,
    pub total_proofs: u64,
    pub total_successful: u64,
    pub total_failed: u64,
    pub cumulative_return_bps: i64,
    pub peak_balance: u128,
    pub worst_drawdown_bps: u16,
    pub last_updated: u64,
}

#[starknet::interface]
pub trait IAgentPerformanceStore<TContractState> {
    // Record new performance data
    fn record_snapshot(
        ref self: TContractState,
        agent_id: u256,
        period: u64,
        return_bps: i64,
        volume: u128,
        proof_count: u32,
        successful_actions: u32,
        failed_actions: u32,
        max_drawdown_bps: u16,
    );

    // Query performance
    fn get_snapshot(self: @TContractState, agent_id: u256, period: u64) -> PerformanceSnapshot;
    fn get_agent_stats(self: @TContractState, agent_id: u256) -> AgentStats;
    fn get_recent_snapshots(self: @TContractState, agent_id: u256, count: u32) -> Array<PerformanceSnapshot>;
    fn get_period_count(self: @TContractState, agent_id: u256) -> u32;

    // Attestation support — prepare witness data for circuits
    fn get_performance_witness(
        self: @TContractState,
        agent_id: u256,
        num_periods: u32,
    ) -> (Array<i64>, Array<u128>);  // (returns, balances)

    // Leaderboard
    fn get_top_agents_by_volume(self: @TContractState, limit: u32) -> Array<u256>;
    fn get_top_agents_by_return(self: @TContractState, limit: u32) -> Array<u256>;

    // Admin
    fn set_authorized_recorder(ref self: TContractState, address: ContractAddress, authorized: bool);
}

#[starknet::contract]
mod AgentPerformanceStore {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use core::num::traits::Zero;
    use super::{PerformanceSnapshot, AgentStats};

    const MAX_SNAPSHOTS: u32 = 365;   // ~1 year of daily snapshots
    const MAX_LEADERBOARD: u32 = 50;

    #[storage]
    struct Storage {
        // Per-agent snapshots: (agent_id, index) → snapshot
        snapshots: Map<(u256, u32), PerformanceSnapshot>,
        snapshot_count: Map<u256, u32>,

        // Period → index mapping for random access
        period_to_index: Map<(u256, u64), u32>,

        // Aggregate stats
        agent_stats: Map<u256, AgentStats>,
        stats_exists: Map<u256, bool>,

        // Volume leaderboard: rank → agent_id
        volume_leaderboard: Map<u32, u256>,
        volume_leaderboard_count: u32,

        // Return leaderboard: rank → agent_id
        return_leaderboard: Map<u32, u256>,
        return_leaderboard_count: u32,

        // Access control
        authorized_recorders: Map<ContractAddress, bool>,
        admin: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        SnapshotRecorded: SnapshotRecorded,
        StatsUpdated: StatsUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct SnapshotRecorded {
        #[key]
        agent_id: u256,
        period: u64,
        return_bps: i64,
        volume: u128,
    }

    #[derive(Drop, starknet::Event)]
    struct StatsUpdated {
        #[key]
        agent_id: u256,
        total_periods: u32,
        cumulative_return_bps: i64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
        self.volume_leaderboard_count.write(0);
        self.return_leaderboard_count.write(0);
    }

    #[abi(embed_v0)]
    impl AgentPerformanceStoreImpl of super::IAgentPerformanceStore<ContractState> {
        fn record_snapshot(
            ref self: ContractState,
            agent_id: u256,
            period: u64,
            return_bps: i64,
            volume: u128,
            proof_count: u32,
            successful_actions: u32,
            failed_actions: u32,
            max_drawdown_bps: u16,
        ) {
            let caller = get_caller_address();
            assert!(
                self.authorized_recorders.read(caller) || caller == self.admin.read(),
                "Not authorized to record"
            );

            let now = get_block_timestamp();
            let idx = self.snapshot_count.read(agent_id);
            assert!(idx < MAX_SNAPSHOTS, "Max snapshot history reached");

            let snapshot = PerformanceSnapshot {
                agent_id,
                period,
                return_bps,
                volume,
                proof_count,
                successful_actions,
                failed_actions,
                max_drawdown_bps,
                timestamp: now,
            };

            self.snapshots.write((agent_id, idx), snapshot);
            self.period_to_index.write((agent_id, period), idx);
            self.snapshot_count.write(agent_id, idx + 1);

            // Update aggregate stats
            let mut stats = if self.stats_exists.read(agent_id) {
                self.agent_stats.read(agent_id)
            } else {
                self.stats_exists.write(agent_id, true);
                AgentStats {
                    agent_id,
                    total_volume: 0,
                    total_periods: 0,
                    total_proofs: 0,
                    total_successful: 0,
                    total_failed: 0,
                    cumulative_return_bps: 0,
                    peak_balance: 0,
                    worst_drawdown_bps: 0,
                    last_updated: 0,
                }
            };

            stats.total_volume += volume;
            stats.total_periods += 1;
            stats.total_proofs += proof_count.into();
            stats.total_successful += successful_actions.into();
            stats.total_failed += failed_actions.into();
            stats.cumulative_return_bps += return_bps;
            if max_drawdown_bps > stats.worst_drawdown_bps {
                stats.worst_drawdown_bps = max_drawdown_bps;
            }
            stats.last_updated = now;
            self.agent_stats.write(agent_id, stats);

            self.emit(SnapshotRecorded { agent_id, period, return_bps, volume });
            self.emit(StatsUpdated {
                agent_id,
                total_periods: stats.total_periods,
                cumulative_return_bps: stats.cumulative_return_bps,
            });
        }

        fn get_snapshot(self: @ContractState, agent_id: u256, period: u64) -> PerformanceSnapshot {
            let idx = self.period_to_index.read((agent_id, period));
            self.snapshots.read((agent_id, idx))
        }

        fn get_agent_stats(self: @ContractState, agent_id: u256) -> AgentStats {
            assert!(self.stats_exists.read(agent_id), "No stats for agent");
            self.agent_stats.read(agent_id)
        }

        fn get_recent_snapshots(
            self: @ContractState, agent_id: u256, count: u32
        ) -> Array<PerformanceSnapshot> {
            let total = self.snapshot_count.read(agent_id);
            let start = if total > count { total - count } else { 0 };
            let mut result: Array<PerformanceSnapshot> = ArrayTrait::new();
            let mut i = start;
            while i < total {
                result.append(self.snapshots.read((agent_id, i)));
                i += 1;
            };
            result
        }

        fn get_period_count(self: @ContractState, agent_id: u256) -> u32 {
            self.snapshot_count.read(agent_id)
        }

        fn get_performance_witness(
            self: @ContractState,
            agent_id: u256,
            num_periods: u32,
        ) -> (Array<i64>, Array<u128>) {
            let total = self.snapshot_count.read(agent_id);
            let start = if total > num_periods { total - num_periods } else { 0 };
            let mut returns: Array<i64> = ArrayTrait::new();
            let mut balances: Array<u128> = ArrayTrait::new();

            // Reconstruct running balance from returns
            let mut running_balance: u128 = 10000; // Base 10000 = 100.00%
            let mut i = start;
            while i < total {
                let snap = self.snapshots.read((agent_id, i));
                returns.append(snap.return_bps);
                // Adjust balance: balance *= (1 + return_bps/10000)
                if snap.return_bps >= 0 {
                    let ret_u: u128 = snap.return_bps.try_into().unwrap();
                    running_balance = running_balance + (running_balance * ret_u / 10000);
                } else {
                    let neg_ret: u128 = (-snap.return_bps).try_into().unwrap();
                    let loss = running_balance * neg_ret / 10000;
                    if loss < running_balance {
                        running_balance = running_balance - loss;
                    } else {
                        running_balance = 0;
                    }
                }
                balances.append(running_balance);
                i += 1;
            };

            (returns, balances)
        }

        fn get_top_agents_by_volume(self: @ContractState, limit: u32) -> Array<u256> {
            let count = self.volume_leaderboard_count.read();
            let actual = if count > limit { limit } else { count };
            let mut result: Array<u256> = ArrayTrait::new();
            let mut i: u32 = 0;
            while i < actual {
                result.append(self.volume_leaderboard.read(i));
                i += 1;
            };
            result
        }

        fn get_top_agents_by_return(self: @ContractState, limit: u32) -> Array<u256> {
            let count = self.return_leaderboard_count.read();
            let actual = if count > limit { limit } else { count };
            let mut result: Array<u256> = ArrayTrait::new();
            let mut i: u32 = 0;
            while i < actual {
                result.append(self.return_leaderboard.read(i));
                i += 1;
            };
            result
        }

        fn set_authorized_recorder(
            ref self: ContractState, address: ContractAddress, authorized: bool
        ) {
            let caller = get_caller_address();
            assert!(caller == self.admin.read(), "Only admin");
            self.authorized_recorders.write(address, authorized);
        }
    }
}
