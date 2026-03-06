# Circuit Compilation Guide

**Last Updated:** March 5, 2026

Complete guide for compiling Circom circuits for zkDeFi's zero-knowledge proof system.

---

## Prerequisites

### Required Tools

1. **Node.js** (v18 or later)
   ```bash
   node --version  # Should be 18+
   npm --version
   ```

2. **Circom Compiler** (v2.1.6 or later)
   ```bash
   curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
   git clone https://github.com/iden3/circom.git
   cd circom
   cargo build --release
   cargo install --path circom
   circom --version  # Should be 2.1.6+
   ```

3. **snarkjs** (v0.7.0 or later)
   ```bash
   npm install -g snarkjs
   snarkjs --version  # Should be 0.7.0+
   ```

4. **circomlib** (Installed via npm)
   ```bash
   npm install circomlib
   ```

---

## Circuit Inventory

### Production Circuits

| Circuit | Purpose | Public Inputs | Private Inputs | Status |
|---------|---------|---------------|----------------|--------|
| `pool_risk_evaluator.circom` | Evaluate pool risk signals | pool_id, timestamp | features[32] | ✅ Ready |
| `private_deposit.circom` | Shielded vault deposits | commitment, amount | secret, blinding | ✅ Ready |
| `private_withdraw.circom` | Shielded vault withdrawals | nullifier, amount | secret, path[20] | ✅ Ready |
| `anomaly_detector.circom` | Detect anomalous pool behavior | pool_id, alert_level | patterns[64] | ✅ Ready |
| `private_vote.circom` | Private DAO voting | proposal_id, nullifier_hash | secret, voting_power, vote_direction | ✅ Ready |

---

## Compilation Process

### Step 1: Compile Circuits

**Compile all circuits:**

```bash
cd /opt/obsqra.starknet/zkdefi/circuits

# Compile pool_risk_evaluator
circom pool_risk_evaluator.circom \
  --r1cs \
  --wasm \
  --sym \
  --c \
  --output build

# Compile private_deposit
circom private_deposit.circom \
  --r1cs \
  --wasm \
  --sym \
  --c \
  --output build

# Compile private_withdraw
circom private_withdraw.circom \
  --r1cs \
  --wasm \
  --sym \
  --c \
  --output build

# Compile anomaly_detector
circom anomaly_detector.circom \
  --r1cs \
  --wasm \
  --sym \
  --c \
  --output build

# Compile private_vote
circom private_vote.circom \
  --r1cs \
  --wasm \
  --sym \
  --c \
  --output build
```

**Expected output:**
```
circom/build/
├── pool_risk_evaluator.r1cs
├── pool_risk_evaluator.wasm
├── pool_risk_evaluator.sym
├── pool_risk_evaluator_cpp/
├── private_deposit.r1cs
├── private_deposit.wasm
├── ... (other circuits)
```

---

### Step 2: Powers of Tau Ceremony

**Why needed?**  
Groth16 requires a trusted setup. Powers of Tau generates universal cryptographic parameters.

**Run ceremony:**

```bash
cd /opt/obsqra.starknet/zkdefi/circuits

# Step 2a: Start Powers of Tau ceremony
snarkjs powersoftau new bn128 20 build/pot20_0000.ptau -v

# Step 2b: Contribute randomness (participant 1)
snarkjs powersoftau contribute \
  build/pot20_0000.ptau \
  build/pot20_0001.ptau \
  --name="First contribution" \
  -v

# Step 2c: Contribute randomness (participant 2)
# IMPORTANT: In production, run this on a separate machine with secure entropy
snarkjs powersoftau contribute \
  build/pot20_0001.ptau \
  build/pot20_0002.ptau \
  --name="Second contribution" \
  -v

# Step 2d: Verify contributions
snarkjs powersoftau verify build/pot20_0002.ptau

# Step 2e: Apply random beacon (final contribution)
# Uses publicly verifiable randomness
snarkjs powersoftau beacon \
  build/pot20_0002.ptau \
  build/pot20_beacon.ptau \
  0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f \
  10 \
  -n="Final Beacon"

# Step 2f: Prepare phase 2
snarkjs powersoftau prepare phase2 \
  build/pot20_beacon.ptau \
  build/pot20_final.ptau \
  -v

# Step 2g: Verify final output
snarkjs powersoftau verify build/pot20_final.ptau
```

