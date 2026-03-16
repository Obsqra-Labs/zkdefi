#!/bin/bash
set -e

WALLET="0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"
TOKEN="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
CONFIDENTIAL="0x04b1265fa18e6873899a4f3ff15cfa0348b7bdf3ccb66bc658d0045ac61dfc0c"

echo "=== Checking Token Balance & Approval ==="
echo ""
echo "Wallet: $WALLET"
echo "Token (STRK): $TOKEN"
echo "ConfidentialTransfer: $CONFIDENTIAL"
echo ""

# Check balance
echo "1. Checking your STRK balance..."
sncast \
  --network sepolia \
  call \
  --contract-address "$TOKEN" \
  --function balance_of \
  --calldata "$WALLET" || echo "Failed to check balance"

echo ""
echo "2. Checking allowance..."
sncast \
  --network sepolia \
  call \
  --contract-address "$TOKEN" \
  --function allowance \
  --calldata "$WALLET" "$CONFIDENTIAL" || echo "Failed to check allowance"

echo ""
echo "3. To approve (if needed):"
echo "   Visit: https://sepolia.voyager.online/contract/$TOKEN"
echo "   Or run:"
echo ""
echo "   sncast --account deployer --network sepolia \\"
echo "     invoke \\"
echo "     --contract-address $TOKEN \\"
echo "     --function approve \\"
echo "     --calldata $CONFIDENTIAL 0xffffffffffffffffffffffffffffffff 0xffffffffffffffffffffffffffffffff"

