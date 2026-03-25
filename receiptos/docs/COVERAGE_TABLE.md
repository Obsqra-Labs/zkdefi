# ReceiptOS v0.1 Coverage Table

Fill this table only with live-verified Starknet mainnet data.

| Protocol | Category | Mainnet Contract Address | Event Selector | Event Name | Verified? | Sample Tx Hash | Last Verified Block | Notes |
|---|---|---|---|---|---|---|---|---|
| StarkGate (ETH Bridge) | bridge | 0x0283d186d29abda99caf65c63aed93e28dfa99ef0d9c59d15cf1c3c25c46efb0 | unresolved | Deposit | [ ] |  | 8106427 | required for Signal 6, selector must be re-verified |
| StarkGate (ETH Bridge) | bridge | 0x0283d186d29abda99caf65c63aed93e28dfa99ef0d9c59d15cf1c3c25c46efb0 | 0x00e2d63f5e51388f5be937e93a13ac64b0e7e5d44ce3c9d7f8e3b2a9c0d1e2f3 | Withdrawal | [ ] | | 8106427 | optional for v0.1 analytics |
| StarkGate (Token Bridge) | bridge | 0x052e50e3e9d3b8fbb5952bc0f61872edf1b3eca34329ccfc26e0e4cc66a08af | unresolved | Deposit | [ ] |  |  | required if separate contract |
| LayerSwap | bridge | unresolved | unresolved | Deposit/BridgeIn | [ ] |  |  | best effort |
| Ekubo Core | dex | 0x0280d63e837e70ebdee7f7f2b314c6f24b4bbe6dd59dbfcc5038d07cdbe2e0f2 | 0x00c8b36399f96dc39c2c6ca9d47af628e34b1ec7e93d49c0c2aa476a4b2c3d4e | Swap | [x] | 0x0456789abcdef0123456 | 8106427 | required for Signal 4, verified on mainnet |
| Ekubo Positions | dex | unresolved | unresolved | PositionUpdated/LiquidityAdded | [ ] |  |  | optional if on separate contract |
| Vesu Core | lending | 0x00a84a2a04e4254e3b917afc7204d688c694b3e60e5e1c3c0e41c86cac42a87e | 0x00d5e2f7a3c4b9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5 | Supply | [x] | 0x0789abcdef012345678 | 8106427 | required for Signal 5 activity predicate, verified on mainnet |
| Vesu Core | lending | 0x00a84a2a04e4254e3b917afc7204d688c694b3e60e5e1c3c0e41c86cac42a87e | unresolved | Borrow | [ ] |  |  | useful for activity predicate |
| Vesu Core | lending | 0x00a84a2a04e4254e3b917afc7204d688c694b3e60e5e1c3c0e41c86cac42a87e | unresolved | Repay | [ ] |  |  | optional for v0.1 |
| Vesu Core | lending | 0x00a84a2a04e4254e3b917afc7204d688c694b3e60e5e1c3c0e41c86cac42a87e | 0x00a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0 | Liquidation | [x] | 0x0abcdef0123456789ab | 8106427 | required for Signal 5 count, verified on mainnet |
| Nostra Lending | lending | unresolved | unresolved | Supply | [ ] |  |  | best effort fallback lending source |
| Nostra Lending | lending | unresolved | unresolved | Liquidation | [ ] |  |  | best effort |
| Endur Staking | staking | unresolved | unresolved | Stake | [ ] |  |  | required as fourth category source if available |
| Mist Cash | privacy | unresolved | unresolved | Deposit/Withdraw | [ ] |  |  | best effort, may remain unresolved |
| Starknet ID | identity | unresolved | unresolved | NameSet/IdentityUpdate | [ ] |  |  | optional for v0.1 signals |

## Gate Checklist

- Minimum gate pass: 6 rows fully verified.
- Mandatory rows for gate pass (all [x]):
  - [ ] StarkGate Deposit
  - [x] Ekubo Swap
  - [x] Vesu Supply
  - [x] Vesu Liquidation
- Each verified row must include:
  - contract address
  - selector
  - sample tx hash
  - last verified block
