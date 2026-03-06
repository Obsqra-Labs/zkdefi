#!/bin/bash
set -e

NETWORK="${STARKNET_NETWORK:-http://127.0.0.1:6060}"
KEYSTORE="/root/.starkli/keystore.json"
ACCOUNT="/root/.starkli/accounts/deployer_starkli.json"
FACT_REGISTRY="0x02009ab87f581a0a92f65906ce84664a5cfcb86f7266651f48a04fac3c62faa3"

echo "=== Deploying Reputation Verifiers to $NETWORK ==="
echo "FactRegistry: $FACT_REGISTRY"
echo ""

# Function to extract address from starkli output
extract_address() {
    grep -oP '0x[0-9a-fA-F]+' | tail -1
}

# 1. SolvencyProofVerifier
echo "[1/5] Declaring SolvencyProofVerifier..."
SOLVENCY_CLASS=$(starkli declare \
  contracts/target/dev/zkdefi_contracts_zkdefi_contracts_verifiers_SolvencyProofVerifier_Groth16VerifierBN254.contract_class.json \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | extract_address)

echo "  Class hash: $SOLVENCY_CLASS"
echo "  Deploying SolvencyProofVerifier..."
SOLVENCY_VERIFIER=$(starkli deploy \
  "$SOLVENCY_CLASS" \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | extract_address)
echo "  ✓ Deployed at: $SOLVENCY_VERIFIER"
echo ""

# 2. RiskPassportTierVerifier
echo "[2/5] Declaring RiskPassportTierVerifier..."
RISK_PASSPORT_CLASS=$(starkli declare \
  contracts/target/dev/zkdefi_contracts_zkdefi_contracts_verifiers_RiskPassportTierVerifier_Groth16VerifierBN254.contract_class.json \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | extract_address)

echo "  Class hash: $RISK_PASSPORT_CLASS"
echo "  Deploying RiskPassportTierVerifier..."
RISK_PASSPORT_VERIFIER=$(starkli deploy \
  "$RISK_PASSPORT_CLASS" \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | extract_address)
echo "  ✓ Deployed at: $RISK_PASSPORT_VERIFIER"
echo ""

# 3. TraderPerformanceVerifier
echo "[3/5] Declaring TraderPerformanceVerifier..."
TRADER_PERFORMANCE_CLASS=$(starkli declare \
  contracts/target/dev/zkdefi_contracts_zkdefi_contracts_verifiers_TraderPerformanceVerifier_Groth16VerifierBN254.contract_class.json \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | extract_address)

echo "  Class hash: $TRADER_PERFORMANCE_CLASS"
echo "  Deploying TraderPerformanceVerifier..."
TRADER_PERFORMANCE_VERIFIER=$(starkli deploy \
  "$TRADER_PERFORMANCE_CLASS" \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | extract_address)
echo "  ✓ Deployed at: $TRADER_PERFORMANCE_VERIFIER"
echo ""

# 4. StrategyIntegrityVerifier
echo "[4/5] Declaring StrategyIntegrityVerifier..."
STRATEGY_INTEGRITY_CLASS=$(starkli declare \
  contracts/target/dev/zkdefi_contracts_zkdefi_contracts_verifiers_StrategyIntegrityVerifier_Groth16VerifierBN254.contract_class.json \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | extract_address)

echo "  Class hash: $STRATEGY_INTEGRITY_CLASS"
echo "  Deploying StrategyIntegrityVerifier..."
STRATEGY_INTEGRITY_VERIFIER=$(starkli deploy \
  "$STRATEGY_INTEGRITY_CLASS" \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | extract_address)
echo "  ✓ Deployed at: $STRATEGY_INTEGRITY_VERIFIER"
echo ""

# 5. ExecutionIntegrityVerifier
echo "[5/5] Declaring ExecutionIntegrityVerifier..."
EXECUTION_INTEGRITY_CLASS=$(starkli declare \
  contracts/target/dev/zkdefi_contracts_zkdefi_contracts_verifiers_ExecutionIntegrityVerifier_Groth16VerifierBN254.contract_class.json \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | extract_address)

