#!/usr/bin/env python3
"""Debug proof generation to find the issue"""
import json

# Read a successful proof from the test
with open('circuits/build/test_public.json') as f:
    public_signals = json.load(f)

print("=== Test Proof Public Signals ===")
print(f"Public signal 0 (commitment): {public_signals[0]}")
print(f"Public signal 1 (amount): {public_signals[1]}")

# Calculate what we expect
amount = 1000000000000000000
nonce = 123
expected_commitment = amount * 0x10000 + nonce

print(f"\n=== Expected Values ===")
print(f"Amount: {amount}")
print(f"Nonce: {nonce}")
print(f"Expected commitment: {expected_commitment}")
print(f"Match: {int(public_signals[0]) == expected_commitment}")

# Now check what the backend generates
print("\n=== Backend API Request Simulation ===")
print("When frontend requests proof for amount=1000000000000000000:")
print("  - Backend generates random nonce")
print("  - Circuits expects: amount, balance, nonce")
print("  - Backend provides: ???")

# Check backend code
with open('backend/app/services/groth16_prover.py') as f:
    code = f.read()
    if 'def private_deposit' in code:
        start = code.find('def private_deposit')
        snippet = code[start:start+2000]
        print("\n=== Backend Code Snippet ===")
        # Find input_data creation
        if 'input_data = {' in snippet:
            idx = snippet.find('input_data = {')
            print(snippet[idx:idx+300])
