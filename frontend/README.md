# zkDeFi Frontend

Privacy-preserving Capital OS interface built with Next.js 14, TypeScript, and Starknet React.

## Overview

The Capital OS interface provides three canonical surfaces for DeFi capital allocation:

1. **Vault** (`/agent?v=vault`) - Execution surfaces (deposits, withdrawals, positions)
2. **Oracle** (`/agent?v=oracle`) - Discovery surfaces (opportunities, recommendations, intelligence)
3. **Brain** (`/agent?v=brain`) - System surfaces (agents, models, pipelines)

All surfaces display **real-time attested intelligence** from obsqra's zkGraph with full provenance.

---

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript 5.x
- **State:** React hooks + Context API
- **Blockchain:** @starknet-react/core, starknet.js
- **Styling:** Tailwind CSS 3.x
- **Animation:** Framer Motion
- **Icons:** Lucide React
- **Charts:** Recharts
- **WebSocket:** Native WebSocket API + reconnection logic

---

## Architecture

### Directory Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── agent/             # Main Capital OS surface
│   ├── marketplace/       # Agent marketplace
│   ├── mvp/               # MVP demo surface
│   ├── profile/           # User profile (trust, reputation, compliance)
│   └── page.tsx           # Landing page
│
├── components/zkdefi/     # Capital OS components
│   ├── surfaces/          # Three main surfaces (Vault, Oracle, Brain)
│   ├── oracle/            # Oracle-specific components (signals, radar, genome)
│   ├── vault/             # Vault-specific components (deposit, withdraw, positions)
│   ├── ProvenanceDisplay.tsx    # zkGraph provenance component (NEW)
│   ├── ZkGraphWidget.tsx        # Attested intelligence widget (NEW)
│   ├── AgentDashboard.tsx       # Agent status and controls
│   ├── ActivityLog.tsx          # Real-time activity feed
│   └── ... (50+ components)
│
├── hooks/                 # Custom React hooks
│   ├── usePrivacyVault.ts      # Privacy vault operations
│   ├── useWebSocket.ts         # WebSocket connection manager
│   ├── useVaultController.ts   # Vault contract integration
│   └── useProfile.ts           # User profile data
│
├── lib/                   # Utilities and services
│   ├── AppContext.tsx     # Global state (activity feed, wallet)
│   ├── api/               # API client functions
│   ├── explorer.ts        # Voyager links (NO Starkscan)
│   ├── sessionKeys.ts     # Session key utilities
│   └── demoCapitalOS.ts   # Demo mode fixtures
│
└── types/                 # TypeScript type definitions
```

---

## Key Components

### ProvenanceDisplay (`components/zkdefi/ProvenanceDisplay.tsx`)

Displays zkGraph provenance with cryptographic attestation details.

**Usage:**
```tsx
import { ProvenanceDisplay, InlineProvenance } from "@/components/zkdefi/ProvenanceDisplay";

// Full display
<ProvenanceDisplay provenance={zkragProvenance} variant="full" />

// Compact badge
<ProvenanceDisplay provenance={zkragProvenance} variant="compact" />

// Single-line inline
<InlineProvenance provenance={zkragProvenance} />
```

**Props:**
```typescript
interface ZkGraphProvenance {
  fact_hash: string;         // Registered in Integrity Registry
  block_range: string;       // "4836801-4836900"
  merkle_root: string;       // Merkle tree root
  source_count: number;      // Number of sources
  verified_on_chain: boolean;
}
```

### ZkGraphWidget (`components/zkdefi/ZkGraphWidget.tsx`)

Real-time attested intelligence widget for Capital OS.

**Usage:**
```tsx
import { ZkGraphWidget, ZkGraphBadge } from "@/components/zkdefi/ZkGraphWidget";

// Full widget (Oracle surface)
<ZkGraphWidget poolId="ekubo_eth_usdc" variant="full" />

// Compact status
<ZkGraphWidget poolId="ekubo_eth_usdc" variant="compact" />

// Minimal badge (navbar)
<ZkGraphBadge />
```

**Features:**
- Auto-refreshes every 60s
- Shows market context with provenance
- Displays historical patterns (TVL, volatility)
- System health (cache, rate limits)
- Links to obsqra zkGraph dashboard

---

## API Integration

### Backend Endpoints

All API calls go through `API_BASE` (configured per environment):

```typescript
// Development
const API_BASE = "http://localhost:8003";

// Production
const API_BASE = "https://zkde.fi";
```

### zkGraph Endpoints

```typescript
// Health check
GET /api/v1/zkdefi/zkgraph/health

// Market context for pool
GET /api/v1/zkdefi/zkgraph/context/{pool_id}