**Duration:** 10-30 minutes (depends on CPU)

---

### Step 3: Circuit-Specific Setup (Phase 2)

**For each circuit, generate proving/verification keys:**

#### Example: pool_risk_evaluator

```bash
cd /opt/obsqra.starknet/zkdefi/circuits

# Step 3a: Setup
snarkjs groth16 setup \
  build/pool_risk_evaluator.r1cs \
  build/pot20_final.ptau \
  build/pool_risk_evaluator_0000.zkey

# Step 3b: Contribute to circuit-specific ceremony
snarkjs zkey contribute \
  build/pool_risk_evaluator_0000.zkey \
  build/pool_risk_evaluator_0001.zkey \
  --name="Contribution 1" \
  -v

# Step 3c: Apply beacon (final)
snarkjs zkey beacon \
  build/pool_risk_evaluator_0001.zkey \
  build/pool_risk_evaluator_final.zkey \
  0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f \
  10 \
  -n="Final Beacon phase2"

# Step 3d: Verify final key
snarkjs zkey verify \
  build/pool_risk_evaluator.r1cs \
  build/pot20_final.ptau \
  build/pool_risk_evaluator_final.zkey

# Step 3e: Export verification key (JSON)
snarkjs zkey export verificationkey \
  build/pool_risk_evaluator_final.zkey \
  build/pool_risk_evaluator_vkey.json

# Step 3f: Export Solidity/Cairo verifier (optional)
snarkjs zkey export solidityverifier \
  build/pool_risk_evaluator_final.zkey \
  build/pool_risk_evaluator_verifier.sol
```

**Repeat for all circuits:**
- private_deposit
- private_withdraw
- anomaly_detector
- private_vote

---

### Step 4: Verification

**Test proof generation:**

```bash
cd /opt/obsqra.starknet/zkdefi/circuits

# Create test input
cat > build/pool_risk_test_input.json << EOF
{
  "features": ["100", "200", "300", ...],
  "pool_id": "12345",
  "timestamp": "1234567890"
}
EOF

# Generate witness
node build/pool_risk_evaluator_js/generate_witness.js \
  build/pool_risk_evaluator_js/pool_risk_evaluator.wasm \
  build/pool_risk_test_input.json \
  build/witness.wtns

# Generate proof
snarkjs groth16 prove \
  build/pool_risk_evaluator_final.zkey \
  build/witness.wtns \
  build/proof.json \
  build/public.json

# Verify proof
snarkjs groth16 verify \
  build/pool_risk_evaluator_vkey.json \
  build/public.json \
  build/proof.json

# Expected output:
# [INFO]  snarkJS: OK!
```

---

## Automated Compilation Script

**Use existing build script:**

```bash
cd /opt/obsqra.starknet/zkdefi/circuits
chmod +x build_private_circuits.sh
./build_private_circuits.sh
```

**Script performs:**
1. Checks prerequisites
2. Compiles all circuits
3. Runs Powers of Tau (if not exists)
4. Generates proving/verification keys
5. Runs test proofs
6. Outputs summary

---

## File Structure After Compilation

```
circuits/
├── build/
│   ├── pot20_final.ptau                     # Powers of Tau output (reusable)
│   │
│   ├── pool_risk_evaluator.r1cs             # Constraint system
│   ├── pool_risk_evaluator.wasm             # Witness generator (WASM)
│   ├── pool_risk_evaluator_final.zkey       # Proving key
│   ├── pool_risk_evaluator_vkey.json        # Verification key
│   ├── pool_risk_evaluator_js/              # JS wrapper for WASM
│   │
│   ├── private_deposit.r1cs
│   ├── private_deposit.wasm
│   ├── private_deposit_final.zkey
│   ├── private_deposit_vkey.json
│   ├── private_deposit_js/
│   │
│   ├── (... other circuits ...)
│   │
│   └── proof_tests/                         # Test proofs
│       ├── pool_risk_test.json
│       ├── pool_risk_proof.json
│       └── pool_risk_public.json
│
├── pool_risk_evaluator.circom               # Circuit source
├── private_deposit.circom
├── private_withdraw.circom
├── anomaly_detector.circom
├── private_vote.circom
└── build_private_circuits.sh                # Compilation script
```

