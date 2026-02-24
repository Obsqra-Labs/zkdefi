# For developers

Documentation lives at **zkde.fi/docs** (this site when viewing on zkde.fi).

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

## Self-hosting / contributors

For contributors: clone the repo, install dependencies (frontend, backend, contracts), set env (see [ENV.md](https://github.com/obsqra-labs/zkdefi/blob/main/docs/ENV.md)). Run backend on :8003 and frontend on :3001. SDK and CLI for integration are on the roadmap; most users use the live app at zkde.fi.

Visit `http://localhost:3001` to see the app when running locally.

## Contributing

We welcome contributions! Please see our [GitHub repository](https://github.com/obsqra-labs/zkdefi) for contribution guidelines.

## Support

- **GitHub Issues:** [Report bugs or request features](https://github.com/obsqra-labs/zkdefi/issues)
- **Twitter:** [@obsqralabs](https://twitter.com/obsqralabs)

---

[Back to Introduction](/intro)
