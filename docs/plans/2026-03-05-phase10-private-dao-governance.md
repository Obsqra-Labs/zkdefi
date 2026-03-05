# Phase 10: Private DAO Governance

**Created:** March 5, 2026  
**Status:** Ready to Execute  
**Duration:** ~4 hours  
**Prerequisites:** Phase 9C complete (deployed + tested)

---

## Objective

Implement private DAO governance for emergency controls and pool parameter management, enabling community oversight with selective disclosure for privacy-preserving voting.

---

## Vision

**"Privacy + Verification = zkDeFi" extends to governance:**

- Pool participants vote on constraints (emergency controls, asset whitelisting, adapter limits)
- Votes are private (hidden via ZK proofs)
- Results are public and verifiable
- Multi-sig fallback for critical emergencies
- Complies with HACKATHON_FEATURE_COVERAGE.md "Private Voting System"

---

## Success Criteria

1. ✅ DAOConstraintManager contract deployed
2. ✅ Private voting implemented (ZK proofs hide vote direction)
3. ✅ Multi-sig emergency controls integrated
4. ✅ Proposal system for pool parameter changes
5. ✅ Frontend UI for governance participation
6. ✅ Documentation with governance guide

---

## Architecture

### Governance Hierarchy

```
Community DAO (pool token holders)
  ├── Propose parameter changes (adapter limits, asset whitelist, etc.)
  ├── Vote privately (ZK proofs)
  └── Execute if quorum + majority reached

Multi-sig Council (5-of-7 trusted operators)
  ├── Emergency circuit breakers
  ├── Critical contract upgrades
  └── Override DAO decisions if security threat

VaultController
  ├── Reads constraints from DAOConstraintManager
  ├── Enforces voted parameters
  └── Respects emergency pauses
```

### Voting Power

**Based on liquidity provision:**
```
voting_power = sqrt(lp_position_size_usd)
```

**Why square root?**
- Reduces whale dominance (quadratic voting benefits)
- Still rewards larger LPs
- More democratic than linear (1 USD = 1 vote)

---

## Tasks

### Task 1: Design DAOConstraintManager Contract

**Goal:** Smart contract for on-chain governance

**Cairo Interface:**
```cairo
#[starknet::interface]
pub trait IDAOConstraintManager<TContractState> {
    // Proposal lifecycle
    fn create_proposal(
        ref self: TContractState,
        proposal_type: felt252,        // 'adapter_limit', 'whitelist_asset', 'emergency_pause'
        target: ContractAddress,       // Adapter or asset address
        new_value: u256,               // New parameter value
        description: ByteArray,
        vote_duration_seconds: u64,
    ) -> u256;  // Returns proposal_id
    
    // Private voting
    fn cast_vote_with_proof(
        ref self: TContractState,
        proposal_id: u256,
        vote_proof: Span<felt252>,     // ZK proof of: I have X voting power, I vote YES/NO
        nullifier: felt252,            // Prevents double voting
    );
    
    // Tallying
    fn tally_votes(ref self: TContractState, proposal_id: u256);
    fn execute_proposal(ref self: TContractState, proposal_id: u256);
    
    // Multi-sig emergency
    fn emergency_pause(ref self: TContractState, target: ContractAddress);
    fn emergency_unpause(ref self: TContractState, target: ContractAddress);
    
    // Queries
    fn get_proposal(self: @TContractState, proposal_id: u256) -> Proposal;
    fn get_voting_power(self: @TContractState, user: ContractAddress) -> u256;
    fn is_multisig_signer(self: @TContractState, signer: ContractAddress) -> bool;
}
```

**Proposal Struct:**
```cairo
struct Proposal {
    id: u256,
    proposer: ContractAddress,
    proposal_type: felt252,
    target: ContractAddress,
    new_value: u256,
    description: ByteArray,
    
    // Voting
    votes_for: u256,        // Aggregated from ZK proofs
    votes_against: u256,
    total_votes: u256,
    
    // Status
    created_at: u64,
    voting_ends_at: u64,
    executed: bool,
    passed: bool,
    
    // Privacy
    nullifiers_spent: Map<felt252, bool>,  // Prevent double voting
}
```

**Steps:**
1. Create `contracts/src/dao_constraint_manager.cairo`
2. Implement proposal creation (anyone can propose if meets threshold)
3. Implement private voting with ZK proof verification
4. Implement tally + execution logic
5. Add multi-sig emergency controls (5-of-7)
6. Write tests in `contracts/tests/test_dao_governance.cairo`

