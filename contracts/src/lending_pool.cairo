// LendingPool: Single-asset lending pool with reputation-driven credit lines.
//
// Suppliers deposit tokens and earn interest from borrower payments.
// Borrowers stake collateral via CollateralVault and borrow against their
// credit attestation (verified via ValidationProofRegistry).
//
// Dependencies:
//  - ICollateralVault: read collateral, slash on liquidation
//  - IValidationProofRegistry: verify attestation hash
//  - IReputationRegistry: read tier, record_transaction on repay
//  - IERC20: token transfers for supply/borrow pool
//  - ISessionKeyManager: session-key callers can repay within limits

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct LoanPosition {
    pub borrower: ContractAddress,
    pub principal: u256,
    pub interest_accrued: u256,
    pub interest_rate_bps: u16,
    pub opened_at: u64,
    pub last_accrued: u64,
    pub attestation_hash: felt252,
    pub active: bool,
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct SupplyPosition {
    pub supplier: ContractAddress,
    pub shares: u256,
    pub deposited_at: u64,
    pub active: bool,
}

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IValidationProofRegistry<TContractState> {
    fn is_proof_valid(self: @TContractState, fact_hash: felt252) -> bool;
    fn has_proof(self: @TContractState, fact_hash: felt252) -> bool;
}

#[starknet::interface]
pub trait ICollateralVault<TContractState> {
    fn get_user_collateral(self: @TContractState, user: ContractAddress) -> u256;
    fn slash(ref self: TContractState, user: ContractAddress, amount: u256, recipient: ContractAddress);
}

#[starknet::interface]
pub trait IReputationRegistry<TContractState> {
    fn record_transaction(ref self: TContractState, user: ContractAddress, volume: u256, success: bool);
    fn get_user_tier(self: @TContractState, user: ContractAddress) -> felt252;
}

#[starknet::interface]
pub trait ILendingPool<TContractState> {
    fn supply(ref self: TContractState, amount: u256) -> u64;

    fn withdraw(ref self: TContractState, supply_id: u64);

    fn borrow(
        ref self: TContractState,
        amount: u256,
        attestation_hash: felt252,
    ) -> u64;

    fn borrow_with_proof(
        ref self: TContractState,
        amount: u256,
        attestation_hash: felt252,
        proof_calldata: Span<felt252>,
    ) -> u64;

    fn repay(ref self: TContractState, loan_id: u64, amount: u256);

    fn liquidate(ref self: TContractState, loan_id: u64);

    fn get_loan(self: @TContractState, loan_id: u64) -> LoanPosition;

    fn get_supply(self: @TContractState, supply_id: u64) -> SupplyPosition;

    fn get_health_factor_num_denom(self: @TContractState, loan_id: u64) -> (u256, u256);

    fn get_pool_total_supplied(self: @TContractState) -> u256;

    fn get_pool_total_borrowed(self: @TContractState) -> u256;

    fn get_pool_utilization_bps(self: @TContractState) -> u256;

    fn get_user_loan_count(self: @TContractState, user: ContractAddress) -> u64;

    fn get_user_loan_at(self: @TContractState, user: ContractAddress, index: u64) -> u64;

    fn get_user_supply_count(self: @TContractState, user: ContractAddress) -> u64;

    fn get_user_supply_at(self: @TContractState, user: ContractAddress, index: u64) -> u64;
}

#[starknet::contract]
mod LendingPool {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        contract_address_const,
    };
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use core::num::traits::Zero;

    use super::{
        LoanPosition, SupplyPosition,
        IERC20Dispatcher, IERC20DispatcherTrait,
        IValidationProofRegistryDispatcher, IValidationProofRegistryDispatcherTrait,
        ICollateralVaultDispatcher, ICollateralVaultDispatcherTrait,
        IReputationRegistryDispatcher, IReputationRegistryDispatcherTrait,
    };

    const SECONDS_PER_YEAR: u64 = 31536000;
    const LIQUIDATION_THRESHOLD_BPS: u256 = 8000; // 80% — if collateral / debt < 80%, liquidatable
    const LIQUIDATION_PENALTY_BPS: u256 = 500;    // 5% penalty to liquidator
    const DEFAULT_RATE_BPS: u16 = 500;             // 5% base rate
    const BPS_DENOMINATOR: u256 = 10000;

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pool_token: ContractAddress,
        collateral_vault: ContractAddress,
        validation_registry: ContractAddress,
        reputation_registry: ContractAddress,

        total_supplied: u256,
        total_borrowed: u256,
        total_shares: u256,

        next_loan_id: u64,
        next_supply_id: u64,

        loans: Map<u64, LoanPosition>,
        supplies: Map<u64, SupplyPosition>,

        user_loan_count: Map<ContractAddress, u64>,
        user_loans: Map<(ContractAddress, u64), u64>,

        user_supply_count: Map<ContractAddress, u64>,
        user_supplies: Map<(ContractAddress, u64), u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Supplied: Supplied,
        Withdrawn: Withdrawn,
        Borrowed: Borrowed,
        Repaid: Repaid,
        Liquidated: Liquidated,
    }

    #[derive(Drop, starknet::Event)]
    struct Supplied {
        #[key]
        supplier: ContractAddress,
        supply_id: u64,
        amount: u256,
        shares: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdrawn {
        #[key]
        supplier: ContractAddress,
        supply_id: u64,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Borrowed {
        #[key]
        borrower: ContractAddress,
        loan_id: u64,
        amount: u256,
        attestation_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct Repaid {
        #[key]
        borrower: ContractAddress,
        loan_id: u64,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Liquidated {
        #[key]
        borrower: ContractAddress,
        loan_id: u64,
        debt_repaid: u256,
        collateral_seized: u256,
        liquidator: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        pool_token: ContractAddress,
        collateral_vault: ContractAddress,
        validation_registry: ContractAddress,
        reputation_registry: ContractAddress,
    ) {
        self.admin.write(admin);
        self.pool_token.write(pool_token);
        self.collateral_vault.write(collateral_vault);
        self.validation_registry.write(validation_registry);
        self.reputation_registry.write(reputation_registry);
        self.next_loan_id.write(1);
        self.next_supply_id.write(1);
    }

    #[abi(embed_v0)]
    impl LendingPoolImpl of super::ILendingPool<ContractState> {
        fn supply(ref self: ContractState, amount: u256) -> u64 {
            assert(amount > 0, 'amount must be > 0');
            let caller = get_caller_address();
            let now = get_block_timestamp();

            let token = IERC20Dispatcher { contract_address: self.pool_token.read() };
            let ok = token.transfer_from(caller, starknet::get_contract_address(), amount);
            assert(ok, 'transfer_from failed');

            let total_sup = self.total_supplied.read();
            let total_sh = self.total_shares.read();
            let shares = if total_sh == 0 || total_sup == 0 {
                amount
            } else {
                (amount * total_sh) / total_sup
            };

            self.total_supplied.write(total_sup + amount);
            self.total_shares.write(total_sh + shares);

            let sid = self.next_supply_id.read();
            self.next_supply_id.write(sid + 1);

            self.supplies.write(sid, SupplyPosition {
                supplier: caller,
                shares,
                deposited_at: now,
                active: true,
            });

            let sc = self.user_supply_count.read(caller);
            self.user_supplies.write((caller, sc), sid);
            self.user_supply_count.write(caller, sc + 1);

            self.emit(Supplied { supplier: caller, supply_id: sid, amount, shares });

            sid
        }

        fn withdraw(ref self: ContractState, supply_id: u64) {
            let sup = self.supplies.read(supply_id);
            let caller = get_caller_address();
            assert(sup.supplier == caller, 'not supplier');
            assert(sup.active, 'supply inactive');

            let total_sh = self.total_shares.read();
            let total_sup = self.total_supplied.read();
            let amount = if total_sh > 0 {
                (sup.shares * total_sup) / total_sh
            } else {
                0
            };

            assert(amount > 0, 'nothing to withdraw');

            let available = total_sup - self.total_borrowed.read();
            assert(amount <= available, 'insufficient pool liquidity');

            let token = IERC20Dispatcher { contract_address: self.pool_token.read() };
            let ok = token.transfer(caller, amount);
            assert(ok, 'transfer failed');

            self.total_supplied.write(total_sup - amount);
            self.total_shares.write(total_sh - sup.shares);

            let mut updated = sup;
            updated.active = false;
            self.supplies.write(supply_id, updated);

            self.emit(Withdrawn { supplier: caller, supply_id, amount });
        }

        fn borrow(
            ref self: ContractState,
            amount: u256,
            attestation_hash: felt252,
        ) -> u64 {
            self._borrow_internal(amount, attestation_hash)
        }

        fn borrow_with_proof(
            ref self: ContractState,
            amount: u256,
            attestation_hash: felt252,
            proof_calldata: Span<felt252>,
        ) -> u64 {
            // Future: verify Groth16 proof via Garaga verifier here
            // For now, fall through to standard borrow with attestation check
            self._borrow_internal(amount, attestation_hash)
        }

        fn repay(ref self: ContractState, loan_id: u64, amount: u256) {
            assert(amount > 0, 'amount must be > 0');
            let loan = self.loans.read(loan_id);
            assert(loan.active, 'loan not active');

            let token = IERC20Dispatcher { contract_address: self.pool_token.read() };
            let caller = get_caller_address();
            let ok = token.transfer_from(caller, starknet::get_contract_address(), amount);
            assert(ok, 'transfer_from failed');

            let total_debt = loan.principal + loan.interest_accrued;
            let repay_amount = if amount > total_debt { total_debt } else { amount };

            let mut updated = loan;
            if repay_amount >= total_debt {
                updated.principal = 0;
                updated.interest_accrued = 0;
                updated.active = false;
            } else if repay_amount > loan.interest_accrued {
                let principal_part = repay_amount - loan.interest_accrued;
                updated.interest_accrued = 0;
                updated.principal -= principal_part;
            } else {
                updated.interest_accrued -= repay_amount;
            }
            updated.last_accrued = get_block_timestamp();
            self.loans.write(loan_id, updated);

            self.total_borrowed.write(self.total_borrowed.read() - repay_amount);
            self.total_supplied.write(self.total_supplied.read() + repay_amount);

            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read(),
            };
            rep_registry.record_transaction(loan.borrower, repay_amount, true);

            self.emit(Repaid { borrower: loan.borrower, loan_id, amount: repay_amount });
        }

        fn liquidate(ref self: ContractState, loan_id: u64) {
            let loan = self.loans.read(loan_id);
            assert(loan.active, 'loan not active');

            let vault = ICollateralVaultDispatcher {
                contract_address: self.collateral_vault.read(),
            };
            let collateral = vault.get_user_collateral(loan.borrower);
            let total_debt = loan.principal + loan.interest_accrued;

            let health_num = collateral * BPS_DENOMINATOR;
            let health_denom = total_debt * LIQUIDATION_THRESHOLD_BPS;
            assert(health_num < health_denom, 'loan still healthy');

            let penalty = (total_debt * LIQUIDATION_PENALTY_BPS) / BPS_DENOMINATOR;
            let seize_amount = total_debt + penalty;
            let actual_seize = if seize_amount > collateral { collateral } else { seize_amount };

            let caller = get_caller_address();
            vault.slash(loan.borrower, actual_seize, caller);

            let mut updated = loan;
            updated.active = false;
            updated.principal = 0;
            updated.interest_accrued = 0;
            self.loans.write(loan_id, updated);

            self.total_borrowed.write(self.total_borrowed.read() - total_debt);

            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read(),
            };
            rep_registry.record_transaction(loan.borrower, total_debt, false);

            self.emit(Liquidated {
                borrower: loan.borrower,
                loan_id,
                debt_repaid: total_debt,
                collateral_seized: actual_seize,
                liquidator: caller,
            });
        }

        fn get_loan(self: @ContractState, loan_id: u64) -> LoanPosition {
            self.loans.read(loan_id)
        }

        fn get_supply(self: @ContractState, supply_id: u64) -> SupplyPosition {
            self.supplies.read(supply_id)
        }

        fn get_health_factor_num_denom(self: @ContractState, loan_id: u64) -> (u256, u256) {
            let loan = self.loans.read(loan_id);
            if !loan.active {
                return (BPS_DENOMINATOR, 1);
            }
            let vault = ICollateralVaultDispatcher {
                contract_address: self.collateral_vault.read(),
            };
            let collateral = vault.get_user_collateral(loan.borrower);
            let total_debt = loan.principal + loan.interest_accrued;
            if total_debt == 0 {
                return (BPS_DENOMINATOR, 1);
            }
            (collateral * BPS_DENOMINATOR, total_debt * LIQUIDATION_THRESHOLD_BPS)
        }

        fn get_pool_total_supplied(self: @ContractState) -> u256 {
            self.total_supplied.read()
        }

        fn get_pool_total_borrowed(self: @ContractState) -> u256 {
            self.total_borrowed.read()
        }

        fn get_pool_utilization_bps(self: @ContractState) -> u256 {
            let supplied = self.total_supplied.read();
            if supplied == 0 {
                return 0;
            }
            (self.total_borrowed.read() * BPS_DENOMINATOR) / supplied
        }

        fn get_user_loan_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_loan_count.read(user)
        }

        fn get_user_loan_at(self: @ContractState, user: ContractAddress, index: u64) -> u64 {
            self.user_loans.read((user, index))
        }

        fn get_user_supply_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_supply_count.read(user)
        }

        fn get_user_supply_at(self: @ContractState, user: ContractAddress, index: u64) -> u64 {
            self.user_supplies.read((user, index))
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _borrow_internal(
            ref self: ContractState,
            amount: u256,
            attestation_hash: felt252,
        ) -> u64 {
            assert(amount > 0, 'amount must be > 0');
            let caller = get_caller_address();
            let now = get_block_timestamp();

            let vpr = IValidationProofRegistryDispatcher {
                contract_address: self.validation_registry.read(),
            };
            assert(vpr.has_proof(attestation_hash), 'no valid attestation');

            let vault = ICollateralVaultDispatcher {
                contract_address: self.collateral_vault.read(),
            };
            let collateral = vault.get_user_collateral(caller);
            assert(collateral > 0, 'no collateral deposited');

            let available = self.total_supplied.read() - self.total_borrowed.read();
            assert(amount <= available, 'insufficient pool liquidity');

            let token = IERC20Dispatcher { contract_address: self.pool_token.read() };
            let ok = token.transfer(caller, amount);
            assert(ok, 'transfer failed');

            let lid = self.next_loan_id.read();
            self.next_loan_id.write(lid + 1);

            self.loans.write(lid, LoanPosition {
                borrower: caller,
                principal: amount,
                interest_accrued: 0,
                interest_rate_bps: DEFAULT_RATE_BPS,
                opened_at: now,
                last_accrued: now,
                attestation_hash,
                active: true,
            });

            self.total_borrowed.write(self.total_borrowed.read() + amount);

            let lc = self.user_loan_count.read(caller);
            self.user_loans.write((caller, lc), lid);
            self.user_loan_count.write(caller, lc + 1);

            self.emit(Borrowed {
                borrower: caller,
                loan_id: lid,
                amount,
                attestation_hash,
            });

            lid
        }
    }
}
