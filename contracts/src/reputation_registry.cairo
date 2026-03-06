// Reputation Registry: Manages user reputation tiers and proof requirements.
// Tier 0 (Strict): Full ZKML proof per action, limited access
// Tier 1 (Standard): Constraint-bounded, setup proof only
// Tier 2 (Express): Optimistic + batched proofs, collateral required

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, PartialEq, starknet::Store)]
pub enum ProofTier {
    Strict,   // 0: Full proof per action, limited access
    Standard, // 1: Constraint-bounded, standard access
    Express,  // 2: Optimistic + batched, full access
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct UserStats {
    pub transaction_count: u64,
    pub total_volume: u256,
    pub first_interaction: u64,  // Unix timestamp
    pub last_interaction: u64,   // Unix timestamp
    pub successful_txns: u64,
    pub failed_txns: u64,
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct TierLimits {
    pub max_deposits_per_day: u8,
    pub max_withdrawals_per_day: u8,
    pub max_position: u256,
    pub relayer_delay_seconds: u64,
    pub protocol_fee_bps: u16,
}

#[starknet::interface]
pub trait IFactRegistry<TContractState> {
    fn is_valid(self: @TContractState, fact_hash: felt252) -> bool;
}

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IReputationRegistry<TContractState> {
    // Tier management
    fn get_user_tier(self: @TContractState, user: ContractAddress) -> ProofTier;
    fn get_tier_limits(self: @TContractState, tier: ProofTier) -> TierLimits;
    
    // Reputation proofs
    fn register_reputation_proofs(ref self: TContractState, fact_hashes: Array<felt252>);
    fn get_user_reputation_proofs(self: @TContractState, user: ContractAddress) -> Array<felt252>;
    
    // Tier transitions
    fn request_tier_upgrade(ref self: TContractState, upgrade_proof: felt252);
    fn downgrade_tier(ref self: TContractState, user: ContractAddress, reason: felt252);
    fn opt_into_strict(ref self: TContractState);  // User can always choose max trustlessness
    
    // Collateral (for Tier 2)
    fn stake_collateral(ref self: TContractState, amount: u256);
    fn unstake_collateral(ref self: TContractState, amount: u256);
    fn get_user_collateral(self: @TContractState, user: ContractAddress) -> u256;
    fn slash_collateral(ref self: TContractState, user: ContractAddress, amount: u256, recipient: ContractAddress);
    
    // Stats tracking
    fn record_transaction(ref self: TContractState, user: ContractAddress, volume: u256, success: bool);
    fn get_user_stats(self: @TContractState, user: ContractAddress) -> UserStats;
    
    // Daily limits tracking
    fn get_daily_deposit_count(self: @TContractState, user: ContractAddress) -> u8;
    fn get_daily_withdrawal_count(self: @TContractState, user: ContractAddress) -> u8;
    fn increment_daily_deposit(ref self: TContractState, user: ContractAddress);
    fn increment_daily_withdrawal(ref self: TContractState, user: ContractAddress);
    
    // Access checks
    fn can_use_relayer(self: @TContractState, user: ContractAddress) -> bool;
    fn get_relayer_delay(self: @TContractState, user: ContractAddress) -> u64;
    fn check_position_limit(self: @TContractState, user: ContractAddress, new_position: u256) -> bool;
    
    // Admin
    fn set_tier_limits(ref self: TContractState, tier: ProofTier, limits: TierLimits);
    fn set_minimum_collateral(ref self: TContractState, amount: u256);
    
    // Discoverable scoring (ERC-8004 alignment)
    fn get_reputation_score(self: @TContractState, user: ContractAddress) -> u16;
    fn get_top_users(self: @TContractState, limit: u32) -> Array<ContractAddress>;
    fn get_user_rank(self: @TContractState, user: ContractAddress) -> u64;
    fn get_users_by_tier(self: @TContractState, tier: ProofTier) -> Array<ContractAddress>;
    fn get_total_users(self: @TContractState) -> u64;
    
    // v6: Collaborative credit graph
    fn set_collaborative_score(
        ref self: TContractState,
        user: ContractAddress,
        multiplier_bps: u16,    // 10000 = 1.0x, 20000 = 2.0x
        graph_hash: felt252,    // Hash of the credit graph snapshot used
    );
    fn get_collaborative_score(self: @TContractState, user: ContractAddress) -> u16;
    fn get_graph_hash(self: @TContractState, user: ContractAddress) -> felt252;
}

#[starknet::contract]
mod ReputationRegistry {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    
    use super::{ProofTier, UserStats, TierLimits};
    use super::IFactRegistryDispatcher;
    use super::IFactRegistryDispatcherTrait;
    use super::IERC20Dispatcher;
    use super::IERC20DispatcherTrait;
    
    // Constants
    const SECONDS_PER_DAY: u64 = 86400;
    const TIER1_MIN_TENURE_DAYS: u64 = 30;
    const TIER1_MIN_TXNS: u64 = 5;
    const TIER2_MIN_TENURE_DAYS: u64 = 180;
    
    #[storage]
    struct Storage {
        // Core registry
        fact_registry: ContractAddress,
        collateral_token: ContractAddress,
        admin: ContractAddress,
        
        // User tiers
        user_tier: Map<ContractAddress, ProofTier>,
        
        // Reputation proofs (user -> index -> fact_hash)
        user_proof_count: Map<ContractAddress, u64>,
        user_proofs: Map<(ContractAddress, u64), felt252>,
        
        // Collateral
        user_collateral: Map<ContractAddress, u256>,
        minimum_collateral: u256,
        
        // Stats
        user_stats: Map<ContractAddress, UserStats>,
        
        // Daily limits (user -> day_number -> count)
        daily_deposits: Map<(ContractAddress, u64), u8>,
        daily_withdrawals: Map<(ContractAddress, u64), u8>,
        
        // Tier limits
        tier_strict_limits: TierLimits,
        tier_standard_limits: TierLimits,
        tier_express_limits: TierLimits,
        
        // User tracking for discovery (ERC-8004 alignment)
        all_users: Map<u64, ContractAddress>,
        user_index: Map<ContractAddress, u64>,
        total_user_count: u64,
        tier_users: Map<(u8, u64), ContractAddress>,
        tier_user_count: Map<u8, u64>,
        user_scores: Map<ContractAddress, u16>,
        // v6: Collaborative credit multipliers
        collaborative_multiplier_bps: Map<ContractAddress, u16>,
        collaborative_graph_hash: Map<ContractAddress, felt252>,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        TierUpgraded: TierUpgraded,
        TierDowngraded: TierDowngraded,
        CollateralStaked: CollateralStaked,
        CollateralUnstaked: CollateralUnstaked,
        CollateralSlashed: CollateralSlashed,
        ReputationProofRegistered: ReputationProofRegistered,
    }
    
    #[derive(Drop, starknet::Event)]
    struct TierUpgraded {
        #[key]
        user: ContractAddress,
        from_tier: ProofTier,
        to_tier: ProofTier,
        upgrade_proof: felt252,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct TierDowngraded {
        #[key]
        user: ContractAddress,
        from_tier: ProofTier,
        to_tier: ProofTier,
        reason: felt252,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct CollateralStaked {
        #[key]
        user: ContractAddress,
        amount: u256,
        total: u256,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct CollateralUnstaked {
        #[key]
        user: ContractAddress,
        amount: u256,
        remaining: u256,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct CollateralSlashed {
        #[key]
        user: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ReputationProofRegistered {
        #[key]
        user: ContractAddress,
        fact_hash: felt252,
        proof_index: u64,
        timestamp: u64,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        fact_registry: ContractAddress,
        collateral_token: ContractAddress,
        admin: ContractAddress,
        minimum_collateral: u256
    ) {
        self.fact_registry.write(fact_registry);
        self.collateral_token.write(collateral_token);
        self.admin.write(admin);
        self.minimum_collateral.write(minimum_collateral);
        
        // Set default tier limits
        // Tier 0 (Strict): Limited access
        self.tier_strict_limits.write(TierLimits {
            max_deposits_per_day: 2,
            max_withdrawals_per_day: 1,
            max_position: 10_000000000000000000_u256, // 10 ETH
            relayer_delay_seconds: 0, // No relayer access
            protocol_fee_bps: 50, // 0.5%
        });
        
        // Tier 1 (Standard): Standard access
        self.tier_standard_limits.write(TierLimits {
            max_deposits_per_day: 10,
            max_withdrawals_per_day: 5,
            max_position: 50_000000000000000000_u256, // 50 ETH
            relayer_delay_seconds: 3600, // 1 hour delay
            protocol_fee_bps: 30, // 0.3%
        });
        
        // Tier 2 (Express): Full access
        self.tier_express_limits.write(TierLimits {
            max_deposits_per_day: 255, // Effectively unlimited
            max_withdrawals_per_day: 255,
            max_position: 0, // 0 = unlimited
            relayer_delay_seconds: 1, // Instant (1 second for safety)
            protocol_fee_bps: 10, // 0.1%
        });
    }
    
    #[abi(embed_v0)]
    impl ReputationRegistryImpl of super::IReputationRegistry<ContractState> {
        fn get_user_tier(self: @ContractState, user: ContractAddress) -> ProofTier {
            self.user_tier.read(user)
        }
        
        fn get_tier_limits(self: @ContractState, tier: ProofTier) -> TierLimits {
            match tier {
                ProofTier::Strict => self.tier_strict_limits.read(),
                ProofTier::Standard => self.tier_standard_limits.read(),
                ProofTier::Express => self.tier_express_limits.read(),
            }
        }
        
        fn register_reputation_proofs(ref self: ContractState, fact_hashes: Array<felt252>) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            let registry = IFactRegistryDispatcher { contract_address: self.fact_registry.read() };
            
            let mut current_count = self.user_proof_count.read(caller);
            
            let mut i: u32 = 0;
            loop {
                if i >= fact_hashes.len() {
                    break;
                }
                
                let fact_hash = *fact_hashes.at(i);
                
                // Verify proof is valid in Integrity
                assert(registry.is_valid(fact_hash), 'Invalid proof in Integrity');
                
                // Store the proof
                self.user_proofs.write((caller, current_count), fact_hash);
                current_count += 1;
                
                self.emit(ReputationProofRegistered {
                    user: caller,
                    fact_hash,
                    proof_index: current_count - 1,
                    timestamp,
                });
                
                i += 1;
            };
            
            self.user_proof_count.write(caller, current_count);
            
            // Initialize user stats if first interaction
            let stats = self.user_stats.read(caller);
            if stats.first_interaction == 0 {
                self.user_stats.write(caller, UserStats {
                    transaction_count: 0,
                    total_volume: 0,
                    first_interaction: timestamp,
                    last_interaction: timestamp,
                    successful_txns: 0,
                    failed_txns: 0,
                });
            }
        }
        
        fn get_user_reputation_proofs(self: @ContractState, user: ContractAddress) -> Array<felt252> {
            let count = self.user_proof_count.read(user);
            let mut proofs = array![];
            
            let mut i: u64 = 0;
            loop {
                if i >= count {
                    break;
                }
                proofs.append(self.user_proofs.read((user, i)));
                i += 1;
            };
            
            proofs
        }
        
        fn request_tier_upgrade(ref self: ContractState, upgrade_proof: felt252) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            let current_tier = self.user_tier.read(caller);
            
            // Verify upgrade proof in Integrity
            let registry = IFactRegistryDispatcher { contract_address: self.fact_registry.read() };
            assert(registry.is_valid(upgrade_proof), 'Invalid upgrade proof');
            
            let stats = self.user_stats.read(caller);
            let tenure_days = (timestamp - stats.first_interaction) / SECONDS_PER_DAY;
            
            let new_tier = match current_tier {
                ProofTier::Strict => {
                    // Upgrade to Standard requires: tenure > 30 days, 5+ successful txns
                    assert(tenure_days >= TIER1_MIN_TENURE_DAYS, 'Insufficient tenure for Tier 1');
                    assert(stats.successful_txns >= TIER1_MIN_TXNS, 'Insufficient txns for Tier 1');
                    ProofTier::Standard
                },
                ProofTier::Standard => {
                    // Upgrade to Express requires: tenure > 180 days, collateral staked
                    assert(tenure_days >= TIER2_MIN_TENURE_DAYS, 'Insufficient tenure for Tier 2');
                    let collateral = self.user_collateral.read(caller);
                    let min_collateral = self.minimum_collateral.read();
                    assert(collateral >= min_collateral, 'Insufficient collateral');
                    ProofTier::Express
                },
                ProofTier::Express => {
                    // Already at max tier
                    ProofTier::Express
                },
            };
            
            if new_tier != current_tier {
                self.user_tier.write(caller, new_tier);
                
                self.emit(TierUpgraded {
                    user: caller,
                    from_tier: current_tier,
                    to_tier: new_tier,
                    upgrade_proof,
                    timestamp,
                });
            }
        }
        
        fn downgrade_tier(ref self: ContractState, user: ContractAddress, reason: felt252) {
            let caller = get_caller_address();
            let admin = self.admin.read();
            assert(caller == admin, 'Only admin can downgrade');
            
            let current_tier = self.user_tier.read(user);
            let new_tier = ProofTier::Strict;
            
            self.user_tier.write(user, new_tier);
            
            self.emit(TierDowngraded {
                user,
                from_tier: current_tier,
                to_tier: new_tier,
                reason,
                timestamp: get_block_timestamp(),
            });
        }
        
        fn opt_into_strict(ref self: ContractState) {
            let caller = get_caller_address();
            let current_tier = self.user_tier.read(caller);
            
            self.user_tier.write(caller, ProofTier::Strict);
            
            self.emit(TierDowngraded {
                user: caller,
                from_tier: current_tier,
                to_tier: ProofTier::Strict,
                reason: 'user_opted_strict',
                timestamp: get_block_timestamp(),
            });
        }
        
        fn stake_collateral(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let ok = token.transfer_from(caller, starknet::get_contract_address(), amount);
            assert(ok, 'Collateral transfer failed');
            
            let current = self.user_collateral.read(caller);
            let new_total = current + amount;
            self.user_collateral.write(caller, new_total);
            
            self.emit(CollateralStaked {
                user: caller,
                amount,
                total: new_total,
                timestamp,
            });
        }
        
        fn unstake_collateral(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            let current = self.user_collateral.read(caller);
            assert(current >= amount, 'Insufficient collateral');
            
            let new_total = current - amount;
            self.user_collateral.write(caller, new_total);
            
            // If tier is Express and collateral drops below minimum, downgrade
            let tier = self.user_tier.read(caller);
            let min_collateral = self.minimum_collateral.read();
            if tier == ProofTier::Express && new_total < min_collateral {
                self.user_tier.write(caller, ProofTier::Standard);
                
                self.emit(TierDowngraded {
                    user: caller,
                    from_tier: ProofTier::Express,
                    to_tier: ProofTier::Standard,
                    reason: 'insufficient_collateral',
                    timestamp,
                });
            }
            
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let ok = token.transfer(caller, amount);
            assert(ok, 'Collateral return failed');
            
            self.emit(CollateralUnstaked {
                user: caller,
                amount,
                remaining: new_total,
                timestamp,
            });
        }
        
        fn get_user_collateral(self: @ContractState, user: ContractAddress) -> u256 {
            self.user_collateral.read(user)
        }
        
        fn slash_collateral(ref self: ContractState, user: ContractAddress, amount: u256, recipient: ContractAddress) {
            let caller = get_caller_address();
            let admin = self.admin.read();
            assert(caller == admin, 'Only admin can slash');
            
            let current = self.user_collateral.read(user);
            let slash_amount = if amount > current { current } else { amount };
            
            self.user_collateral.write(user, current - slash_amount);
            
            // Downgrade to Strict
            let current_tier = self.user_tier.read(user);
            self.user_tier.write(user, ProofTier::Strict);
            
            // Transfer slashed amount
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            token.transfer(recipient, slash_amount);
            
            self.emit(CollateralSlashed {
                user,
                amount: slash_amount,
                recipient,
                timestamp: get_block_timestamp(),
            });
            
            self.emit(TierDowngraded {
                user,
                from_tier: current_tier,
                to_tier: ProofTier::Strict,
                reason: 'collateral_slashed',
                timestamp: get_block_timestamp(),
            });
        }
        
        fn record_transaction(ref self: ContractState, user: ContractAddress, volume: u256, success: bool) {
            let timestamp = get_block_timestamp();
            let mut stats = self.user_stats.read(user);
            
            stats.transaction_count += 1;
            stats.total_volume = stats.total_volume + volume;
            stats.last_interaction = timestamp;
            
            if success {
                stats.successful_txns += 1;
            } else {
                stats.failed_txns += 1;
            }
            
            if stats.first_interaction == 0 {
                stats.first_interaction = timestamp;
            }
            
            self.user_stats.write(user, stats);
        }
        
        fn get_user_stats(self: @ContractState, user: ContractAddress) -> UserStats {
            self.user_stats.read(user)
        }
        
        fn get_daily_deposit_count(self: @ContractState, user: ContractAddress) -> u8 {
            let day = get_block_timestamp() / SECONDS_PER_DAY;
            self.daily_deposits.read((user, day))
        }
        
        fn get_daily_withdrawal_count(self: @ContractState, user: ContractAddress) -> u8 {
            let day = get_block_timestamp() / SECONDS_PER_DAY;
            self.daily_withdrawals.read((user, day))
        }
        
        fn increment_daily_deposit(ref self: ContractState, user: ContractAddress) {
            let day = get_block_timestamp() / SECONDS_PER_DAY;
            let current = self.daily_deposits.read((user, day));
            self.daily_deposits.write((user, day), current + 1);
        }
        
        fn increment_daily_withdrawal(ref self: ContractState, user: ContractAddress) {
            let day = get_block_timestamp() / SECONDS_PER_DAY;
            let current = self.daily_withdrawals.read((user, day));
            self.daily_withdrawals.write((user, day), current + 1);
        }
        
        fn can_use_relayer(self: @ContractState, user: ContractAddress) -> bool {
            let tier = self.user_tier.read(user);
            match tier {
                ProofTier::Strict => false,
                ProofTier::Standard => true,
                ProofTier::Express => true,
            }
        }
        
        fn get_relayer_delay(self: @ContractState, user: ContractAddress) -> u64 {
            let tier = self.user_tier.read(user);
            let limits = self.get_tier_limits(tier);
            limits.relayer_delay_seconds
        }
        
        fn check_position_limit(self: @ContractState, user: ContractAddress, new_position: u256) -> bool {
            let tier = self.user_tier.read(user);
            let limits = self.get_tier_limits(tier);
            
            // 0 = unlimited
            if limits.max_position == 0 {
                return true;
            }
            
            new_position <= limits.max_position
        }
        
        fn set_tier_limits(ref self: ContractState, tier: ProofTier, limits: TierLimits) {
            let caller = get_caller_address();
            let admin = self.admin.read();
            assert(caller == admin, 'Only admin');
            
            match tier {
                ProofTier::Strict => self.tier_strict_limits.write(limits),
                ProofTier::Standard => self.tier_standard_limits.write(limits),
                ProofTier::Express => self.tier_express_limits.write(limits),
            }
        }
        
        fn set_minimum_collateral(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let admin = self.admin.read();
            assert(caller == admin, 'Only admin');
            
            self.minimum_collateral.write(amount);
        }
        
        // ===== Discoverable Scoring (ERC-8004 Alignment) =====
        
        fn get_reputation_score(self: @ContractState, user: ContractAddress) -> u16 {
            // Score calculation: tenure_points + txn_points + collateral_points + proof_count_points
            // Max score: 1000
            
            let stats = self.user_stats.read(user);
            let timestamp = get_block_timestamp();
            
            // Tenure points (0-300): log scale based on days since first interaction
            let tenure_days = if stats.first_interaction > 0 {
                (timestamp - stats.first_interaction) / SECONDS_PER_DAY
            } else {
                0
            };
            let tenure_points: u16 = if tenure_days >= 365 {
                300
            } else if tenure_days >= 180 {
                250
            } else if tenure_days >= 90 {
                200
            } else if tenure_days >= 30 {
                100
            } else {
                (tenure_days * 3).try_into().unwrap_or(0)
            };
            
            // Transaction points (0-300): based on successful transactions
            let txn_points: u16 = if stats.successful_txns >= 100 {
                300
            } else if stats.successful_txns >= 50 {
                200
            } else if stats.successful_txns >= 20 {
                100
            } else {
                (stats.successful_txns * 5).try_into().unwrap_or(0)
            };
            
            // Collateral points (0-200): based on staked collateral
            let collateral = self.user_collateral.read(user);
            let min_collateral = self.minimum_collateral.read();
            let collateral_points: u16 = if min_collateral > 0 && collateral >= min_collateral * 10 {
                200
            } else if min_collateral > 0 && collateral >= min_collateral * 5 {
                150
            } else if min_collateral > 0 && collateral >= min_collateral {
                100
            } else if collateral > 0 {
                50
            } else {
                0
            };
            
            // Proof count points (0-200): based on registered proofs
            let proof_count = self.user_proof_count.read(user);
            let proof_points: u16 = if proof_count >= 50 {
                200
            } else if proof_count >= 20 {
                150
            } else if proof_count >= 10 {
                100
            } else {
                (proof_count * 10).try_into().unwrap_or(0)
            };
            
            tenure_points + txn_points + collateral_points + proof_points
        }
        
        fn get_top_users(self: @ContractState, limit: u32) -> Array<ContractAddress> {
            // Return users with highest scores
            // Note: In production, this would use an ordered index
            // For now, return first N users (actual ordering would need off-chain computation)
            let total = self.total_user_count.read();
            let actual_limit: u64 = if limit.into() > total { total } else { limit.into() };
            
            let mut users: Array<ContractAddress> = ArrayTrait::new();
            let mut i: u64 = 0;
            loop {
                if i >= actual_limit {
                    break;
                }
                let user = self.all_users.read(i);
                if user.is_non_zero() {
                    users.append(user);
                }
                i += 1;
            };
            users
        }
        
        fn get_user_rank(self: @ContractState, user: ContractAddress) -> u64 {
            // Return user's position in the ranking
            // Note: In production, this would use an ordered index
            let user_score = self.get_reputation_score(user);
            let total = self.total_user_count.read();
            
            let mut better_count: u64 = 0;
            let mut i: u64 = 0;
            loop {
                if i >= total {
                    break;
                }
                let other_user = self.all_users.read(i);
                if other_user.is_non_zero() && other_user != user {
                    let other_score = self.get_reputation_score(other_user);
                    if other_score > user_score {
                        better_count += 1;
                    }
                }
                i += 1;
            };
            better_count + 1
        }
        
        fn get_users_by_tier(self: @ContractState, tier: ProofTier) -> Array<ContractAddress> {
            let tier_num: u8 = match tier {
                ProofTier::Strict => 0,
                ProofTier::Standard => 1,
                ProofTier::Express => 2,
            };
            
            let count = self.tier_user_count.read(tier_num);
            let mut users: Array<ContractAddress> = ArrayTrait::new();
            let mut i: u64 = 0;
            loop {
                if i >= count {
                    break;
                }
                users.append(self.tier_users.read((tier_num, i)));
                i += 1;
            };
            users
        }
        
        fn get_total_users(self: @ContractState) -> u64 {
            self.total_user_count.read()
        }
        
        // ──── v6: Collaborative Credit Graph ────────────────────────────
        
        fn set_collaborative_score(
            ref self: ContractState,
            user: ContractAddress,
            multiplier_bps: u16,
            graph_hash: felt252,
        ) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'Not admin');
            
            // Bounds: 10000 (1.0x) to 20000 (2.0x)
            assert(multiplier_bps >= 10000 && multiplier_bps <= 20000, 'Invalid multiplier');
            
            self.collaborative_multiplier_bps.write(user, multiplier_bps);
            self.collaborative_graph_hash.write(user, graph_hash);
        }
        
        fn get_collaborative_score(self: @ContractState, user: ContractAddress) -> u16 {
            let score = self.collaborative_multiplier_bps.read(user);
            if score == 0 {
                10000  // Default: 1.0x multiplier
            } else {
                score
            }
        }
        
        fn get_graph_hash(self: @ContractState, user: ContractAddress) -> felt252 {
            self.collaborative_graph_hash.read(user)
        }
    }
    
    // Internal function to register a new user
    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn register_user_if_new(ref self: ContractState, user: ContractAddress) {
            let existing_index = self.user_index.read(user);
            if existing_index == 0 && self.all_users.read(0) != user {
                let index = self.total_user_count.read();
                self.all_users.write(index, user);
                self.user_index.write(user, index);
                self.total_user_count.write(index + 1);
                
                // Add to tier 0 (Strict) by default
                let tier_count = self.tier_user_count.read(0);
                self.tier_users.write((0, tier_count), user);
                self.tier_user_count.write(0, tier_count + 1);
            }
        }
    }
}