**Verification:**
```bash
cd contracts
scarb build
scarb test test_create_proposal
scarb test test_private_vote
scarb test test_emergency_pause
```

---

### Task 2: Create Voting Circuit

**Goal:** ZK circuit for private voting

**Circuit:** `circuits/private_vote.circom`

```circom
pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/pedersen.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template PrivateVote() {
    // Private inputs
    signal input secret;           // User's voting secret
    signal input voting_power;     // sqrt(lp_position_size)
    signal input vote_direction;   // 0 = against, 1 = for
    
    // Public inputs
    signal input proposal_id;
    signal input nullifier_hash;   // Prevents double voting
    
    // Outputs
    signal output commitment;      // Commitment to this vote
    signal output vote_value;      // voting_power * vote_direction (for tally)
    
    // Compute nullifier (prevents double voting)
    component nullifier = Pedersen(2);
    nullifier.in[0] <== secret;
    nullifier.in[1] <== proposal_id;
    nullifier.out[0] === nullifier_hash;
    
    // Compute commitment
    component commit = Pedersen(3);
    commit.in[0] <== secret;
    commit.in[1] <== voting_power;
    commit.in[2] <== vote_direction;
    commitment <== commit.out[0];
    
    // Validate vote_direction is 0 or 1
    vote_direction * (vote_direction - 1) === 0;
    
    // Compute vote value for tallying
    vote_value <== voting_power * vote_direction;
}

component main {public [proposal_id, nullifier_hash]} = PrivateVote();
```

**What this proves:**
- I have `voting_power` VP
- I vote `vote_direction` (0 or 1)
- My nullifier is `nullifier_hash` (derived from secret + proposal_id)
- I haven't voted before (nullifier not spent)

**What this hides:**
- My identity (no address in proof)
- My exact voting power (aggregated in tally)
- How I voted (vote_direction private)

**Steps:**
1. Create circuit file
2. Compile: `circom private_vote.circom --r1cs --wasm --sym -o build/`
3. Generate proving key: `snarkjs groth16 setup ...`
4. Export verifier: `snarkjs zkey export verifier ... verifier.cairo`
5. Test locally with sample inputs

**Verification:**
```bash
# Generate witness
node build/private_vote.wasm test_input.json witness.wtns

# Generate proof
snarkjs groth16 prove build/private_vote_final.zkey witness.wtns proof.json public.json

# Verify proof
snarkjs groth16 verify build/private_vote_vkey.json public.json proof.json
# Should print: OK!
```

---

### Task 3: Integrate Voting Service

**Goal:** Backend service for generating voting proofs

**Service:** `backend/app/services/dao_voting_service.py`

```python
class DAOVotingService:
    def __init__(self):
        self.circuit_path = "circuits/build/private_vote.wasm"
        self.proving_key = "circuits/build/private_vote_final.zkey"
    
    async def generate_voting_proof(
        self,
        user_address: str,
        proposal_id: int,
        vote_direction: int,  # 0 = against, 1 = for
    ) -> VotingProof:
        # 1. Get user's voting power from VaultController
        voting_power = await self._get_voting_power(user_address)
        
        # 2. Generate secret (or retrieve from secure storage)
        secret = self._get_or_create_voting_secret(user_address)
        
        # 3. Compute nullifier
        nullifier_hash = poseidon_hash([secret, proposal_id])
        
        # 4. Generate witness
        witness_input = {
            "secret": secret,
            "voting_power": voting_power,
            "vote_direction": vote_direction,
            "proposal_id": proposal_id,
            "nullifier_hash": nullifier_hash,
        }
        witness = await generate_witness(self.circuit_path, witness_input)
        
        # 5. Generate Groth16 proof
        proof = await generate_groth16_proof(self.proving_key, witness)
        
        return VotingProof(
            proof_calldata=proof.calldata,
            nullifier_hash=nullifier_hash,
            commitment=proof.public_outputs[0],
            vote_value=proof.public_outputs[1],  # For on-chain tally
        )
    
    async def _get_voting_power(self, user_address: str) -> int:
        # Query VaultController for user's LP position
        position_value_usd = await vault_client.get_position_value(user_address)
        # Square root for quadratic voting
        return int(math.sqrt(position_value_usd))
```

**API Endpoint:** `backend/app/api/routes/dao_governance.py`

