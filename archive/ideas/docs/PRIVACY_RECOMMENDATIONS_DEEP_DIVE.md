# Deep Dive: Practical Use-Cases for Privacy Track Recommendations

## Overview

This document explores how each recommendation would work in practice, with concrete examples, integration points, and implementation details.

---

## 1. SEALED-BID AUCTION (Private DeFi & Commerce)

### Use-Case: Agent-Participated NFT/Token Auctions

**Problem:**
- Your agent wants to bid on a rare NFT or token allocation
- If you reveal your bid early, others front-run or outbid you
- Traditional auctions expose all bids → MEV extraction

### How It Works

#### Phase 1: Bid Submission (Hidden)

```cairo
// New contract: SealedBidAuction.cairo
#[starknet::interface]
pub trait ISealedBidAuction<TContractState> {
    fn submit_bid(
        ref self: TContractState,
        auction_id: felt252,
        bid_commitment: felt252,  // Hash of (bid_amount, nonce, user_address)
        proof_hash: felt252        // Proof that bid is within user's max_position constraint
    );
    
    fn reveal_bid(
        ref self: TContractState,
        auction_id: felt252,
        bid_amount: u256,
        nonce: felt252,
        proof_hash: felt252        // Proof that revealed bid matches commitment
    );
}
```

**Backend Flow:**
```python
# backend/app/api/zkdefi_agent.py
@router.post("/auction/submit_bid")
async def submit_sealed_bid(data: SealedBidRequest):
    """
    Generate sealed bid: commitment + proof that bid is within constraints.
    """
    # 1. Generate commitment: hash(bid_amount, nonce, user_address)
    commitment = hash_bid(data.bid_amount, data.nonce, data.user_address)
    
    # 2. Generate proof: "bid_amount <= max_position" (using existing constraint proof)
    proof_result = await svc.deposit_with_constraints(
        user_address=data.user_address,
        protocol_id=0,  # Auction doesn't use protocol
        amount=data.bid_amount,
        constraints={"max_position": data.user_max_position}
    )
    
    return {
        "commitment": commitment,
        "proof_hash": proof_result["proof_hash"],
        "auction_id": data.auction_id
    }
```

**Frontend Flow:**
```typescript
// frontend/src/components/zkdefi/SealedBidAuction.tsx
const handleSubmitBid = async () => {
  // 1. User enters bid amount
  const bidAmount = parseFloat(amountInput.value);
  
  // 2. Generate commitment (hidden from other bidders)
  const response = await fetch(`${API_BASE}/api/v1/zkdefi/auction/submit_bid`, {
    method: "POST",
    body: JSON.stringify({
      user_address: address,
      auction_id: auctionId,
      bid_amount: bidAmount * 1e18,
      user_max_position: maxPosition
    })
  });
  
  const { commitment, proof_hash } = await response.json();
  
  // 3. Submit commitment to contract (amount hidden)
  await account.execute({
    contractAddress: AUCTION_CONTRACT,
    entrypoint: "submit_bid",
    calldata: [auctionId, commitment, proof_hash]
  });
  
  // 4. Store reveal data locally (bid_amount, nonce) for reveal phase
  localStorage.setItem(`bid_${auctionId}`, JSON.stringify({
    bid_amount: bidAmount,
    nonce: nonce,
    commitment: commitment
  }));
};
```

#### Phase 2: Reveal Phase

```typescript
const handleRevealBid = async () => {
  // 1. Retrieve stored bid data
  const bidData = JSON.parse(localStorage.getItem(`bid_${auctionId}`));
  
  // 2. Generate proof: revealed bid matches commitment
  const response = await fetch(`${API_BASE}/api/v1/zkdefi/auction/reveal_bid`, {
    method: "POST",
    body: JSON.stringify({
      user_address: address,
      auction_id: auctionId,
      bid_amount: bidData.bid_amount,
      nonce: bidData.nonce,
      commitment: bidData.commitment
    })
  });
  
  const { proof_hash } = await response.json();
  
  // 3. Reveal bid on-chain
  await account.execute({
    contractAddress: AUCTION_CONTRACT,
    entrypoint: "reveal_bid",
    calldata: [auctionId, bidData.bid_amount, bidData.nonce, proof_hash]
  });
};
```

### Integration with Existing System

- **Uses existing proof-gating:** Same Integrity fact registry
- **Uses existing commitment scheme:** Same Garaga/Groth16 infrastructure
- **Agent can bid autonomously:** Within user's max_position constraint
- **Selective disclosure:** "I bid above X" without revealing exact amount

