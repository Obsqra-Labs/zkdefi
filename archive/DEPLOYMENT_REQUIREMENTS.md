# Deployment Requirements

## Required Addresses for Contract Deployment

Before deploying contracts, you need:

1. **INTEGRITY_FACT_REGISTRY_ADDRESS** - Integrity fact registry on Starknet Sepolia
   - This is where Obsqra prover submits proofs
   - Check Herodotus documentation or Obsqra Labs for the Sepolia address

2. **ERC20_TOKEN_ADDRESS** - ERC20 token contract on Sepolia
   - Can deploy a simple ERC20 or use existing test token
   - Deployer address: 0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d

3. **ADMIN_ADDRESS** - Admin address for contracts
   - Can use deployer address: 0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d

## Current Status

- Contracts built successfully
- Circuit compiled successfully  
- Powers of tau generation in progress
- Garaga installation blocked (needs Python 3.10-3.11, system has 3.12)

## Next Steps

1. Get Integrity fact registry address
2. Deploy or find ERC20 token address
3. Complete powers of tau setup
4. Install Garaga (may need Python 3.11 virtual environment)
5. Generate Cairo verifier
6. Deploy contracts