```python
@router.post("/dao/vote")
async def cast_vote(request: VoteRequest):
    # Generate proof
    proof = await dao_voting_service.generate_voting_proof(
        user_address=request.user_address,
        proposal_id=request.proposal_id,
        vote_direction=request.vote_direction,
    )
    
    # Submit to DAOConstraintManager
    tx_hash = await contract_service.cast_vote_with_proof(
        proposal_id=request.proposal_id,
        vote_proof=proof.proof_calldata,
        nullifier=proof.nullifier_hash,
    )
    
    return VoteResponse(
        tx_hash=tx_hash,
        nullifier_hash=proof.nullifier_hash,
        vote_recorded=True,
    )
```

---

### Task 4: Multi-Sig Emergency Controls

**Goal:** 5-of-7 multi-sig for critical actions

**Contract Integration:**
```cairo
// In DAOConstraintManager
struct MultisigConfig {
    signers: Map<ContractAddress, bool>,
    threshold: u8,  // 5
    total_signers: u8,  // 7
}

fn emergency_pause(ref self: ContractState, target: ContractAddress) {
    // Require 5-of-7 signatures
    let signatures_required = self.multisig_config.threshold.read();
    assert(self.verify_multisig_signatures() >= signatures_required, 'insufficient sigs');
    
    // Pause target adapter/pool
    let vault = IVaultControllerDispatcher { contract_address: self.vault.read() };
    vault.trigger_circuit_breaker(target);
    
    self.emit(EmergencyPause { target, paused_by: get_caller_address() });
}
```

**Multi-sig Signers (Deployment):**
1. obsqra.xyz team lead
2. Starknet community representative
3. Security researcher
4. DeFi protocol partner
5. Independent auditor
6. Community elected member
7. Reserve signer

**Steps:**
1. Add multisig logic to DAOConstraintManager
2. Implement signature aggregation
3. Add emergency pause/unpause functions
4. Connect to VaultController circuit breakers
5. Create admin UI for signers

---

### Task 5: Frontend Governance UI

**Goal:** User-friendly governance interface

**Components:**

**1. GovernanceHub.tsx** - Main governance page
```tsx
export function GovernanceHub() {
  return (
    <div className="space-y-6">
      <GovernanceHeader />
      <ActiveProposals />
      <VotingPowerDisplay />
      <ProposalHistory />
      <CreateProposalButton />
    </div>
  );
}
```

**2. ProposalCard.tsx** - Individual proposal display
```tsx
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  return (
    <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-900/20 to-slate-900/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">{proposal.description}</h3>
        <ProposalStatus status={proposal.status} />
      </div>
      
      <VotingProgress 
        votesFor={proposal.votes_for}
        votesAgainst={proposal.votes_against}
      />
      
      <div className="mt-4 flex gap-3">
        <VoteButton proposal={proposal} direction="for" />
        <VoteButton proposal={proposal} direction="against" />
      </div>
      
      <ProvenanceDisplay 
        provenance={proposal.voting_proof_provenance}
        variant="compact"
      />
    </div>
  );
}
```

**3. PrivateVoteModal.tsx** - Voting interface
```tsx
export function PrivateVoteModal({ proposal, onClose }: Props) {
  const [voteDirection, setVoteDirection] = useState<"for" | "against">("for");
  const [generating, setGenerating] = useState(false);
  
  async function handleVote() {
    setGenerating(true);
    
    // Generate ZK proof
    const proof = await fetch("/api/v1/dao/vote", {
      method: "POST",
      body: JSON.stringify({
        user_address: address,
        proposal_id: proposal.id,
        vote_direction: voteDirection === "for" ? 1 : 0,
      }),
    }).then(r => r.json());
    
    // Submit on-chain
    await account.execute([{
      contractAddress: DAO_MANAGER_ADDRESS,
      entrypoint: "cast_vote_with_proof",
      calldata: [
        proposal.id,
        proof.proof_calldata.length,
        ...proof.proof_calldata,
        proof.nullifier_hash,
      ],
    }]);
    
    toast.success("Vote recorded privately");
    onClose();
  }
  
  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <h2 className="text-xl font-semibold mb-4">Private Vote</h2>
        
        <div className="space-y-4">
          <VotingPowerDisplay power={yourVotingPower} />
          
          <RadioGroup value={voteDirection} onChange={setVoteDirection}>
            <Radio value="for">Vote For</Radio>
            <Radio value="against">Vote Against</Radio>
          </RadioGroup>
          
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-xs">
            <Shield className="w-4 h-4 inline mr-2" />
            Your vote is private. A zero-knowledge proof will hide your vote direction and identity.
          </div>
          
          <Button onClick={handleVote} disabled={generating}>
            {generating ? "Generating Proof..." : "Cast Private Vote"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

**Route:** Add `/governance` page to Next.js

---

### Task 6: Proposal Types

**Goal:** Support different governance actions

**1. Adapter Limit Adjustment**
```
Proposal: "Increase Ekubo adapter limit from 50% to 60%"
  - proposal_type: 'adapter_limit'
  - target: ekubo_adapter_address
  - new_value: 6000 (basis points)
  - duration: 7 days
