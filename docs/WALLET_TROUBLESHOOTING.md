# Wallet connection troubleshooting (zkde.fi)

## Argent X doesn’t open / won’t load

If **Braavos** works but **Argent X** doesn’t when you click “Connect Wallet”:

### 1. Reset site connection in Argent X

1. Open the **Argent X** extension.
2. Go to **Settings** (gear) → **Connected sites** (or **Permissions** / **Authorized apps**).
3. Find **zkde.fi** (or `localhost:3001` if testing locally) and **Disconnect** / **Revoke**.
4. Close the wallet modal on zkde.fi, **refresh the page** (F5 or Cmd+R).
5. Click **Connect Wallet** again and choose **Argent**.

### 2. Chrome: clear site data for zkde.fi

If the connection is stuck in Chrome:

1. Open **Chrome** → **Settings** → **Privacy and security** → **Site settings** → **View permissions and data stored across sites**.
2. Search for **zkde.fi** (or your app origin).
3. Click the trash icon to **Clear data** for that site.
4. Reload zkde.fi and try connecting again.

Or use **DevTools**:

1. Open zkde.fi, then **F12** (or right‑click → Inspect) → **Application** tab.
2. Under **Storage**, click **Clear site data** (or clear **Local storage** / **Session storage** for this origin).
3. Refresh the page and try again.

### 3. Update Argent X

- **Chrome**: `chrome://extensions` → find Argent X → **Update** (or remove and reinstall from [Chrome Web Store](https://chrome.google.com/webstore/detail/argent-x/dlcobpjiigpikoobohmabehhmhfoodbb)).
- Make sure you’re on the latest extension version.

### 4. Use Braavos in the meantime

Braavos works on the same Starknet Sepolia network. You can connect with Braavos to use the app while fixing Argent X, then switch back later if you prefer.

---

## RPC / “Wallet won’t load” at all

If the Connect Wallet modal never shows wallets or the page hangs:

- Set **NEXT_PUBLIC_RPC_URL** in `frontend/.env.local` to a working Sepolia RPC (e.g. Alchemy). See [ENV.md](ENV.md).
- Restart or rebuild the frontend after changing env.

---

## Full Privacy: "Unknown merkle root" on withdraw

If **deposit** succeeds but **withdraw** fails with `Error in contract ... Unknown merkle root`:

The pool only accepts withdrawals when the **Merkle root** in your proof has been registered on-chain (via `add_known_root`). That registration happens **after** you register your commitment (when the app calls the backend’s `register_commitment`). If the backend is not configured to sync roots, or you withdraw before the sync tx confirms, the pool will reject the root.

**What to do:**

1. **Wait after deposit**  
   After depositing, the app calls `register_commitment` and the backend may schedule `add_known_root`. Wait **at least 30–60 seconds** (until the `add_known_root` transaction confirms) before withdrawing.

2. **Check backend configuration (self-hosted / dev)**  
   In `backend/.env` set:
   - `FULL_PRIVACY_MERKLE_TREE_ADDRESS` — the Merkle tree contract address used by the pool
   - `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY` — admin key (hex)
   - `FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS` — admin account address (hex)  

   If these are missing, the backend will **not** call `add_known_root` after `register_commitment`, so withdraw will always fail with "Unknown merkle root". See [FULL_PRIVACY_MERKLE_ROOT_SYNC.md](FULL_PRIVACY_MERKLE_ROOT_SYNC.md).

3. **Manual root registration (production)**  
   For production, the admin key should **not** live on the app server. After each deposit, an operator (with the admin key) must call `add_known_root(root_felt)` on the Merkle tree contract using the `merkle_root` returned by `register_commitment`. See [FULL_PRIVACY_MERKLE_ROOT_SYNC.md](FULL_PRIVACY_MERKLE_ROOT_SYNC.md#manual-root-registration-recommended-for-production).

4. **Confirm pool and tree**  
   The pool contract must use a Merkle tree that has the `add_known_root` entrypoint (deployed via `scripts/deploy_merkle_tree_and_full_privacy_pool.sh`). If you use an older tree without it, roots can never be registered and withdraw will always fail.
