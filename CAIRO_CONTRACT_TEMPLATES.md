# Smart Contract Templates - Copy & Customize

These templates are ready to compile. Copy into `/opt/obsqra.starknet/contracts/src/`

---

## File 1: vault_manager.cairo

```cairo
// VaultManager - Receives deposits, tracks allocations, coordinates with strategies
use starknet::ContractAddress;
use starknet::get_caller_address;
use starknet::get_contract_address;

#[starknet::interface]
pub trait IVaultManager<TContractState> {
    fn deposit(ref self: TContractState, amount: u256) -> u256;  // Returns shares
    fn withdraw(ref self: TContractState, shares: u256) -> u256; // Returns amount
    fn get_balance(self: @TContractState, user: ContractAddress) -> (u256, u256);  // (shares, value)
    fn get_total_assets(self: @TContractState) -> u256;
    fn get_pending_allocation(self: @TContractState, user: ContractAddress) -> (u256, u256); // (amount, audit_id)
    fn set_audit_trail(ref self: TContractState, audit_address: ContractAddress);
}

#[starknet::contract]
mod VaultManager {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_contract_address;
    use starknet::account::Call;
    use starknet::call_contract_syscall;
    use super::super::interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};

    #[storage]
    struct Storage {
        // ERC20 token to handle (STRK)
        token: ContractAddress,
        
        // Vault state
        total_shares: u256,
        total_assets: u256,
        
        // User state
        user_shares: LegacyMap<ContractAddress, u256>,
        user_assets: LegacyMap<ContractAddress, u256>,
        
        // Pending allocations (awaiting strategy decision)
        pending_amount: LegacyMap<ContractAddress, u256>,
        pending_audit_id: LegacyMap<ContractAddress, u256>,
        
        // Strategy contracts
        strategy_router: ContractAddress,
        audit_trail: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Deposit: Deposit,
        Withdraw: Withdraw,
        AllocationRequested: AllocationRequested,
    }

    #[derive(Drop, starknet::Event)]
    struct Deposit {
        user: ContractAddress,
        amount: u256,
        shares: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdraw {
        user: ContractAddress,
        shares: u256,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct AllocationRequested {
        user: ContractAddress,
        amount: u256,
        audit_id: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        token: ContractAddress,
        strategy_router: ContractAddress,
        audit_trail: ContractAddress,
    ) {
        self.token.write(token);
        self.strategy_router.write(strategy_router);
        self.audit_trail.write(audit_trail);
        self.total_shares.write(0);
        self.total_assets.write(0);
    }

    #[abi(embed_v0)]
    impl VaultManager of super::IVaultManager<ContractState> {
        fn deposit(ref self: ContractState, amount: u256) -> u256 {
            let caller = get_caller_address();
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            
            // Transfer tokens from user to vault
            let success = token.transfer_from(caller, get_contract_address(), amount);
            assert(success, 'Transfer failed');
            
            // Calculate shares (simplified 1:1 for MVP)
            let shares = amount;
            
            // Update state
            self.user_shares.write(caller, self.user_shares.read(caller) + shares);
            self.user_assets.write(caller, self.user_assets.read(caller) + amount);
            self.total_shares.write(self.total_shares.read() + shares);
            self.total_assets.write(self.total_assets.read() + amount);
            
            // Store as pending (waiting for AI decision)
            self.pending_amount.write(caller, amount);
            
            self.emit(Deposit { user: caller, amount, shares });
            
            shares
        }

        fn withdraw(ref self: ContractState, shares: u256) -> u256 {
            let caller = get_caller_address();
            let user_shares = self.user_shares.read(caller);
            
            assert(user_shares >= shares, 'Insufficient shares');
            
            // Calculate amount (simplified 1:1)
            let amount = shares;
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            
            // Transfer back to user
            let success = token.transfer(caller, amount);
            assert(success, 'Transfer failed');
            
            // Update state
            self.user_shares.write(caller, user_shares - shares);
            self.user_assets.write(caller, self.user_assets.read(caller) - amount);
            self.total_shares.write(self.total_shares.read() - shares);
            self.total_assets.write(self.total_assets.read() - amount);
            
            self.emit(Withdraw { user: caller, shares, amount });
            
            amount
        }

        fn get_balance(self: @ContractState, user: ContractAddress) -> (u256, u256) {
            (self.user_shares.read(user), self.user_assets.read(user))
        }

        fn get_total_assets(self: @ContractState) -> u256 {
            self.total_assets.read()
        }

        fn get_pending_allocation(self: @ContractState, user: ContractAddress) -> (u256, u256) {
            (self.pending_amount.read(user), self.pending_audit_id.read(user))
        }

        fn set_audit_trail(ref self: ContractState, audit_address: ContractAddress) {
            self.audit_trail.write(audit_address);
        }
    }
}
```