```

**2. Asset Whitelist**
```
Proposal: "Whitelist strkBTC for vault deposits"
  - proposal_type: 'whitelist_asset'
  - target: strkBTC_token_address
  - new_value: 1 (true)
  - duration: 3 days
```

**3. Emergency Pause**
```
Proposal: "Pause Ekubo adapter due to exploit"
  - proposal_type: 'emergency_pause'
  - target: ekubo_adapter_address
  - new_value: 1 (paused)
  - duration: 1 day (fast-track)
```

**Implementation:**
- Each proposal type has validation logic
- Different quorum requirements (emergency = 66%, normal = 51%)
- Execution logic per type

---

### Task 7: Testing

**Goal:** Verify governance works end-to-end

**Test Scenarios:**

**1. Create Proposal:**
```bash
# User with >1% voting power creates proposal
curl -X POST http://localhost:8003/api/v1/dao/proposals \
  -d '{"proposer": "0x123", "type": "adapter_limit", "target": "0xabc", "new_value": 6000}'
  
# Should return proposal_id
```

**2. Cast Private Vote:**
```bash
# Multiple users vote
curl -X POST http://localhost:8003/api/v1/dao/vote \
  -d '{"user_address": "0x123", "proposal_id": 1, "vote_direction": 1}'
  
# Should return tx_hash with proof
```

**3. Tally Votes:**
```bash
# After voting period ends
starkli invoke <dao_manager> tally_votes 1

# Should aggregate votes_for and votes_against
```

**4. Execute Proposal:**
```bash
# If passed (>51% for, quorum met)
starkli invoke <dao_manager> execute_proposal 1

# Should update VaultController adapter limit
```

**5. Emergency Multi-Sig:**
```bash
# 5 signers sign emergency pause
starkli invoke <dao_manager> emergency_pause <ekubo_adapter>

# Should immediately pause adapter
```

---

### Task 8: Documentation

**Goal:** Governance guide for users

**New Doc:** `docs-site/docs/governance.md`

```markdown
# Private DAO Governance

## Overview

zkDeFi uses private DAO governance for community oversight with zero-knowledge voting.

## Voting Power

Your voting power = sqrt(your LP position in USD)

Example:
- $10,000 position = 100 voting power
- $40,000 position = 200 voting power (quadratic benefits smaller holders)

## Proposal Types

1. **Adapter Limits** - Adjust max allocation to strategies
2. **Asset Whitelist** - Add new assets for deposits
3. **Emergency Actions** - Pause adapters if exploit detected

## How to Vote Privately

1. Navigate to /governance
2. View active proposals
3. Click "Vote"
4. Select For/Against
5. Click "Cast Private Vote"
6. System generates ZK proof (hides your vote direction)
7. Sign transaction
8. Vote recorded on-chain (private)

## Privacy Guarantees

- Your vote direction is hidden (only you know)
- Your voting power is aggregated (not revealed individually)
- Nullifiers prevent double voting
- Results are public and verifiable

## Multi-Sig Emergency

For critical security issues, 5-of-7 trusted signers can:
- Immediately pause adapters
- Override DAO decisions
- Trigger circuit breakers

Signers: [list of signers with roles]
```

---

## Time Estimates

- Task 1 (DAOConstraintManager): 60 minutes
- Task 2 (Voting circuit): 45 minutes
- Task 3 (Backend service): 45 minutes
- Task 4 (Multi-sig): 30 minutes
- Task 5 (Frontend UI): 60 minutes
- Task 6 (Proposal types): 20 minutes
- Task 7 (Testing): 30 minutes
- Task 8 (Documentation): 20 minutes

**Total:** ~5 hours 30 minutes

---

## Success Checklist

- [ ] DAOConstraintManager contract deployed
- [ ] Private voting circuit compiled and tested
- [ ] Backend voting service functional
- [ ] Multi-sig emergency controls work
- [ ] Frontend governance UI complete
- [ ] All proposal types implemented
- [ ] End-to-end governance test passes
- [ ] Documentation complete
- [ ] Satisfies HACKATHON_FEATURE_COVERAGE.md "Private Voting System"

---

**Result:** Community governance with full privacy + cryptographic verification.
