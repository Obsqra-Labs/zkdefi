# For developers

## Quick Links

- **[Smart Contracts](/contracts)** - Deployed addresses and contract details
- **[Setup Guide](https://github.com/obsqra-labs/zkdefi/blob/main/docs/SETUP.md)** - Deployment, env vars, running services
- **[Architecture](https://github.com/obsqra-labs/zkdefi/blob/main/docs/ARCHITECTURE.md)** - System components and data flow
- **[Environment Variables](https://github.com/obsqra-labs/zkdefi/blob/main/docs/ENV.md)** - Backend and frontend configuration
- **[GitHub Repository](https://github.com/obsqra-labs/zkdefi)** - Full source code

## Contract Addresses

All zkde.fi contracts are deployed on **Starknet Sepolia**. See the [Contracts](/contracts) page for all deployed addresses and contract details.

### Quick Reference

- **ProofGatedYieldAgent:** `0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3`
- **SelectiveDisclosure:** `0x00ab6791e84e2d88bf2200c9e1c2fb1caed2eecf5f9ae2989acf1ed3d00a0c77`
- **Garaga Verifier:** `0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37`
- **ConfidentialTransfer:** `0x07fdc7c21ab074e7e1afe57edfcb818be183ab49f4bf31f9bf86dd052afefaa4`

## API Reference

### Backend API

The zkde.fi backend API is available at `https://zkde.fi/api/v1/zkdefi`.

**Health Check:**
```bash
curl https://zkde.fi/health
```

**Get Contract Addresses:**
```bash
curl https://zkde.fi/api/v1/zkdefi/contracts
```

Full API documentation coming soon.

## Local Development

### Prerequisites

- Node.js 18+
- Python 3.10+
- Scarb (Cairo compiler)
- Starknet wallet with Sepolia testnet funds

### Quick Start

1. Clone the repository:
```bash
git clone https://github.com/obsqra-labs/zkdefi.git
cd zkdefi
```

2. Install dependencies:
```bash
# Frontend
cd frontend && npm install

# Backend
cd ../backend && python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Contracts
cd ../contracts && scarb build
```

3. Configure environment variables (see [ENV.md](https://github.com/obsqra-labs/zkdefi/blob/main/docs/ENV.md))

4. Start services:
```bash
# Use the convenience script
./start_zkdefi_services.sh

# Or manually:
# Backend: cd backend && uvicorn app.main:app --reload --port 8003
# Frontend: cd frontend && npm run dev
```

Visit `http://localhost:3000` to see the app.

## Contributing

We welcome contributions! Please see our [GitHub repository](https://github.com/obsqra-labs/zkdefi) for contribution guidelines.

## Support

- **GitHub Issues:** [Report bugs or request features](https://github.com/obsqra-labs/zkdefi/issues)
- **Twitter:** [@obsqralabs](https://twitter.com/obsqralabs)

---

[Back to Introduction](/intro)
