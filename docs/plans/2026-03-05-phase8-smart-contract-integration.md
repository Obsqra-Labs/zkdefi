# Phase 8: Smart Contract Integration — Proof Verification On-Chain

**Date**: 2026-03-05  
**Status**: PLANNED  
**Prerequisites**: Phase 7 (Real-Time Infrastructure) COMPLETE

---

## Goal

Wire proof verification into smart contracts so that **every vault operation requires a verified proof** before execution. Store proof hashes on-chain for transparency and auditability.

**Core Principle:** No capital movement without cryptographic proof of correct computation.

---

## Current State

### ✅ Backend Proof Generation (Phase 5)
- `proof_pipeline.py` generates STARK proofs for deposits, withdrawals, allocations
- `obsqra_prover_client.py` calls Stone prover service
- `receipt_service.py` creates off-chain receipts with `proof_hash`

### ✅ Smart Contracts Deployed
- `VaultController` (0x6c5b17eab7f20da1ab69e98db6f3f63cbcefa28992a17787883c76dd13498d1)
- `EkuboLPAdapter` (0x74febeff7301aa58d786b01756e36f20ab7208a52ce94a82b425af8f9933a0)
- `ProofGatedYieldAgent` with proof verification (exists, has `verify_proof`)
- ERC-8004 Fact Registry for proof storage

### ❌ Missing Integration
- **VaultController doesn't verify proofs** before `execute_proposal`
- **Proof hashes not stored on-chain** (only in backend receipts)
- **Session keys don't require proofs** for delegated execution
- **Privacy pools not connected** to vault deposits/withdrawals

---

## Tasks

### **Task 1: Add Proof Verification to VaultController (2 hours)**

**Objective:** Require a valid proof before allowing `execute_proposal` to deploy capital.

#### 1.1 Update VaultController Interface

Add new function that requires proof:

```cairo
// contracts/src/vault_controller.cairo
fn execute_proposal_with_proof(
    ref self: ContractState,
    adapters: Span<ContractAddress>,
    amounts: Span<u256>,
    salt: felt252,
    proof_hash: felt252,          // NEW: STARK proof hash
) {
    // Verify proof via ERC-8004 fact registry
    let registry = IFactRegistryDispatcher { contract_address: self.fact_registry.read() };
    let verifications = registry.get_all_verifications_for_fact_hash(proof_hash);
    assert(verifications.len() > 0, 'proof not verified');
    
    // Verify security bits meet threshold (e.g., >= 100)
    let first_verification = verifications.at(0);
    assert(*first_verification.security_bits >= 100, 'proof too weak');
    
    // Execute existing proposal logic
    // ... (rest of execute_proposal code)
}
```

#### 1.2 Add Proof Commitment Event

```cairo
#[derive(Drop, starknet::Event)]
struct ProofCommitted {
    #[key]
    proposal_hash: felt252,
    proof_hash: felt252,
    security_bits: u128,
    timestamp: u64,
}
```

#### 1.3 Update Backend Vault Service

Modify `vault_execute_service.py` to submit proof hash on-chain:

```python
# backend/app/services/vault_execute_service.py
async def execute_vault_allocation(
    user_address: str,
    allocations: List[AllocationTarget],
    deposit_amount: int,
) -> dict[str, Any]:
    # 1. Generate proof (already exists)
    proof = await proof_pipeline.generate_vault_allocation_proof(...)
    
    # 2. Submit proof to Integrity Fact Registry (NEW)
    await _submit_proof_to_registry(proof["fact_hash"], proof["proof_data"])
    
    # 3. Call VaultController.execute_proposal_with_proof (NEW)
    tx_hash = await _call_vault_controller_with_proof(
        adapters=[alloc.pool_id for alloc in allocations],
        amounts=[alloc.amount_wei for alloc in allocations],
        proof_hash=proof["fact_hash"],
    )
    
    # 4. Create on-chain receipt
    return {
        "deployment_id": deployment_id,
        "tx_hash": tx_hash,
        "proof_hash": proof["fact_hash"],
        "verified_on_chain": True,
    }
```

