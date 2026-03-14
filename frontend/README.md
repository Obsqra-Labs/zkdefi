# Frontend

Next.js 14 application for [zkde.fi](https://zkde.fi).

## Routes

| Route | Surface |
|---|---|
| `/` | Landing page — architecture, roadmap, live proof status |
| `/agent` | Agent identity + proof-gated actions |
| `/profile` | User reputation dashboard + badge screening |
| `/products` | DeFi products overview |
| `/trade` | Paper trade desk + scanner |
| `/vault` | Privacy vault management |
| `/lending` | Reputation-gated lending |
| `/oracle` | Price oracle + signal feeds |
| `/marketplace` | Model marketplace (EZKL models) |
| `/privacy` | Privacy pool interface |
| `/test` | Live proof readout (public showcase) |

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev          # → http://localhost:3001
```

### Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend URL (default: `http://localhost:8003`) |
| `NEXT_PUBLIC_RPC_URL` | Starknet RPC endpoint |

## Stack

Next.js 14 · React · Tailwind CSS · TypeScript