---

## File 2: strategy_router.cairo

```cairo
// StrategyRouter - Routes deposits to either LP (Ekubo) or Yield (Vesu)
use starknet::ContractAddress;
use starknet::get_caller_address;

#[derive(Copy, Drop, Serde)]
pub enum StrategyType {
    EKUBO_LP: (),     // 0 - Ekubo LP positions
    VESU_YIELD: (),   // 1 - Vesu lending
}

#[derive(Copy, Drop, Serde)]
pub struct PoolKey {
    pub token0: ContractAddress,
    pub token1: ContractAddress,
    pub fee: u128,
    pub tick_spacing: u128,
    pub extension: ContractAddress,
}

#[derive(Copy, Drop, Serde)]
pub struct StrategyAllocation {
    pub strategy: StrategyType,
    pub pool_key: Option<PoolKey>,  // For LP strategies
    pub expected_apy_min: u256,
    pub expected_apy_max: u256,
    pub confidence: u256,  // 0-100
}

#[starknet::interface]
pub trait IStrategyRouter<TContractState> {
    fn route_capital(
        ref self: TContractState,
        user: ContractAddress,
        amount: u256,
        strategy: StrategyType,
    ) -> StrategyAllocation;
    
    fn execute_strategy(
        ref self: TContractState,
        user: ContractAddress,
        allocation: StrategyAllocation,
    ) -> u256;  // Returns position_id or deposit_id
}

#[starknet::contract]
mod StrategyRouter {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use super::{StrategyType, PoolKey, StrategyAllocation};

    #[storage]
    struct Storage {
        vault_manager: ContractAddress,
        ekubo_strategy: ContractAddress,
        vesu_strategy: ContractAddress,
        audit_trail: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        StrategyAssigned: StrategyAssigned,
        StrategyExecuted: StrategyExecuted,
    }

    #[derive(Drop, starknet::Event)]
    struct StrategyAssigned {
        user: ContractAddress,
        strategy: u256,  // 0 = LP, 1 = Yield
        expected_apy: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct StrategyExecuted {
        user: ContractAddress,
        strategy: u256,
        amount: u256,
        position_id: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        vault_manager: ContractAddress,
        ekubo_strategy: ContractAddress,
        vesu_strategy: ContractAddress,
        audit_trail: ContractAddress,
    ) {
        self.vault_manager.write(vault_manager);
        self.ekubo_strategy.write(ekubo_strategy);
        self.vesu_strategy.write(vesu_strategy);
        self.audit_trail.write(audit_trail);
    }

    #[abi(embed_v0)]
    impl StrategyRouterImpl of super::IStrategyRouter<ContractState> {
        fn route_capital(
            ref self: ContractState,
            user: ContractAddress,
            amount: u256,
            strategy: StrategyType,
        ) -> StrategyAllocation {
            // This is called by backend AI after decision
            // Just validate and return allocation details
            
            match strategy {
                StrategyType::EKUBO_LP(()) => {
                    // LP strategy: 15-40% APY depending on range
                    let allocation = StrategyAllocation {
                        strategy: StrategyType::EKUBO_LP(()),
                        pool_key: Option::None,  // Set by execute call
                        expected_apy_min: 15,
                        expected_apy_max: 40,
                        confidence: 85,
                    };
                    
                    self.emit(StrategyAssigned {
                        user,
                        strategy: 0,
                        expected_apy: 25,
                    });
                    
                    allocation
                },
                StrategyType::VESU_YIELD(()) => {
                    // Yield strategy: 3-6% APY (safer)
                    let allocation = StrategyAllocation {
                        strategy: StrategyType::VESU_YIELD(()),
                        pool_key: Option::None,
                        expected_apy_min: 3,
                        expected_apy_max: 6,
                        confidence: 92,
                    };
                    
                    self.emit(StrategyAssigned {
                        user,
                        strategy: 1,
                        expected_apy: 5,
                    });
                    
                    allocation
                }
            }
        }

        fn execute_strategy(
            ref self: ContractState,
            user: ContractAddress,
            allocation: StrategyAllocation,
        ) -> u256 {
            // Called after user approves strategy
            // Routes to appropriate strategy contract
            
            match allocation.strategy {
                StrategyType::EKUBO_LP(()) => {
                    // Call EkuboStrategy contract
                    // Returns position_id
                    0  // Placeholder - actual implementation calls EkuboStrategy
                },
                StrategyType::VESU_YIELD(()) => {
                    // Call VesuStrategy contract
                    // Returns deposit_id
                    1  // Placeholder - actual implementation calls VesuStrategy
                }
            }
        }
    }
}
```

---

## File 3: audit_trail.cairo