**Verification:**
```bash
# Deploy updated VaultController
cd contracts && scarb build
starkli declare target/dev/zkdefi_VaultController.contract_class.json

# Test proof verification
python -m pytest backend/tests/test_vault_proof_verification.py -v
```

---

### **Task 2: On-Chain Receipt Storage (1.5 hours)**

**Objective:** Store execution receipts on-chain for transparency and auditability.

#### 2.1 Create Receipt Registry Contract

```cairo
// contracts/src/receipt_registry.cairo
#[starknet::contract]
mod ReceiptRegistry {
    use starknet::ContractAddress;
    use starknet::storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess};
    
    #[derive(Drop, Copy, Serde, starknet::Store)]
    pub struct Receipt {
        user: ContractAddress,
        action_type: felt252,      // 'deposit', 'withdraw', 'allocate'
        amount: u256,
        proof_hash: felt252,
        timestamp: u64,
        tx_hash: felt252,
    }
    
    #[storage]
    struct Storage {
        receipts: Map<felt252, Receipt>,  // receipt_id => Receipt
        user_receipt_count: Map<ContractAddress, u64>,
        user_receipts: Map<(ContractAddress, u64), felt252>,  // (user, index) => receipt_id
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ReceiptCreated: ReceiptCreated,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ReceiptCreated {
        #[key]
        receipt_id: felt252,
        #[key]
        user: ContractAddress,
        action_type: felt252,
        proof_hash: felt252,
        timestamp: u64,
    }
    
    #[abi(embed_v0)]
    impl ReceiptRegistryImpl of super::IReceiptRegistry<ContractState> {
        fn create_receipt(
            ref self: ContractState,
            user: ContractAddress,
            action_type: felt252,
            amount: u256,
            proof_hash: felt252,
            tx_hash: felt252,
        ) -> felt252 {
            // Generate receipt_id = Poseidon(user, action_type, proof_hash, timestamp)
            let timestamp = get_block_timestamp();
            let receipt_id = poseidon_hash_span(
                array![user.into(), action_type, proof_hash, timestamp.into()].span()
            );
            
            let receipt = Receipt {
                user,
                action_type,
                amount,
                proof_hash,
                timestamp,
                tx_hash,
            };
            
            self.receipts.write(receipt_id, receipt);
            
            // Index for user queries
            let count = self.user_receipt_count.read(user);
            self.user_receipts.write((user, count), receipt_id);
            self.user_receipt_count.write(user, count + 1);
            
            self.emit(ReceiptCreated {
                receipt_id,
                user,
                action_type,
                proof_hash,
                timestamp,
            });
            
            receipt_id
        }
        
        fn get_receipt(self: @ContractState, receipt_id: felt252) -> Receipt {
            self.receipts.read(receipt_id)
        }
        
        fn get_user_receipt_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_receipt_count.read(user)
        }
        
        fn get_user_receipt_at_index(
            self: @ContractState,
            user: ContractAddress,
            index: u64
        ) -> felt252 {
            self.user_receipts.read((user, index))
        }
    }
}
```

#### 2.2 Wire Receipt Creation to VaultController

```cairo
// In VaultController.execute_proposal_with_proof
fn execute_proposal_with_proof(...) {
    // ... (proof verification) ...
    
    // Create on-chain receipt (NEW)
    let receipt_registry = IReceiptRegistryDispatcher {
        contract_address: self.receipt_registry.read()
    };
    let receipt_id = receipt_registry.create_receipt(
        user: get_caller_address(),
        action_type: 'allocate',
        amount: total_amount,
        proof_hash,
        tx_hash: get_tx_info().unbox().transaction_hash,
    );
    
    // Emit with receipt_id
    self.emit(ProposalExecuted {
        proposal_hash: pending,
        adapter_count,
        timestamp: now,
        receipt_id,  // NEW
    });
}
```