### Practical Example

```
Timeline:
Day 1: NFT auction opens
  - User sets constraint: "Agent can bid up to 10 ETH on rare NFTs"
  - Agent finds NFT auction → Generates sealed bid (8 ETH commitment)
  - Other bidders see: "Commitment 0xabc..." (no amount visible)
  
Day 7: Auction closes, reveal phase begins
  - Agent reveals bid: 8 ETH
  - Proof verifies: revealed bid matches commitment
  - Highest valid bid wins
  
Day 8: Winner announced
  - Agent won → NFT transferred
  - Proof shows: bid was within constraint (8 ETH < 10 ETH max)
  - Losers' bids stay private (only winner's amount revealed)
```

### Privacy Benefits

- **No front-running:** Bids hidden until reveal
- **No bid manipulation:** Can't see others' bids
- **MEV protection:** Intent hidden
- **Compliance proof:** "I bid within my limits" without revealing strategy

---

## 2. PRIVATE VOTING (Private Governance)

### Use-Case: Agent Governance for DeFi Protocols

**Problem:**
- Your agent holds tokens in multiple protocols
- Protocols have governance votes (proposals, parameter changes)
- If you reveal your vote early, others can manipulate or front-run
- You want to prove eligibility without revealing holdings

### How It Works

#### Phase 1: Vote Submission (Hidden)

```cairo
// New contract: PrivateVoting.cairo
#[starknet::interface]
pub trait IPrivateVoting<TContractState> {
    fn submit_vote(
        ref self: TContractState,
        proposal_id: felt252,
        vote_commitment: felt252,  // Hash of (vote_choice, nonce, user_address)
        eligibility_proof_hash: felt252  // Proof that user holds enough tokens
    );
    
    fn reveal_vote(
        ref self: TContractState,
        proposal_id: felt252,
        vote_choice: u8,  // 0 = NO, 1 = YES, 2 = ABSTAIN
        nonce: felt252,
        proof_hash: felt252  // Proof that revealed vote matches commitment
    );
}
```

**Backend Flow:**
```python
@router.post("/voting/submit_vote")
async def submit_private_vote(data: PrivateVoteRequest):
    """
    Generate private vote: commitment + eligibility proof.
    """
    # 1. Generate commitment: hash(vote_choice, nonce, user_address)
    commitment = hash_vote(data.vote_choice, data.nonce, data.user_address)
    
    # 2. Generate eligibility proof: "I hold >= min_voting_tokens"
    # Uses selective disclosure: prove holdings without revealing amount
    disclosure_proof = await svc.generate_disclosure_proof(
        user_address=data.user_address,
        statement_type="token_balance",
        threshold=data.min_voting_tokens,
        result="eligible"
    )
    
    return {
        "commitment": commitment,
        "eligibility_proof_hash": disclosure_proof["proof_hash"],
        "proposal_id": data.proposal_id
    }
```

**Frontend Flow:**
```typescript
// frontend/src/components/zkdefi/PrivateVoting.tsx
const handleSubmitVote = async (voteChoice: "YES" | "NO" | "ABSTAIN") => {
  // 1. Generate vote commitment
  const response = await fetch(`${API_BASE}/api/v1/zkdefi/voting/submit_vote`, {
    method: "POST",
    body: JSON.stringify({
      user_address: address,
      proposal_id: proposalId,
      vote_choice: voteChoice,
      min_voting_tokens: 1000  // Protocol requirement
    })
  });
  
  const { commitment, eligibility_proof_hash } = await response.json();
  
  // 2. Submit vote commitment (vote hidden)
  await account.execute({
    contractAddress: VOTING_CONTRACT,
    entrypoint: "submit_vote",
    calldata: [proposalId, commitment, eligibility_proof_hash]
  });
  
  // 3. Store reveal data locally
  localStorage.setItem(`vote_${proposalId}`, JSON.stringify({
    vote_choice: voteChoice,
    nonce: nonce,
    commitment: commitment
  }));
};
```

#### Phase 2: Tally Phase