// Historical patterns
GET /api/v1/zkdefi/zkgraph/patterns/{pattern_type}?limit=5

// Similar strategies
GET /api/v1/zkdefi/zkgraph/strategies/{strategy_id}?limit=5

// Verify provenance
POST /api/v1/zkdefi/zkgraph/verify
Body: { fact_hash, response_hash }
```

### Privacy Vault Endpoints

```typescript
// Shielded deposit
POST /api/v1/vault/shielded_deposit
Body: { user_address, amount_wei, nullifier }

// Shielded withdraw
POST /api/v1/vault/shielded_withdraw
Body: { user_address, nullifier, amount_wei, recipient }

// Get commitments
GET /api/v1/vault/commitments/{user_address}
```

---

## Development

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

Runs on http://localhost:3001

### Build for Production

```bash
npm run build
```

### Type Check

```bash
npm run type-check
```

---

## Environment Variables

Create `.env.local` with:

```bash
# RPC
NEXT_PUBLIC_RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/<key>

# Contract Addresses (Sepolia)
NEXT_PUBLIC_VAULT_CONTROLLER_ADDRESS=0x6c5b17eab7f20da1ab69e98db6f3f63cbcefa28992a17787883c76dd13498d1
NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS=0x03dde5617d362a6f9202cd3955b4508e2bd6b1c5d35250153beeb6237c811559
NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS=0x1234...
NEXT_PUBLIC_SESSION_KEY_MANAGER_ADDRESS=0x5678...

# Backend API
NEXT_PUBLIC_API_BASE_URL=https://zkde.fi

# Features
NEXT_PUBLIC_ENABLE_DEMO_MODE=true
```

---

## Styling Guidelines

### Color Palette

- **Primary (Emerald):** Intelligence, attestation, verified data
  ```css
  border-emerald-500/20
  bg-emerald-500/5
  text-emerald-300
  ```

- **Secondary (Blue):** Oracle, recommendations, signals
  ```css
  border-blue-500/20
  bg-blue-500/5
  text-blue-300
  ```

- **Accent (Violet):** Brain, agents, models
  ```css
  border-violet-500/20
  bg-violet-500/5
  text-violet-300
  ```

- **Neutral (Zinc):** Backgrounds, borders, text
  ```css
  bg-zinc-900/50
  border-zinc-700/50
  text-zinc-400
  ```

### Component Patterns

**Gradient panels:**
```tsx
<div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-900/20 via-slate-900/50 to-slate-900/50 p-5">
```

**Status badges:**
```tsx
<span className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs">
  Verified
</span>
```

**Buttons:**
```tsx
<button className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-700 text-white hover:from-emerald-500 hover:to-emerald-600 shadow-lg shadow-emerald-900/30">
  Submit
</button>
```

---

## Key Features

### 1. Real-Time Updates (WebSocket)

**Hook:** `useWebSocket(address, options)`

```typescript
import { useWebSocket } from "@/hooks/useWebSocket";

const { connected, subscribe, send } = useWebSocket(address, { enabled: true });

useEffect(() => {
  if (!connected) return;
  
  const unsubscribe = subscribe<StrategyUpdateEvent>("strategy_update", (event) => {
    console.log("Strategy updated:", event);
  });
  
  return unsubscribe;
}, [connected, subscribe]);
```

**Events:**
- `strategy_update` - Strategy intelligence refresh
- `alert` - Risk/anomaly alerts
- `proof_complete` - Proof generation done
- `position_change` - LP position updates

### 2. Privacy Vault Operations

**Hook:** `usePrivacyVault()`

```typescript
import { usePrivacyVault } from "@/hooks/usePrivacyVault";

const { deposit, withdraw, commitments, loading } = usePrivacyVault();

// Shielded deposit
await deposit({
  amount: "1.5",  // In ETH
  nullifier: "0xrandom32bytes...",
  method: "nullifier_set"
});

// Private withdrawal
await withdraw({
  commitment: commitments[0],
  recipient: "0xrecipient..."
});
```

### 3. Explorer Links

**ALWAYS use Voyager (never Starkscan):**

```typescript
import { sepoliaVoyagerTxUrl, voyagerBaseUrl } from "@/lib/explorer";

// Transaction link
const txUrl = sepoliaVoyagerTxUrl(txHash);
// https://sepolia.voyager.online/tx/0x...

// Block link
const blockUrl = `${voyagerBaseUrl()}/block/${blockNumber}`;
// https://sepolia.voyager.online/block/4836900