**Verification:**
```bash
# Deploy ReceiptRegistry
scarb build && starkli declare target/dev/zkdefi_ReceiptRegistry.contract_class.json

# Test receipt creation
python -m pytest backend/tests/test_on_chain_receipts.py -v
```

---

### **Task 3: Session Key Proof Requirements (1 hour)**

**Objective:** Require zkML risk proof before allowing session key to execute delegated actions.

#### 3.1 Update SessionKeyManager

```cairo
// contracts/src/session_key_manager.cairo
fn validate_session_with_proof(
    self: @ContractState,
    session_id: felt252,
    proof_hash: felt252,
    protocol_id: u8,
    amount: u256
) -> bool {
    let session = self.sessions.read(session_id);
    assert(session.is_active, 'session not active');
    
    // Verify proof via ERC-8004 (NEW: stricter check)
    let registry = IFactRegistryDispatcher {
        contract_address: self.fact_registry.read()
    };
    let verifications = registry.get_all_verifications_for_fact_hash(proof_hash);
    
    // Require at least 128 security bits for session-delegated actions
    assert(verifications.len() > 0, 'proof not found');
    let security_bits = *verifications.at(0).security_bits;
    assert(security_bits >= 128, 'proof security too low');
    
    // Verify proof is recent (within 1 hour)
    let proof_timestamp = *verifications.at(0).timestamp;  // Assuming registry stores timestamp
    let now = get_block_timestamp();
    assert(now <= proof_timestamp + 3600, 'proof expired');
    
    // Check constraints
    self._check_constraints(session_id, protocol_id, amount)
}
```

#### 3.2 Update Backend Session Key Service

```python
# backend/app/services/session_key_service.py
async def execute_with_session_key(
    session_id: str,
    user_address: str,
    action: str,
    amount: int,
    pool_id: str,
) -> dict[str, Any]:
    # 1. Generate zkML risk proof (NEW: required for session execution)
    risk_proof = await zkml_risk_service.generate_risk_proof(
        user_address=user_address,
        pool_id=pool_id,
        action=action,
        amount=amount,
    )
    
    # 2. Submit proof to registry
    await _submit_proof_to_registry(risk_proof["fact_hash"], risk_proof["proof_data"])
    
    # 3. Call SessionKeyManager.validate_session_with_proof
    is_valid = await _validate_session_with_proof(
        session_id=session_id,
        proof_hash=risk_proof["fact_hash"],
        protocol_id=0,  # Ekubo
        amount=amount,
    )
    
    if not is_valid:
        raise ValueError("Session validation failed: proof rejected")
    
    # 4. Execute action
    return await _execute_session_action(session_id, action, amount, pool_id)
```

**Verification:**
```bash
# Test session key proof requirement
curl -X POST http://localhost:8003/api/v1/zkdefi/session_keys/execute \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "0x123...",
    "action": "deposit",
    "amount": 1000000000000000000,
    "pool_id": "ETH_USDC_500"
  }'

# Should fail without valid zkML proof
```

---

### **Task 4: Privacy Pool Integration (1.5 hours)**

**Objective:** Connect `FullyShieldedPool` to vault deposits/withdrawals for privacy-preserving capital flow.

#### 4.1 Add Shielded Deposit Flow