```typescript
const handleRevealVote = async () => {
  const voteData = JSON.parse(localStorage.getItem(`vote_${proposalId}`));
  
  // Generate proof: revealed vote matches commitment
  const response = await fetch(`${API_BASE}/api/v1/zkdefi/voting/reveal_vote`, {
    method: "POST",
    body: JSON.stringify({
      user_address: address,
      proposal_id: proposalId,
      vote_choice: voteData.vote_choice,
      nonce: voteData.nonce,
      commitment: voteData.commitment
    })
  });
  
  const { proof_hash } = await response.json();
  
  // Reveal vote on-chain
  await account.execute({
    contractAddress: VOTING_CONTRACT,
    entrypoint: "reveal_vote",
    calldata: [proposalId, voteData.vote_choice, voteData.nonce, proof_hash]
  });
};
```

### Integration with Existing System

- **Uses selective disclosure:** "I'm eligible to vote" without revealing positions
- **Uses proof-gating:** Agent can only vote if it has valid proof
- **Uses session keys:** Agent votes autonomously within constraints
- **Uses confidential transfers:** Holdings stay private

### Practical Example

```
Scenario: Ekubo Protocol Governance Vote

Day 1: Proposal announced
  - "Proposal #42: Increase trading fee to 0.5%"
  - Requires: Hold >= 1000 EKUBO tokens to vote
  
Day 2: User sets constraint
  - "Agent can vote on proposals if holding >1000 tokens"
  - Agent checks holdings (confidential) → Generates eligibility proof
  - Proof: "I hold >= 1000 tokens" (without revealing exact amount)
  
Day 3: Vote submission
  - Agent votes "YES" → Commitment stored, vote hidden
  - Other voters see: "Commitment 0xdef..." (no vote visible)
  
Day 10: Voting closes, reveal phase
  - Agent reveals vote: "YES"
  - Proof verifies: revealed vote matches commitment
  - Votes counted: YES wins
  
Day 11: Results published
  - Proof shows: Agent was eligible, voted within constraints
  - Individual holdings never revealed
  - Individual votes can stay private (only aggregate visible)
```

### Privacy Benefits

- **Vote privacy:** Can't be influenced by seeing others' votes
- **Eligibility proof:** Without revealing holdings
- **No vote buying:** Can't see who voted what
- **Compliance:** "I participated in governance" without exposing strategy

---

## 3. DEEPEN EXISTING FEATURES (Recommended)

### A. Private Withdrawals (Complete the Confidential Transfer Flow)

**Use-Case: Withdrawing from Private Positions**