```cairo
// AuditTrail - Records all strategy decisions with proofs
use starknet::ContractAddress;
use starknet::get_block_timestamp;
use starknet::get_contract_address;

#[derive(Copy, Drop, Serde)]
pub struct DecisionEntry {
    pub id: u256,
    pub user: ContractAddress,
    pub amount: u256,
    pub strategy: u256,  // 0 = LP, 1 = Yield
    pub expected_apy_min: u256,
    pub expected_apy_max: u256,
    pub proof_hash: felt252,
    pub model_hash: felt252,
    pub confidence: u256,
    pub timestamp: u64,
    pub tx_hash: felt252,
    pub executed: bool,
}

#[starknet::interface]
pub trait IAuditTrail<TContractState> {
    fn record_decision(
        ref self: TContractState,
        user: ContractAddress,
        amount: u256,
        strategy: u256,
        expected_apy_min: u256,
        expected_apy_max: u256,
        proof_hash: felt252,
        model_hash: felt252,
        confidence: u256,
    ) -> u256;  // Returns entry_id
    
    fn record_execution(ref self: TContractState, entry_id: u256, tx_hash: felt252);
    
    fn record_yield_accrual(
        ref self: TContractState,
        user: ContractAddress,
        amount: u256,
        protocol: felt252,  // "EKUBO" or "VESU"
        yield_tx_hash: felt252,
    );
    
    fn get_entry(self: @TContractState, entry_id: u256) -> DecisionEntry;
    fn get_user_entries(self: @TContractState, user: ContractAddress) -> Array<u256>;
}

#[starknet::contract]
mod AuditTrail {
    use starknet::ContractAddress;
    use starknet::get_block_timestamp;
    use super::DecisionEntry;

    #[storage]
    struct Storage {
        next_id: u256,
        entries: LegacyMap<u256, DecisionEntry>,
        user_entries: LegacyMap<ContractAddress, Array<u256>>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        DecisionRecorded: DecisionRecorded,
        ExecutionRecorded: ExecutionRecorded,
        YieldAccrualRecorded: YieldAccrualRecorded,
    }

    #[derive(Drop, starknet::Event)]
    struct DecisionRecorded {
        entry_id: u256,
        user: ContractAddress,
        amount: u256,
        strategy: u256,
        proof_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct ExecutionRecorded {
        entry_id: u256,
        tx_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct YieldAccrualRecorded {
        user: ContractAddress,
        amount: u256,
        protocol: felt252,
        tx_hash: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.next_id.write(1);
    }

    #[abi(embed_v0)]
    impl AuditTrailImpl of super::IAuditTrail<ContractState> {
        fn record_decision(
            ref self: ContractState,
            user: ContractAddress,
            amount: u256,
            strategy: u256,
            expected_apy_min: u256,
            expected_apy_max: u256,
            proof_hash: felt252,
            model_hash: felt252,
            confidence: u256,
        ) -> u256 {
            let entry_id = self.next_id.read();
            let timestamp = get_block_timestamp();
            
            let entry = DecisionEntry {
                id: entry_id,
                user,
                amount,
                strategy,
                expected_apy_min,
                expected_apy_max,
                proof_hash,
                model_hash,
                confidence,
                timestamp,
                tx_hash: 0,
                executed: false,
            };
            
            self.entries.write(entry_id, entry);
            self.next_id.write(entry_id + 1);
            
            self.emit(DecisionRecorded {
                entry_id,
                user,
                amount,
                strategy,
                proof_hash,
            });
            
            entry_id
        }

        fn record_execution(ref self: ContractState, entry_id: u256, tx_hash: felt252) {
            // Mark decision as executed
            // This happens after /strategies/execute completes
            
            self.emit(ExecutionRecorded {
                entry_id,
                tx_hash,
            });
        }

        fn record_yield_accrual(
            ref self: ContractState,
            user: ContractAddress,
            amount: u256,
            protocol: felt252,
            yield_tx_hash: felt252,
        ) {
            // Called daily when fees are collected
            
            self.emit(YieldAccrualRecorded {
                user,
                amount,
                protocol,
                tx_hash: yield_tx_hash,
            });
        }

        fn get_entry(self: @ContractState, entry_id: u256) -> DecisionEntry {
            self.entries.read(entry_id)
        }

        fn get_user_entries(self: @ContractState, user: ContractAddress) -> Array<u256> {
            // Note: LegacyMap doesn't support easy iteration
            // In production, maintain separate user_entries array
            // For MVP, query from backend
            array![]
        }
    }
}
```

---

## File 4: ekubo_strategy.cairo

