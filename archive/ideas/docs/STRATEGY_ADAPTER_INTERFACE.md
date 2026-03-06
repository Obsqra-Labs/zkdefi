# IStrategyAdapter Interface

**Version:** 1.0  
**Audience:** Third-party Cairo developers integrating with the Obsqra privacy vault

---

## 1. What is IStrategyAdapter

**IStrategyAdapter** is the composability interface for the Obsqra privacy vault. Any yield protocol (AMM LP, lending, staking, etc.) that implements this trait becomes a pluggable strategy. In return, the protocol inherits **private depositors** (users are cryptographically invisible at the execution layer), **constraint-bounded AI allocation** (the vault enforces user risk policies and zkML risk proofs before deploying capital), and **MEV protection** (allocation proposals use commit-reveal so trade intent is hidden until execution). The VaultController aggregates capital from privacy pools and deploys to approved adapters; individual user identities never appear on-chain at the yield layer.

---

## 2. The Interface

Implement the following trait in Cairo:

```cairo
#[starknet::interface]
pub trait IStrategyAdapter<TContractState> {
    fn deploy(ref self: TContractState, amount: u256, params: Span<felt252>) -> felt252;
    fn withdraw(ref self: TContractState, position_id: felt252, amount: u256) -> u256;
    fn harvest(ref self: TContractState) -> u256;
    fn value_of(self: @TContractState) -> u256;
    fn current_apy_bps(self: @TContractState) -> u32;
    fn is_healthy(self: @TContractState) -> bool;
}
```

### Function Specifications

| Function | Parameters | Returns | Expected Behavior |
|----------|------------|---------|-------------------|
| **deploy** | `amount`: capital to deploy (wei) <br> `params`: strategy-specific config (e.g. tick range, pool id) | `position_id`: unique identifier for the position | Deploy capital into the underlying protocol. Create and track a position. Return an opaque `position_id` the vault will use for future withdrawals. Must assert caller is the VaultController. |
| **withdraw** | `position_id`: from deploy <br> `amount`: amount to withdraw (wei) | `actual_withdrawn`: amount actually withdrawn | Withdraw capital from the position. Return the amount actually withdrawn (may be less than requested if the protocol has liquidity constraints). Must assert caller is the VaultController. |
| **harvest** | — | `harvested_amount`: yield collected | Collect accrued yield (fees, interest, rewards) from all positions. Return the total harvested amount. Must assert caller is the VaultController. |
| **value_of** | — | `current_total_value`: total value held (wei) | Return the current total value (principal + accrued yield) held by this adapter across all positions. Used by the vault for portfolio valuation and allocation caps. |
| **current_apy_bps** | — | `estimated_apy`: APY in basis points | Return the current estimated APY in basis points. 10000 = 100%. Used by the AI allocation engine to compare strategies. Should reflect recent performance, not a static marketing number. |
| **is_healthy** | — | `bool` | Return `true` if the underlying protocol is healthy and accepting deposits. Return `false` if utilization is too high (>95%), oracles are stale, the protocol is paused, or any other condition that makes deployment unsafe. The vault will not deploy to unhealthy adapters. |

---

## 3. How It Works

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         OBSQRA PRIVACY VAULT FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

  Users (private)                    VaultController                    Adapters
  ──────────────                     ───────────────                    ────────

       │                                    │                                │
       │  deposit via ZK proof              │                                │
       │ ─────────────────────────────────► │                                │
       │  (ConfidentialTransfer /           │  aggregated capital             │
       │   FullyShieldedPool)               │  (no user identity)             │
       │                                    │                                │
       │                                    │  AI generates allocation        │
       │                                    │  proposal (bounded by user     │
       │                                    │  constraints + zkML risk)       │
       │                                    │                                │
       │                                    │  commit_proposal(hash)          │
       │                                    │  ──────────────────────────►   │
       │                                    │  (dark pool: only hash visible) │
       │                                    │                                │
       │                                    │  execute_proposal(...)          │
       │                                    │  ──────────────────────────►   │
       │                                    │  adapter.deploy(amount, params)  │
       │                                    │  ──────────────────────────►   │
       │                                    │                                │  position_id
       │                                    │  ◄──────────────────────────   │
       │                                    │                                │
       │                                    │  (periodically)                 │
       │                                    │  adapter.harvest()              │
       │                                    │  ──────────────────────────►   │
       │                                    │                                │  harvested
       │                                    │  ◄──────────────────────────   │
       │                                    │                                │
       │  withdraw via ZK proof              │                                │
       │ ◄───────────────────────────────── │                                │
       │  (privacy pool releases)            │  adapter.withdraw(pos_id, amt) │
       │                                    │  ──────────────────────────►   │
       │                                    │                                │  actual_withdrawn
       │                                    │  ◄──────────────────────────   │
       │                                    │                                │
```

**Summary:** The VaultController receives aggregated capital from privacy pools. The AI generates an allocation proposal bounded by user constraints and zkML risk proofs. The proposal is committed on-chain (dark pool: only the hash is visible). The VaultController calls `adapter.deploy()` on each target adapter. Adapters earn yield; the VaultController calls `harvest()` periodically. When users withdraw via the privacy pool, the VaultController calls `adapter.withdraw()` to free capital.

---

## 4. Building an Adapter

### Step 1: Implement the Trait

Create a Cairo contract that implements `IStrategyAdapter`. Import the trait from the Obsqra contracts crate and use `#[abi(embed_v0)]` to expose the interface.

### Step 2: Add Access Control