echo "  Class hash: $EXECUTION_INTEGRITY_CLASS"
echo "  Deploying ExecutionIntegrityVerifier..."
EXECUTION_INTEGRITY_VERIFIER=$(starkli deploy \
  "$EXECUTION_INTEGRITY_CLASS" \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT" \
  2>&1 | extract_address)
echo "  ✓ Deployed at: $EXECUTION_INTEGRITY_VERIFIER"
echo ""

# Save deployment addresses
echo "=== Saving deployment addresses to .env.verifiers ==="
cat > .env.verifiers <<EOF
# Reputation Verifier Contracts
# Deployed: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# Network: $NETWORK
# FactRegistry: $FACT_REGISTRY

SOLVENCY_VERIFIER=$SOLVENCY_VERIFIER
SOLVENCY_VERIFIER_CLASS=$SOLVENCY_CLASS

RISK_PASSPORT_VERIFIER=$RISK_PASSPORT_VERIFIER
RISK_PASSPORT_VERIFIER_CLASS=$RISK_PASSPORT_CLASS

TRADER_PERFORMANCE_VERIFIER=$TRADER_PERFORMANCE_VERIFIER
TRADER_PERFORMANCE_VERIFIER_CLASS=$TRADER_PERFORMANCE_CLASS

STRATEGY_INTEGRITY_VERIFIER=$STRATEGY_INTEGRITY_VERIFIER
STRATEGY_INTEGRITY_VERIFIER_CLASS=$STRATEGY_INTEGRITY_CLASS

EXECUTION_INTEGRITY_VERIFIER=$EXECUTION_INTEGRITY_VERIFIER
EXECUTION_INTEGRITY_VERIFIER_CLASS=$EXECUTION_INTEGRITY_CLASS
EOF

echo "✓ Addresses saved to .env.verifiers"
echo ""

# Register verifiers with FactRegistry
echo "=== Registering verifiers with FactRegistry ==="
echo "This step requires admin access to FactRegistry"
echo ""

echo "Registering SolvencyProofVerifier..."
starkli invoke $FACT_REGISTRY set_solvency_verifier $SOLVENCY_VERIFIER \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT"
echo "✓ SolvencyProofVerifier registered"

echo "Registering RiskPassportTierVerifier..."
starkli invoke $FACT_REGISTRY set_risk_passport_verifier $RISK_PASSPORT_VERIFIER \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT"
echo "✓ RiskPassportTierVerifier registered"

echo "Registering TraderPerformanceVerifier..."
starkli invoke $FACT_REGISTRY set_trader_performance_verifier $TRADER_PERFORMANCE_VERIFIER \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT"
echo "✓ TraderPerformanceVerifier registered"

echo "Registering StrategyIntegrityVerifier..."
starkli invoke $FACT_REGISTRY set_strategy_integrity_verifier $STRATEGY_INTEGRITY_VERIFIER \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT"
echo "✓ StrategyIntegrityVerifier registered"

echo "Registering ExecutionIntegrityVerifier..."
starkli invoke $FACT_REGISTRY set_execution_integrity_verifier $EXECUTION_INTEGRITY_VERIFIER \
  --rpc "$NETWORK" \
  --keystore "$KEYSTORE" \
  --account "$ACCOUNT"
echo "✓ ExecutionIntegrityVerifier registered"

echo ""
echo "=== All verifiers deployed and registered successfully! ==="
echo ""
echo "Summary:"
echo "  SolvencyProofVerifier:        $SOLVENCY_VERIFIER"
echo "  RiskPassportTierVerifier:     $RISK_PASSPORT_VERIFIER"
echo "  TraderPerformanceVerifier:    $TRADER_PERFORMANCE_VERIFIER"
echo "  StrategyIntegrityVerifier:    $STRATEGY_INTEGRITY_VERIFIER"
echo "  ExecutionIntegrityVerifier:   $EXECUTION_INTEGRITY_VERIFIER"
echo ""
echo "Configuration saved to: .env.verifiers"
echo "FactRegistry:                   $FACT_REGISTRY"
