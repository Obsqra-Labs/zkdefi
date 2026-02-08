# Private Transfer Circuits (Garaga Groth16)

Circuits for confidential deposit/withdraw: prove commitment and amount validity without revealing full balance.

## Layout

- `PrivateDeposit.circom` – Deposit: commitment = hash(amount, nonce), balance >= amount.
- `PrivateWithdraw.circom` – Withdraw: nullifier check, commitment ownership, amount.
- `FullPrivacyWithdraw.circom` – Full privacy pool withdraw: Merkle inclusion with `leaf` (felt252-safe commitment), nullifier, amount.

## Prerequisites

- Node.js 18+ (for snarkjs)
- Circom 2.x: https://docs.circom.io/
- Garaga CLI: `pip install garaga==1.0.1`
- snarkjs: `npm install -g snarkjs` or use local npx

## Build PrivateDeposit and PrivateWithdraw (one script)

From `circuits/` run:

```bash
./build_private_circuits.sh
```

This compiles both circuits, runs Groth16 setup with `pot14_final.ptau`, and exports `build/verification_key.json` (PrivateDeposit) and `build/PrivateWithdraw_verification_key.json`. The backend expects these paths; see `backend/app/services/groth16_prover.py`.

## Build (manual Circom + snarkjs)

```bash
# Compile circuit
circom PrivateDeposit.circom --r1cs --wasm --sym -o build

# Powers of tau (reuse or download)
# snarkjs powersoftau new bn128 12 pot12_0000.ptau -v
# snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="First" -v
# snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v

# Groth16 setup
snarkjs groth16 setup build/PrivateDeposit.r1cs pot12_final.ptau build/PrivateDeposit_0000.zkey
snarkjs zkey contribute build/PrivateDeposit_0000.zkey build/PrivateDeposit_final.zkey --name="Contrib" -v
snarkjs zkey export verificationkey build/PrivateDeposit_final.zkey build/verification_key.json

# Prove (example)
node build/PrivateDeposit_js/generate_witness.js build/PrivateDeposit_js/PrivateDeposit.wasm input.json build/witness.wtns
snarkjs groth16 prove build/PrivateDeposit_final.zkey build/witness.wtns build/proof.json build/public.json

# Export solidity calldata (for reference; Garaga uses its own format)
snarkjs zkey export soliditycalldata build/public.json build/proof.json
```

## Garaga: Generate Cairo verifier and deploy to Sepolia

1. **Verification key**  
   Use the same `verification_key.json` (or Garaga’s expected vk format; see Garaga Groth16 docs).

2. **Generate Cairo verifier**  
   ```bash
   garaga gen --system groth16_bn254 --vk build/verification_key.json -o contracts/verifier
   ```  
   (Exact `--system` and output path per Garaga docs.)

3. **Deploy to Starknet Sepolia**  
   ```bash
   sncast --url https://starknet-sepolia.public.blastapi.io --network alpha-sepolia deploy --contract contracts/verifier/Verifier.sierra.json
   ```  
   Set `GARAGA_VERIFIER_ADDRESS` in `.env`.

4. **Build deployed verifier** Run `./redeploy_garaga_verifier.sh` from `circuits/` to regenerate Cairo verifier from `build/verification_key.json`. If Docker scarb build fails, copy `contracts/src/garaga_verifier_new/src/*.cairo` to `zkdefi/contracts/src/garaga_verifier/src/` and run `scarb build` from `zkdefi/contracts/`.

5. **Calldata for verification**  
   ```bash
   garaga verify-onchain --system groth16 --contract-address <GARAGA_VERIFIER_ADDRESS> --vk build/verification_key.json --proof build/proof.json
   ```  
   Use the emitted calldata when calling the verifier (or `ConfidentialTransfer.private_deposit`).

## Public inputs (contract ABI)

- **Deposit:** `commitment` (felt), `amount_public` (u256). Contract pulls `amount_public` from user and credits `commitment_balance[commitment]`.
- **Withdraw:** `nullifier`, `commitment`, `amount_public`, `recipient`. Contract checks nullifier unspent, debits commitment, transfers to recipient.

## Garaga formatter (backend proof calldata)

The backend uses `garaga_formatter.format_proof_for_garaga()` to turn snarkjs proof + public signals into Starknet calldata. It runs **Docker** with image `zkdefi-garaga:latest` (no network, read-only, ephemeral). If private_deposit/private_withdraw fail with "Garaga formatting failed", ensure:

1. **Docker image**  
   Build and tag the Garaga CLI image as `zkdefi-garaga:latest`. The image must accept: `calldata --system groth16 --vk /circuits/<vk.json> --proof /work/proof.json --public-inputs /work/public.json --format starkli` and print a line "length val1 val2 ...". Example Dockerfile (from Garaga docs): install Python 3.10 + garaga (e.g. `pip install garaga==1.0.1`), set entrypoint to `garaga`.

2. **Verification keys**  
   The vk files passed to the formatter must be the same as those exported by `build_private_circuits.sh`: `build/verification_key.json` (PrivateDeposit) and `build/PrivateWithdraw_verification_key.json` (PrivateWithdraw).

**Alternative:** If you run Garaga CLI locally (e.g. `garaga calldata ...`), you can avoid Docker by changing `garaga_formatter.py` to call the local binary when an env var is set; the default remains Docker for security (no network, read-only).

## Version compatibility

Use the same Garaga SDK version for generating the verifier and for `verify-onchain`; otherwise calldata may be incompatible.

## FullPrivacyWithdraw (full privacy pool)

This circuit uses a Merkle check with input `leaf` (felt252-safe commitment). The backend expects `build/FullPrivacyWithdraw_final.zkey`. If you change the circuit (e.g. add/remove signals), regenerate the zkey:

- **ptau**: Circuit needs `2^power > numConstraints`; pot12 is too small. Use `pot14_final.ptau` (in `circuits/`) or larger.
- **Setup**: `npx snarkjs groth16 setup build/FullPrivacyWithdraw.r1cs pot14_final.ptau build/FullPrivacyWithdraw_0000.zkey`
- **Contribute** (non-interactive): `npx snarkjs zkey contribute build/FullPrivacyWithdraw_0000.zkey build/FullPrivacyWithdraw_final.zkey --name="Contrib" -e="random-entropy" -v`
tive): `npx snarkjs zkey contribute build/FullPrivacyWithdraw_0000.zkey build/FullPrivacyWithdraw_final.zkey --name="Contrib" -e="random-entropy" -v`
