# Deploy to Ekubo (end-to-end)

Deploy capital to Ekubo pools on **Starknet Sepolia** from the live app.

1. **Open [zkde.fi/agent](https://zkde.fi/agent) and connect your wallet** — Use the Connect button if you aren’t already connected.

2. **Find the "Deploy to Ekubo" card** — On the Dashboard tab, scroll to the Deploy to Ekubo section (you can also use the link from the landing page that scrolls to `#deploy-to-ekubo`).

3. **Enter the amount you want to deploy** — The backend recommends an allocation (e.g. ETH/USDC, STRK/USDC) based on your risk profile.

4. **Review the suggested positions** — You’ll see how much goes to each pool (e.g. ekubo_eth_usdc, ekubo_strk_usdc). Click **Sign & execute** when ready.

5. **Sign in your wallet** — Approve the token approval and swap (or add-liquidity) transactions. Confirm in your wallet.

6. **Receipt and deployment ID** — After the transaction is broadcast, you’ll see a deployment ID and a receipt hash. Positions may show as "pending" until the chain and Ekubo indexer confirm. If you see **Ekubo API unavailable**, positions may stay pending until the backend can reach Ekubo; see [Troubleshooting](/troubleshooting) or [FAQ](/faq) for support.

**Note:** Deploy to Ekubo is **Ekubo Sepolia only**. Ensure your wallet is on Starknet Sepolia.

See [Agent dashboard](/agent-dashboard) for the full flow. For common errors see [Troubleshooting](/troubleshooting) or [FAQ](/faq).

Next: [Agent dashboard](/agent-dashboard) | [Troubleshooting](/troubleshooting)