**Current State:**
- [Done] Private deposits work (amounts hidden)
- [Missing] Private withdrawals missing (can't get funds out privately)

#### Implementation

**Contract (Already Exists):**
```cairo
// contracts/src/confidential_transfer.cairo
fn private_withdraw(
    ref self: ContractState,
    nullifier: felt252,
    commitment: felt252,
    amount_public: u256,
    proof_calldata: Span<felt252>,
    recipient: ContractAddress
) {
    // 1. Check nullifier not used (prevents double-spend)
    assert(!self.nullifiers.read(nullifier), 'Nullifier already used');
    
    // 2. Verify proof (ownership + balance sufficient)
    let verifier = IGaragaVerifierDispatcher { contract_address: self.garaga_verifier.read() };
    let valid = verifier.verify_groth16_proof_bn254(proof_calldata);
    assert(valid, 'Invalid proof');
    
    // 3. Mark nullifier as used
    self.nullifiers.write(nullifier, true);
    
    // 4. Update commitment balance
    let current = self.commitment_balance.read(commitment);
    assert(current >= amount_public, 'Insufficient commitment balance');
    self.commitment_balance.write(commitment, current - amount_public);
    
    // 5. Transfer tokens
    let token = IERC20Dispatcher { contract_address: self.token.read() };
    let ok = token.transfer(recipient, amount_public);
    assert(ok, 'Transfer to recipient failed');
}
```

**Backend API (New):**
```python
# backend/app/api/zkdefi_agent.py
@router.post("/private_withdraw")
async def private_withdraw(data: PrivateWithdrawRequest):
    """
    Generate private withdrawal proof: nullifier + proof calldata.
    """
    # 1. Generate nullifier: hash(commitment, nonce, user_address)
    nullifier = hash_nullifier(data.commitment, data.nonce, data.user_address)
    
    # 2. Generate proof: "I own commitment, balance >= withdraw_amount"
    # Uses PrivateWithdraw.circom circuit
    proof_result = await svc.generate_private_withdraw_proof(
        commitment=data.commitment,
        withdraw_amount=data.amount,
        nullifier=nullifier
    )
    
    return {
        "nullifier": nullifier,
        "amount_public": data.amount,
        "proof_calldata": proof_result["proof_calldata"]
    }
```

**Frontend UI (New):**
```typescript
// frontend/src/components/zkdefi/PrivateTransferPanel.tsx
const handlePrivateWithdraw = async () => {
  // 1. User selects commitment to withdraw from
  const commitment = selectedCommitment;
  const withdrawAmount = parseFloat(amountInput.value);
  
  // 2. Generate withdrawal proof
  const response = await fetch(`${API_BASE}/api/v1/zkdefi/private_withdraw`, {
    method: "POST",
    body: JSON.stringify({
      user_address: address,
      commitment: commitment,
      amount: withdrawAmount * 1e18,
      nonce: generateNonce()
    })
  });
  
  const { nullifier, amount_public, proof_calldata } = await response.json();
  
  // 3. Execute withdrawal (amount hidden)
  await account.execute({
    contractAddress: CONFIDENTIAL_TRANSFER_ADDRESS,
    entrypoint: "private_withdraw",
    calldata: [
      nullifier,
      commitment,
      amount_public.low,
      amount_public.high,
      proof_calldata.length,
      ...proof_calldata,
      recipientAddress
    ]
  });
  
  toastSuccess("Private withdrawal successful!");
};
```

#### Practical Example

```
User Flow:
1. User deposited 1000 USDC privately (commitment 0xabc...)
2. User wants to withdraw 300 USDC
3. Agent generates proof: "Commitment 0xabc has >= 300 USDC"
4. Nullifier 0xdef... prevents double-spend
5. Withdrawal executes: 300 USDC sent, commitment updated
6. On-chain: Only sees "commitment 0xabc → nullifier 0xdef"
7. Amount 300 USDC hidden from public ledger
```

### B. Enhanced Selective Disclosure (More Statement Types)

**Use-Case: Multi-Dimensional Compliance Proofs**

**Current State:**
- [Done] Basic selective disclosure (yield above X, eligibility)
- [Gap] Limited statement types

#### New Statement Types

**1. Risk Compliance:**
```python
# backend/app/services/zkdefi_agent_service.py
async def generate_risk_compliance_proof(
    self,
    user_address: str,
    max_risk_threshold: int,  # e.g., 20% portfolio risk
    risk_metric: str = "var"  # VaR, Sharpe, etc.
) -> dict[str, Any]:
    """
    Prove portfolio risk is below threshold without revealing positions.
    """
    proof_result = await self._call_prover_api("disclosure", {
        "user_address": user_address,
        "statement_type": f"risk_{risk_metric}",
        "threshold": max_risk_threshold,
        "result": "compliant"
    })
    return {
        "proof_hash": proof_result["proof_hash"],
        "statement_type": f"risk_{risk_metric}",
        "threshold": max_risk_threshold,
        "result": "compliant"
    }
```

**2. Performance Proofs:**
```python
async def generate_performance_proof(
    self,
    user_address: str,
    min_apy: int,  # e.g., 10% = 1000 bps
    period_days: int = 30
) -> dict[str, Any]:
    """
    Prove APY was above threshold for period without revealing positions.
    """
    proof_result = await self._call_prover_api("disclosure", {
        "user_address": user_address,
        "statement_type": "apy",
        "threshold": min_apy,
        "period_days": period_days,
        "result": "above_threshold"
    })
    return {
        "proof_hash": proof_result["proof_hash"],
        "statement_type": "apy",
        "threshold": min_apy,
        "period_days": period_days
    }
```

**3. Regulatory Compliance:**
```python
async def generate_kyc_eligibility_proof(
    self,
    user_address: str,
    min_balance: int  # e.g., $100k = 100000 * 1e18
) -> dict[str, Any]:
    """
    Prove KYC eligibility (balance > threshold) without revealing amount.
    """
    proof_result = await self._call_prover_api("disclosure", {
        "user_address": user_address,
        "statement_type": "kyc_eligible",
        "threshold": min_balance,
        "result": "eligible"
    })
    return {
        "proof_hash": proof_result["proof_hash"],
        "statement_type": "kyc_eligible",
        "threshold": min_balance
    }
```

#### Practical Example

```
Scenario: Exclusive DeFi Protocol Access

Protocol Requirements:
  - Total DeFi holdings > $100k
  - Portfolio risk < 20%
  - 30-day APY > 10%

User Flow:
1. User wants to join exclusive protocol
2. Agent generates multi-statement proof:
   - Statement 1: "Total DeFi holdings > $100k" (selective disclosure)
   - Statement 2: "Portfolio risk < 20%" (risk proof)
   - Statement 3: "30-day APY > 10%" (performance proof)
3. All proven without revealing:
   - Exact holdings
   - Individual positions
   - Trading history
   - Strategy
4. Protocol verifies proof → User gains access
5. User's privacy maintained throughout
```

### C. Private Position Aggregation (Multi-Protocol Privacy)

**Use-Case: Total Portfolio Value Without Revealing Breakdown**

#### How It Works

```python
# backend/app/services/zkdefi_agent_service.py
async def generate_portfolio_aggregation_proof(
    self,
    user_address: str,
    min_total_value: int,
    protocol_ids: list[int]  # [0=Ekubo, 1=JediSwap, 2=PrivateTransfer]
) -> dict[str, Any]:
    """
    Prove total portfolio value across protocols without revealing breakdown.
    """
    # 1. Get commitments for each protocol (from confidential positions)
    commitments = []
    for protocol_id in protocol_ids:
        commitment = await self._get_commitment_for_protocol(
            user_address, protocol_id
        )
        commitments.append(commitment)
    
    # 2. Generate proof: sum(commitments) >= min_total_value
    proof_result = await self._call_prover_api("disclosure", {
        "user_address": user_address,
        "statement_type": "portfolio_aggregation",
        "commitments": commitments,
        "threshold": min_total_value,
        "result": "above_threshold"
    })
    
    return {
        "proof_hash": proof_result["proof_hash"],
        "statement_type": "portfolio_aggregation",
        "threshold": min_total_value,
        "protocol_count": len(protocol_ids)
    }
```

#### Practical Example

```
User Portfolio:
  - 5000 USDC in Ekubo (private commitment 0x111...)
  - 3000 USDC in JediSwap (private commitment 0x222...)
  - 2000 USDC in private transfer (private commitment 0x333...)
  Total: 10,000 USDC

User wants to prove: "I have >$5k in DeFi" for protocol access

Agent generates proof:
  - Sum of commitments = total value
  - Total value > $5k
  - Without revealing:
    - Ekubo amount (5000)
    - JediSwap amount (3000)
    - Private transfer amount (2000)
    - Breakdown or allocation

Protocol verifies → Access granted
Individual positions stay private
```

---

## RECOMMENDATION RANKING

### 1. Private Withdrawals (Highest Priority)
- **Completes the confidential transfer flow**
- **Essential for practical use**
- **Uses existing infrastructure**
- **Effort:** Medium (backend API + frontend UI + circuit)
- **Impact:** High (makes private deposits actually usable)

### 2. Enhanced Selective Disclosure
- **Expands compliance use-cases**
- **Fits existing infrastructure**
- **Effort:** Medium (new proof types, backend logic)
- **Impact:** High (enables more real-world scenarios)

### 3. Sealed-Bid Auction
- **Novel use-case**
- **Good demo value**
- **Effort:** High (new contract, new UI, new flow)
- **Impact:** Medium (specific use-case)

### 4. Private Voting
- **Governance use-case**
- **Good for DeFi integration**
- **Effort:** High (new contract, new UI, new flow)
- **Impact:** Medium (governance is niche)

### 5. Private Position Aggregation
- **Advanced feature**
- **Requires multi-commitment proofs**
- **Effort:** High (complex proofs)
- **Impact:** Medium (advanced use-case)

---

## PRACTICAL IMPLEMENTATION PATH

### Phase 1: Complete Core (Week 1)
- [Done] Private withdrawals (backend + frontend + circuit)
- [Done] Enhanced selective disclosure (2-3 new statement types)

### Phase 2: Expand Use-Cases (Week 2)
- Sealed-bid auction (if time permits)
- Private voting (if time permits)

### Phase 3: Advanced Features (Future)
- Private position aggregation
- Multi-protocol privacy proofs

---

## Integration Points

All recommendations integrate with existing infrastructure:

1. **Proof-Gating:** Uses Integrity fact registry (same as deposits)
2. **Confidential Transfers:** Uses Garaga/Groth16 (same as private deposits)
3. **Selective Disclosure:** Uses existing disclosure contract
4. **Session Keys:** Agent can act autonomously within constraints
5. **Backend API:** Extends existing `/api/v1/zkdefi/` endpoints
6. **Frontend UI:** New components in existing design system

This ensures consistency and reuses proven infrastructure.
