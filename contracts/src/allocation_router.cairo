// Allocation Router: Manages JediSwap/Ekubo allocation mixes for shielded pools.
// Conservative: 80% JediSwap / 20% Ekubo (risk score ~32)
// Neutral: 50% JediSwap / 50% Ekubo (risk score ~48)
// Aggressive: 20% JediSwap / 80% Ekubo (risk score ~67)

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, PartialEq, starknet::Store)]
pub enum PoolType {
    Conservative, // 80/20 JediSwap/Ekubo
    Neutral,      // 50/50 JediSwap/Ekubo
    Aggressive,   // 20/80 JediSwap/Ekubo
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct Allocation {
    pub jediswap_bps: u16,  // Basis points (10000 = 100%)
    pub ekubo_bps: u16,
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct PoolDefinition {
    pub allocation: Allocation,
    pub risk_score: u8,  // 0-100
    pub min_deposit: u256,
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct UserPosition {
    pub pool_type: PoolType,
    pub amount: u256,
    pub entry_timestamp: u64,
}

#[starknet::interface]
pub trait IAllocationRouter<TContractState> {
    // Pool info
    fn get_pool_definition(self: @TContractState, pool_type: PoolType) -> PoolDefinition;
    fn get_all_pools(self: @TContractState) -> Array<PoolDefinition>;
    
    // User positions
    fn get_user_position(self: @TContractState, user: ContractAddress) -> UserPosition;
    fn get_user_allocation(self: @TContractState, user: ContractAddress) -> Allocation;
    
    // Allocation changes
    fn deposit_to_pool(ref self: TContractState, pool_type: PoolType, amount: u256);
    fn rebalance_to_pool(ref self: TContractState, new_pool: PoolType);
    fn withdraw_from_pool(ref self: TContractState, amount: u256);
    
    // Risk scoring
    fn calculate_risk_score(self: @TContractState, allocation: Allocation) -> u8;
    fn get_recommended_pool(self: @TContractState, risk_tolerance: u8) -> PoolType;
    
    // Market data (from oracle)
    fn update_market_data(ref self: TContractState, jediswap_apy: u256, ekubo_apy: u256, volatility: u256);
    fn get_pool_projected_apy(self: @TContractState, pool_type: PoolType) -> u256;
}

#[starknet::contract]
mod AllocationRouter {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp, get_contract_address,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    
    use super::{PoolType, Allocation, PoolDefinition, UserPosition};
    
    #[storage]
    struct Storage {
        admin: ContractAddress,
        token: ContractAddress,
        
        // Pool definitions
        conservative_pool: PoolDefinition,
        neutral_pool: PoolDefinition,
        aggressive_pool: PoolDefinition,
        
        // User positions
        user_positions: Map<ContractAddress, UserPosition>,
        user_balances: Map<ContractAddress, u256>,
        
        // Market data (from oracle)
        jediswap_apy_bps: u256,
        ekubo_apy_bps: u256,
        market_volatility: u256,
        last_market_update: u64,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        DepositToPool: DepositToPool,
        Rebalanced: Rebalanced,
        WithdrawFromPool: WithdrawFromPool,
        MarketDataUpdated: MarketDataUpdated,
    }
    
    #[derive(Drop, starknet::Event)]
    struct DepositToPool {
        #[key]
        user: ContractAddress,
        pool_type: PoolType,
        amount: u256,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct Rebalanced {
        #[key]
        user: ContractAddress,
        from_pool: PoolType,
        to_pool: PoolType,
        amount: u256,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct WithdrawFromPool {
        #[key]
        user: ContractAddress,
        pool_type: PoolType,
        amount: u256,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct MarketDataUpdated {
        jediswap_apy: u256,
        ekubo_apy: u256,
        volatility: u256,
        timestamp: u64,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        token: ContractAddress
    ) {
        self.admin.write(admin);
        self.token.write(token);
        
        // Initialize pool definitions
        self.conservative_pool.write(PoolDefinition {
            allocation: Allocation { jediswap_bps: 8000, ekubo_bps: 2000 },
            risk_score: 32,
            min_deposit: 100000000000000000_u256, // 0.1 ETH
        });
        
        self.neutral_pool.write(PoolDefinition {
            allocation: Allocation { jediswap_bps: 5000, ekubo_bps: 5000 },
            risk_score: 48,
            min_deposit: 100000000000000000_u256,
        });
        
        self.aggressive_pool.write(PoolDefinition {
            allocation: Allocation { jediswap_bps: 2000, ekubo_bps: 8000 },
            risk_score: 67,
            min_deposit: 100000000000000000_u256,
        });
    }
    
    #[abi(embed_v0)]
    impl AllocationRouterImpl of super::IAllocationRouter<ContractState> {
        fn get_pool_definition(self: @ContractState, pool_type: PoolType) -> PoolDefinition {
            match pool_type {
                PoolType::Conservative => self.conservative_pool.read(),
                PoolType::Neutral => self.neutral_pool.read(),
                PoolType::Aggressive => self.aggressive_pool.read(),
            }
        }
        
        fn get_all_pools(self: @ContractState) -> Array<PoolDefinition> {
            array![
                self.conservative_pool.read(),
                self.neutral_pool.read(),
                self.aggressive_pool.read()
            ]
        }
        
        fn get_user_position(self: @ContractState, user: ContractAddress) -> UserPosition {
            self.user_positions.read(user)
        }
        
        fn get_user_allocation(self: @ContractState, user: ContractAddress) -> Allocation {
            let position = self.user_positions.read(user);
            let pool = self.get_pool_definition(position.pool_type);
            pool.allocation
        }
        
        fn deposit_to_pool(ref self: ContractState, pool_type: PoolType, amount: u256) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            let pool = self.get_pool_definition(pool_type);
            assert(amount >= pool.min_deposit, 'Below minimum deposit');
            
            let current_balance = self.user_balances.read(caller);
            self.user_balances.write(caller, current_balance + amount);
            
            self.user_positions.write(caller, UserPosition {
                pool_type,
                amount: current_balance + amount,
                entry_timestamp: timestamp,
            });
            
            self.emit(DepositToPool {
                user: caller,
                pool_type,
                amount,
                timestamp,
            });
        }
        
        fn rebalance_to_pool(ref self: ContractState, new_pool: PoolType) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            let current = self.user_positions.read(caller);
            assert(current.amount > 0, 'No position to rebalance');
            
            self.user_positions.write(caller, UserPosition {
                pool_type: new_pool,
                amount: current.amount,
                entry_timestamp: timestamp,
            });
            
            self.emit(Rebalanced {
                user: caller,
                from_pool: current.pool_type,
                to_pool: new_pool,
                amount: current.amount,
                timestamp,
            });
        }
        
        fn withdraw_from_pool(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            let current = self.user_positions.read(caller);
            assert(current.amount >= amount, 'Insufficient balance');
            
            let new_amount = current.amount - amount;
            self.user_balances.write(caller, new_amount);
            
            self.user_positions.write(caller, UserPosition {
                pool_type: current.pool_type,
                amount: new_amount,
                entry_timestamp: current.entry_timestamp,
            });
            
            self.emit(WithdrawFromPool {
                user: caller,
                pool_type: current.pool_type,
                amount,
                timestamp,
            });
        }
        
        fn calculate_risk_score(self: @ContractState, allocation: Allocation) -> u8 {
            // Risk increases with Ekubo allocation (higher APY = higher risk)
            // Formula: base_risk + (ekubo_weight * ekubo_risk_factor)
            let ekubo_weight: u16 = allocation.ekubo_bps;
            // Scale: 0-10000 bps -> 0-100 risk
            let risk = (ekubo_weight * 80) / 10000 + 20; // Range: 20-100
            if risk > 100 { 100_u8 } else { risk.try_into().unwrap() }
        }
        
        fn get_recommended_pool(self: @ContractState, risk_tolerance: u8) -> PoolType {
            if risk_tolerance < 40 {
                PoolType::Conservative
            } else if risk_tolerance < 60 {
                PoolType::Neutral
            } else {
                PoolType::Aggressive
            }
        }
        
        fn update_market_data(ref self: ContractState, jediswap_apy: u256, ekubo_apy: u256, volatility: u256) {
            let caller = get_caller_address();
            let admin = self.admin.read();
            assert(caller == admin, 'Only admin can update');
            
            let timestamp = get_block_timestamp();
            self.jediswap_apy_bps.write(jediswap_apy);
            self.ekubo_apy_bps.write(ekubo_apy);
            self.market_volatility.write(volatility);
            self.last_market_update.write(timestamp);
            
            self.emit(MarketDataUpdated {
                jediswap_apy,
                ekubo_apy,
                volatility,
                timestamp,
            });
        }
        
        fn get_pool_projected_apy(self: @ContractState, pool_type: PoolType) -> u256 {
            let pool = self.get_pool_definition(pool_type);
            let jedi_apy = self.jediswap_apy_bps.read();
            let ekubo_apy = self.ekubo_apy_bps.read();
            
            // Weighted average APY
            let jedi_contribution = (jedi_apy * pool.allocation.jediswap_bps.into()) / 10000;
            let ekubo_contribution = (ekubo_apy * pool.allocation.ekubo_bps.into()) / 10000;
            
            jedi_contribution + ekubo_contribution
        }
    }
}