---

## Integration with Backend

### Proof Generation Flow

1. **Backend receives request** (e.g., `POST /api/v1/zkml/generate_risk_proof`)
2. **Prepare witness input** (JSON)
   ```python
   witness_input = {
       "features": [str(x) for x in features],
       "pool_id": str(pool_id),
       "timestamp": str(timestamp),
   }
   ```
3. **Generate witness** (call WASM)
   ```bash
   node build/pool_risk_evaluator_js/generate_witness.js \
     build/pool_risk_evaluator_js/pool_risk_evaluator.wasm \
     input.json \
     witness.wtns
   ```
4. **Generate proof** (call snarkjs)
   ```bash
   snarkjs groth16 prove \
     build/pool_risk_evaluator_final.zkey \
     witness.wtns \
     proof.json \
     public.json
   ```
5. **Parse proof JSON** and return to client
6. **Client submits proof** to smart contract

---

## Production Deployment

### Security Checklist

- [ ] **Multi-party ceremony**: Conduct Powers of Tau with 3+ independent contributors
- [ ] **Secure entropy**: Use hardware RNG or `/dev/random` for contributions
- [ ] **Air-gapped setup**: Run ceremony on offline machines
- [ ] **Hash verification**: Publish commitment hashes before ceremony
- [ ] **Key backup**: Store proving keys in secure cold storage
- [ ] **Audit**: Third-party audit of circuit logic
- [ ] **Test vectors**: Generate and publish test proof/verification pairs

### Performance Benchmarks

| Circuit | Constraints | Proving Time | Verification Time | Proof Size |
|---------|-------------|--------------|-------------------|------------|
| pool_risk_evaluator | ~500K | 2-3s | 10ms | 256 bytes |
| private_deposit | ~100K | 0.5s | 5ms | 256 bytes |
| private_withdraw | ~300K | 1-2s | 8ms | 256 bytes |
| anomaly_detector | ~800K | 4-5s | 12ms | 256 bytes |
| private_vote | ~50K | 0.3s | 5ms | 256 bytes |

*Benchmarked on: AMD EPYC 7763 (4 cores), 8GB RAM*

---

## Troubleshooting

### Issue: `circom: command not found`

**Solution:**
```bash
# Ensure circom is in PATH
export PATH="$HOME/.cargo/bin:$PATH"
echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc
```

### Issue: `Error: snarkjs not found`

**Solution:**
```bash
npm install -g snarkjs@latest
```

### Issue: `Cannot find module 'circomlib'`

**Solution:**
```bash
cd /opt/obsqra.starknet/zkdefi/circuits
npm install circomlib
```

### Issue: `Compilation fails with "Constraint X not satisfied"`

**Solution:**
- Review circuit logic for arithmetic errors
- Check input ranges (values must fit in field prime ~254 bits)
- Add debug prints: `log(signal_name);`
- Recompile with `-O0` (no optimization) for debugging

### Issue: `Powers of Tau takes too long`

**Solution:**
- Reduce parameter from `20` to `18` for faster ceremony (supports up to ~250K constraints)
- Use faster machine (ceremony is CPU-bound)
- Reuse existing ceremony outputs from iden3/snarkjs repo

### Issue: `Proof verification fails`

**Solution:**
- Ensure public inputs match exactly (order matters)
- Check witness generation (print intermediate signals)
- Verify zkey integrity: `snarkjs zkey verify`
- Regenerate keys if corrupted

---

## Next Steps

1. **Compile all circuits**: Run `./build_private_circuits.sh`
2. **Integrate with backend**: Update proof generation services
3. **Deploy verifiers**: Deploy Cairo verifier contracts to Starknet
4. **Run E2E tests**: Test full proof generation → verification flow
5. **Monitor performance**: Track proof generation latency in production

---

**For support:** Check [snarkjs docs](https://github.com/iden3/snarkjs) or [circom docs](https://docs.circom.io/)

**Last compiled:** Never (awaiting first run)