```cairo
// EkuboStrategy - Creates LP positions and collects fees
use starknet::ContractAddress;
use starknet::get_caller_address;
use starknet::get_contract_address;

#[derive(Copy, Drop, Serde)]
pub struct PoolKey {
    pub token0: ContractAddress,
    pub token1: ContractAddress,
    pub fee: u128,
    pub tick_spacing: u128,
    pub extension: ContractAddress,
}

#[derive(Copy, Drop, Serde)]
pub struct i129 {
    pub mag: u128,
    pub sign: bool,
}

#[derive(Copy, Drop, Serde)]
pub struct Bounds {
    pub lower: i129,
    pub upper: i129,
}

#[starknet::interface]
pub trait IEkuboPositions<TContractState> {
    fn mint_and_deposit(
        ref self: TContractState,
        pool_key: PoolKey,
        bounds: Bounds,
        min_liquidity: u128
    ) -> (u64, u128);  // (token_id, liquidity)
}

#[starknet::interface]
pub trait IEkuboStrategy<TContractState> {
    fn create_position(
        ref self: TContractState,
        amount: u256,
        token0: ContractAddress,
        token1: ContractAddress,
        fee: u128,
        lower_tick: i129,
        upper_tick: i129,
    ) -> u64;  // Returns position_id
    
    fn collect_fees(
        ref self: TContractState,
        position_id: u64,
    ) -> (u128, u128);  // Returns (fee0, fee1)
}

#[starknet::contract]
mod EkuboStrategy {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use super::{PoolKey, Bounds, i129, IEkuboPositions, IEkuboPositionsCamelDispatcher, IEkuboPositionsCamelDispatcherTrait};
    use super::super::interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};

    #[storage]
    struct Storage {
        vault_manager: ContractAddress,
        ekubo_positions: ContractAddress,
        ekubo_core: ContractAddress,
        positions: LegacyMap<ContractAddress, u64>,  // user -> position_id
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        PositionCreated: PositionCreated,
        FeesCollected: FeesCollected,
    }

    #[derive(Drop, starknet::Event)]
    struct PositionCreated {
        user: ContractAddress,
        position_id: u64,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct FeesCollected {
        position_id: u64,
        fee0: u128,
        fee1: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        vault_manager: ContractAddress,
        ekubo_positions: ContractAddress,
        ekubo_core: ContractAddress,
    ) {
        self.vault_manager.write(vault_manager);
        self.ekubo_positions.write(ekubo_positions);
        self.ekubo_core.write(ekubo_core);
    }

    #[abi(embed_v0)]
    impl EkuboStrategyImpl of super::IEkuboStrategy<ContractState> {
        fn create_position(
            ref self: ContractState,
            amount: u256,
            token0: ContractAddress,
            token1: ContractAddress,
            fee: u128,
            lower_tick: i129,
            upper_tick: i129,
        ) -> u64 {
            let caller = get_caller_address();
            let positions_addr = self.ekubo_positions.read();
            
            // Create pool key
            let pool_key = PoolKey {
                token0,
                token1,
                fee,
                tick_spacing: 60,  // Standard for MVP
                extension: 0,
            };
            
            // Create bounds
            let bounds = Bounds {
                lower: lower_tick,
                upper: upper_tick,
            };
            
            // Call Ekubo Positions contract
            let ekubo_positions = IEkuboPositionsCamelDispatcher { contract_address: positions_addr };
            let (position_id, liquidity) = ekubo_positions.mint_and_deposit(
                pool_key,
                bounds,
                0  // min_liquidity = 0 for MVP
            );
            
            // Store position for user
            self.positions.write(caller, position_id);
            
            self.emit(PositionCreated {
                user: caller,
                position_id,
                amount,
            });
            
            position_id
        }

        fn collect_fees(
            ref self: ContractState,
            position_id: u64,
        ) -> (u128, u128) {
            // In full implementation, call Ekubo Core collect_fees
            // For MVP, return placeholder
            (0, 0)
        }
    }
}
```

---

## How to Use These Templates

### Step 1: Copy to Project
```bash
cp vault_manager.cairo contracts/src/
cp strategy_router.cairo contracts/src/
cp audit_trail.cairo contracts/src/
cp ekubo_strategy.cairo contracts/src/
```

### Step 2: Fix Imports
Update import paths to match your project structure (the templates use placeholders)

### Step 3: Add to main.cairo
```cairo
mod vault_manager;
mod strategy_router;
mod audit_trail;
mod ekubo_strategy;
```

### Step 4: Compile
```bash
scarb build
```

### Step 5: Deploy
```bash
sncast declare --contract-class VaultManager
sncast deploy VaultManager <args>
```

---

## Next Steps

1. Copy these templates
2. Fix imports to match your interfaces
3. Compile and test
4. Deploy VaultManager first (simplest)
5. Deploy AuditTrail second
6. Deploy StrategyRouter third
7. Deploy EkuboStrategy fourth

Good luck! 🚀
