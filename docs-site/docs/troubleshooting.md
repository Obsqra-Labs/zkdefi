# Troubleshooting

Common issues and where to get help.

## ChunkLoadError / CSS not loading

After a deploy, the app may serve cached old chunks. Try:

- **Hard refresh:** Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac).
- **Clear site data:** In browser settings, clear data for zkde.fi (cookies, cache).
- If chunks return 404, ensure a full frontend rebuild and deploy so chunk filenames match the current build.

## 404 on /docs

Use **zkde.fi/docs** or **zkde.fi/docs/** (with trailing slash). If you still get 404, the server may not be serving the docs path. On nginx, ensure `location /docs/` is configured with alias to the built docs (see [Deploying zkde.fi](/deploying-zkde-fi)).

## Transaction errors

### u256_sub Overflow

Usually a balance or amount mismatch (e.g. wrong decimals or trying to spend more than available). Check the amounts you enter and your token balance. Ensure you're on Starknet Sepolia and that the token addresses match the network.

### NOT_INITIALIZED

The pool or contract is not initialized on the network you're using. Ensure you're on **Starknet Sepolia** and that the pool/strategy is active. If you deployed recently, wait for indexing.

### Requested contract address ... is not deployed

The contract at that address is not deployed on the network your wallet is using. Switch to Starknet Sepolia and confirm the app is pointing to Sepolia contracts.

## Ekubo API unavailable / EKUBO_CHAIN_ID not set

Positions may show "pending" or "Ekubo API unavailable" when the backend cannot reach Ekubo (e.g. for position data). Check backend environment (Ekubo RPC/API config). As a user, you can retry later or check [FAQ](/faq) and support channels.

## Where to get help

- **GitHub Issues:** [Report bugs or request features](https://github.com/obsqra-labs/zkdefi/issues)
- **Twitter:** [@obsqralabs](https://twitter.com/obsqralabs)

See also [Developers](/developers), [API overview](/api-overview), and [FAQ](/faq).

Next: [FAQ](/faq) | [Developers](/developers)