```python
# backend/app/services/privacy_vault_service.py
async def shielded_deposit(
    user_address: str,
    amount_wei: int,
    nullifier: str,  # User-generated secret
) -> dict[str, Any]:
    """
    Deposit funds through FullyShieldedPool:
    1. Generate Poseidon commitment = Poseidon(nullifier, amount)
    2. Call FullyShieldedPool.deposit(commitment)
    3. Store nullifier locally (encrypted with user's pubkey)
    4. Generate deposit proof
    5. Create receipt with commitment (not amount)
    """
    # 1. Generate commitment
    commitment = poseidon_hash([nullifier, amount_wei])
    
    # 2. Call FullyShieldedPool.deposit
    pool_address = os.getenv("NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS")
    tx_hash = await _call_shielded_pool_deposit(commitment)
    
    # 3. Generate deposit proof (prove commitment was computed correctly)
    proof = await proof_pipeline.generate_private_deposit_proof(
        nullifier=nullifier,
        amount=amount_wei,
        commitment=commitment,
    )
    
    # 4. Store encrypted nullifier
    encrypted_nullifier = await _encrypt_for_user(nullifier, user_address)
    await _store_nullifier(user_address, commitment, encrypted_nullifier)
    
    # 5. Create receipt (commitment only, amount hidden)
    receipt_id = await receipt_service.create_receipt(
        user_address=user_address,
        action_type="shielded_deposit",
        commitment=commitment,
        proof_hash=proof["fact_hash"],
        tx_hash=tx_hash,
    )
    
    return {
        "receipt_id": receipt_id,
        "commitment": commitment,
        "tx_hash": tx_hash,
        "proof_hash": proof["fact_hash"],
    }
```

#### 4.2 Add Shielded Withdrawal Flow

```python
async def shielded_withdraw(
    user_address: str,
    nullifier: str,
    amount_wei: int,
    recipient: str,
) -> dict[str, Any]:
    """
    Withdraw funds from FullyShieldedPool:
    1. Retrieve commitment from local storage
    2. Generate zero-knowledge withdrawal proof
    3. Call FullyShieldedPool.withdraw(proof, recipient, amount)
    4. Mark nullifier as spent
    5. Create receipt
    """
    # 1. Retrieve commitment
    commitment = poseidon_hash([nullifier, amount_wei])
    stored_commitment = await _get_user_commitment(user_address, commitment)
    assert stored_commitment is not None, "Commitment not found"
    
    # 2. Generate withdrawal proof (proves ownership without revealing nullifier)
    proof = await proof_pipeline.generate_private_withdraw_proof(
        nullifier=nullifier,
        amount=amount_wei,
        commitment=commitment,
        recipient=recipient,
    )
    
    # 3. Call FullyShieldedPool.withdraw
    pool_address = os.getenv("NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS")
    tx_hash = await _call_shielded_pool_withdraw(
        proof=proof["calldata"],
        recipient=recipient,
        amount=amount_wei,
    )
    
    # 4. Mark nullifier as spent (prevent double-spend)
    await _mark_nullifier_spent(commitment)
    
    # 5. Create receipt
    receipt_id = await receipt_service.create_receipt(
        user_address=user_address,
        action_type="shielded_withdraw",
        amount=amount_wei,  # Revealed on withdrawal
        proof_hash=proof["fact_hash"],
        tx_hash=tx_hash,
    )
    
    return {
        "receipt_id": receipt_id,
        "tx_hash": tx_hash,
        "proof_hash": proof["fact_hash"],
    }
```

#### 4.3 Add Frontend Privacy Vault UI

```typescript
// frontend/src/components/zkdefi/vault/PrivacyVaultPanel.tsx
export function PrivacyVaultPanel() {
  const [nullifier, setNullifier] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  
  const handleShieldedDeposit = async () => {
    // 1. Generate random nullifier (32 bytes)
    const nullifier = generateRandomNullifier();
    
    // 2. Call backend
    const res = await fetch(`${API_BASE}/api/v1/vault/shielded_deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_address: address,
        amount_wei: parseEther(amount).toString(),
        nullifier,
      }),
    });
    
    const data = await res.json();
    
    // 3. Store nullifier locally (encrypted in IndexedDB)
    await storeNullifier(data.commitment, nullifier);
    
    alert(`Deposit successful! Commitment: ${data.commitment}`);
  };
  
  return (
    <div>
      <h2>Privacy Vault (Shielded Pool)</h2>
      <p>Deposit funds without revealing amount on-chain.</p>
      
      <Input
        type="number"
        placeholder="Amount (ETH)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      
      <Button onClick={handleShieldedDeposit}>
        Shielded Deposit
      </Button>
    </div>
  );
}
```

**Verification:**
```bash
# Test shielded deposit flow
curl -X POST http://localhost:8003/api/v1/vault/shielded_deposit \
  -H "Content-Type: application/json" \
  -d '{
    "user_address": "0x123...",
    "amount_wei": "1000000000000000000",
    "nullifier": "0xabcdef..."
  }'