Store the VaultController address in your contract. On every mutating function (`deploy`, `withdraw`, `harvest`), assert:

```cairo
assert(get_caller_address() == self.vault_controller.read(), 'only vault controller');
```

Only the VaultController may call these functions. Reject all other callers.

### Step 3: Track Positions Internally

Maintain a mapping or counter for positions. `deploy` returns a `position_id` (e.g. an incrementing counter or hash). The VaultController will pass this back to `withdraw`. Your adapter must be able to resolve `position_id` to the underlying protocol position.

### Step 4: Report Health Accurately

`is_healthy()` must return `false` when:

- Utilization > 95%
- Oracle data is stale (e.g. > 1 hour old)
- The underlying protocol is paused or compromised
- Liquidity is insufficient for expected withdrawals

The vault will not deploy to unhealthy adapters. Overstating health can lead to capital loss and protocol liability.

### Step 5: Report APY Accurately

`current_apy_bps()` is used by the AI allocation engine. Use recent performance data, not marketing numbers. If the protocol has variable rates, reflect the current rate. Inaccurate APY skews allocation decisions.

---

## 5. Security Requirements

| Requirement | Description |
|-------------|-------------|
| **Caller check** | Assert `caller == vault_controller` on all mutating functions (`deploy`, `withdraw`, `harvest`). |
| **Health detection** | `is_healthy()` must detect protocol issues: utilization >95%, oracle staleness, pause state, liquidity shortfalls. Return `false` when deployment is unsafe. |
| **No user PII** | Do not store user-identifying information. The adapter receives aggregate capital from the vault; individual users are invisible. |
| **Events** | Emit events for all state changes: `Deployed`, `Withdrawn`, `Harvested`. Include `position_id` and amounts for auditability. |
| **Admin separation** | Use a separate `admin` address for configuration (e.g. APY override, health override during testing). Admin must not be able to withdraw user funds. |

---

## 6. Example: BtcYieldAdapter

A hypothetical adapter for strkBTC yield (e.g. wrapped BTC staking or lending). Skeleton only—actual integration depends on the underlying protocol.

```cairo
#[starknet::contract]
mod BtcYieldAdapter {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        vault_controller: ContractAddress,
        admin: ContractAddress,
        total_deposited: u256,
        position_counter: felt252,
        apy_bps: u32,
        healthy: bool,
        // In production: map position_id -> underlying protocol position
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Deployed: Deployed,
        Withdrawn: Withdrawn,
        Harvested: Harvested,
    }

    #[derive(Drop, starknet::Event)]
    struct Deployed {
        #[key]
        position_id: felt252,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdrawn {
        #[key]
        position_id: felt252,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Harvested {
        amount: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, vault_controller: ContractAddress, admin: ContractAddress) {
        self.vault_controller.write(vault_controller);
        self.admin.write(admin);
        self.total_deposited.write(0);
        self.position_counter.write(0);
        self.apy_bps.write(350);  // 3.5%
        self.healthy.write(true);
    }

    fn assert_vault_controller(self: @ContractState) {
        assert(get_caller_address() == self.vault_controller.read(), 'only vault controller');
    }

    #[abi(embed_v0)]
    impl BtcYieldAdapterImpl of crate::strategy_adapter::IStrategyAdapter<ContractState> {
        fn deploy(ref self: ContractState, amount: u256, params: Span<felt252>) -> felt252 {
            assert_vault_controller(@self);
            // TODO: call underlying strkBTC yield protocol (e.g. supply, stake)
            let counter = self.position_counter.read() + 1;
            self.position_counter.write(counter);
            self.total_deposited.write(self.total_deposited.read() + amount);
            self.emit(Deployed { position_id: counter, amount });
            counter
        }

        fn withdraw(ref self: ContractState, position_id: felt252, amount: u256) -> u256 {
            assert_vault_controller(@self);
            // TODO: withdraw from underlying protocol, return actual amount
            let actual = amount;  // placeholder
            self.total_deposited.write(self.total_deposited.read() - actual);
            self.emit(Withdrawn { position_id, amount: actual });
            actual
        }

        fn harvest(ref self: ContractState) -> u256 {
            assert_vault_controller(@self);
            // TODO: claim rewards from underlying protocol
            let harvested: u256 = 0;
            self.emit(Harvested { amount: harvested });
            harvested
        }

        fn value_of(self: @ContractState) -> u256 {
            // TODO: query underlying protocol for total value (principal + accrued)
            self.total_deposited.read()
        }

        fn current_apy_bps(self: @ContractState) -> u32 {
            // TODO: fetch current rate from protocol or oracle
            self.apy_bps.read()
        }

        fn is_healthy(self: @ContractState) -> bool {
            // TODO: check utilization, oracle freshness, protocol pause
            self.healthy.read()
        }
    }
}
```

---

## 7. Getting Whitelisted

New adapters must be whitelisted by the Obsqra admin multi-sig before the VaultController will deploy capital to them.

| Tier | Requirements | Allocation |
|------|--------------|------------|
| **Verified** | Obsqra audit required. Adapter owned or audited by Obsqra. | No allocation caps. |
| **Community** | Whitelist approval via admin multi-sig. | Start at 5% max allocation (`max_allocation_bps = 500`). 7-day probation. |

**Process:**

1. Deploy your adapter contract.
2. Submit the adapter address and documentation to Obsqra.
3. Community tier: 7-day probation at 5% cap. After probation, admin may increase cap.
4. Verified tier: Complete Obsqra audit; no caps after approval.

**Contact:** [obsqra.xyz](https://obsqra.xyz)