// Contract link
import { sepoliaVoyagerContractUrl } from "@/lib/explorer";
const contractUrl = sepoliaVoyagerContractUrl(address);
```

### 4. Demo Mode

**Fixture:** `lib/demoCapitalOS.ts`

Demo mode activates when:
- User clicks "Try Demo" on landing page
- Wallet address matches `DEMO_ADDRESS`
- All API calls return static fixture data

**Toggle:**
```typescript
const isDemo = address === DEMO_ADDRESS;

if (isDemo) {
  return DEMO_OPPORTUNITIES;  // Static data
} else {
  return await fetch(...);     // Real API
}
```

---

## Testing

### Component Testing

```bash
# Type check
npm run type-check

# Lint
npm run lint

# Build (includes type check)
npm run build
```

### Browser Testing

1. **Start backend:**
```bash
cd ../backend
pm2 restart zkdefi-backend
```

2. **Start frontend:**
```bash
npm run dev
```

3. **Test surfaces:**
- `/agent?v=vault` - Deposit, withdraw, positions
- `/agent?v=oracle` - Opportunities, zkGraph widget
- `/agent?v=brain` - Agents, models
- `/profile?tab=trust` - Trust score, reputation

### WebSocket Testing

```bash
# Terminal 1: Backend with WebSocket
cd ../backend && pm2 logs zkdefi-backend

# Terminal 2: Frontend
npm run dev

# Browser console:
# Should see "WebSocket connected" logs
```

---

## Performance

### Optimization Strategies

1. **Code splitting:** Dynamic imports for heavy components
```typescript
const HeavyComponent = dynamic(() => import("./HeavyComponent"), {
  loading: () => <Loader />,
  ssr: false
});
```

2. **API caching:** zkGraph client caches with TTL
- Market context: 60s
- Historical patterns: 300s

3. **Memoization:** Heavy computations use `useMemo`
```typescript
const expensiveValue = useMemo(() => compute(data), [data]);
```

4. **Pagination:** Large lists use offset/limit

---

## Deployment

### Build for Production

```bash
npm run build
```

**Output:** `.next/` directory with optimized bundle

### Deploy to Production

```bash
# Using PM2
pm2 start npm --name "zkdefi-frontend" -- start

# Or manual
npm run build && npm start
```

### Nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name zkde.fi;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    # WebSocket support
    location /ws {
        proxy_pass http://localhost:8003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## Troubleshooting

### "Cannot connect to wallet"

**Cause:** Wallet extension not installed or not on Sepolia  
**Fix:** Install Argent X or Braavos, switch to Sepolia network

### "WebSocket disconnected"

**Cause:** Backend not running or CORS misconfigured  
**Fix:** Check `pm2 logs zkdefi-backend`, verify CORS allows `http://localhost:3001`

### "No opportunities shown"

**Cause:** Backend `/strategies/opportunities` endpoint failing  
**Fix:** Check backend logs, verify database has strategy data

### "zkGraph widget shows 'local only'"

**Cause:** obsqra.fi backend not reachable or `ZKGRAPH_ENABLED=false`  
**Fix:** 
1. Check obsqra backend: `curl http://localhost:8002/api/v1/zkrag/audit/latest`
2. Verify `.env`: `ZKGRAPH_ENABLED=true`

---

## Contributing

### Code Style

- **Formatting:** Prettier (2 spaces, semicolons)
- **Linting:** ESLint (Next.js config)
- **Naming:** 
  - Components: PascalCase (`ProvenanceDisplay.tsx`)
  - Hooks: camelCase with `use` prefix (`useWebSocket.ts`)
  - Utilities: camelCase (`explorer.ts`)

### Component Guidelines

1. **Always use Voyager for explorer links** (never Starkscan)
2. **Fail gracefully** - show fallback UI on API errors
3. **Loading states** - skeleton/spinner for async data
4. **Type everything** - no `any` except for external APIs
5. **Accessibility** - semantic HTML, ARIA labels
6. **Mobile-first** - responsive design with Tailwind

### Adding New Features

1. **Check existing components** - reuse before creating new
2. **Follow design patterns** - gradient panels, status badges, etc.
3. **Add to appropriate surface** - Vault/Oracle/Brain
4. **Test both demo and live modes**
5. **Update this README** if adding major features

---

## Resources

- **Next.js Docs:** https://nextjs.org/docs
- **Starknet React:** https://starknet-react.com/
- **Tailwind CSS:** https://tailwindcss.com/docs
- **Voyager Explorer:** https://sepolia.voyager.online
- **zkDeFi Docs:** https://zkde.fi/docs/

---

**Last Updated:** March 5, 2026  
**Phase:** 9B (Frontend Intelligence UI)  
**Stack:** Next.js 14 + TypeScript + Starknet React + Tailwind