# Verify commitment stored on-chain but amount is hidden
```

---

## Files to Create/Modify

### Smart Contracts (Cairo)
- `contracts/src/vault_controller.cairo` (add `execute_proposal_with_proof`)
- `contracts/src/receipt_registry.cairo` (NEW: on-chain receipt storage)
- `contracts/src/session_key_manager.cairo` (add proof timestamp check)

### Backend Services
- `backend/app/services/vault_execute_service.py` (wire proof to VaultController)
- `backend/app/services/privacy_vault_service.py` (NEW: shielded deposit/withdraw)
- `backend/app/services/session_key_service.py` (require zkML proof for execution)
- `backend/app/api/routes/vault_v2.py` (add `/shielded_deposit`, `/shielded_withdraw`)

### Frontend
- `frontend/src/components/zkdefi/vault/PrivacyVaultPanel.tsx` (NEW: shielded pool UI)
- `frontend/src/app/agent/page.tsx` (add Privacy Vault tab)

### Tests
- `backend/tests/test_vault_proof_verification.py` (NEW: test proof requirement)
- `backend/tests/test_on_chain_receipts.py` (NEW: test receipt storage)
- `backend/tests/test_session_key_proofs.py` (NEW: test session proof validation)
- `backend/tests/test_privacy_vault.py` (NEW: test shielded flows)

---

## Success Criteria

1. ✅ **Proof Verification**: VaultController rejects `execute_proposal` without valid proof
2. ✅ **On-Chain Receipts**: Every vault action creates on-chain receipt with proof hash
3. ✅ **Session Key Proofs**: Session-delegated actions require recent zkML risk proof
4. ✅ **Privacy Pools**: Users can deposit/withdraw through FullyShieldedPool with hidden amounts

---

## Risks & Mitigations

### Risk 1: Proof Generation Latency
**Impact:** User waits 30-60s for STARK proof before transaction can execute  
**Mitigation:** 
- Show progress bar during proof generation
- Allow users to approve allocation while proof generates in background
- Cache proofs for similar operations (30min TTL)

### Risk 2: On-Chain Storage Costs
**Impact:** Storing receipts on-chain increases gas fees  
**Mitigation:**
- Store only critical fields (proof_hash, timestamp, user, action_type)
- Emit events for full data, use storage for indices only

### Risk 3: Privacy Pool Nullifier Management
**Impact:** If user loses nullifier, they can't withdraw shielded deposits  
**Mitigation:**
- Encrypt nullifiers with user's wallet pubkey
- Store encrypted nullifiers in backend + IndexedDB
- Provide "export nullifiers" feature for backup

---

## Timeline

- **Task 1 (Proof Verification)**: 2 hours
- **Task 2 (On-Chain Receipts)**: 1.5 hours
- **Task 3 (Session Key Proofs)**: 1 hour
- **Task 4 (Privacy Pool Integration)**: 1.5 hours

**Total**: ~6 hours for complete smart contract integration

---

## Next Phase: Phase 9

After smart contract integration, the next priorities are:

1. **PostgreSQL Migration**: Replace JSON files with production database
2. **Historical Intelligence (zkGraph)**: Add time-series analysis for strategy evolution
3. **Performance Analytics**: Charts showing strategy ROI, IL, risk over time
4. **Production Monitoring**: Datadog/Grafana for system health

---

**Last Updated**: 2026-03-05  
**Author**: Obsqra Labs
