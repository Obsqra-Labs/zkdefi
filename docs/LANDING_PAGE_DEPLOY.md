# Landing page changes (zkDE + GATE) — how to see them at zkde.fi

The landing page and docs now use **zkDE (Zero-Knowledge Deterministic Engine)** and **GATE (Governed Autonomous Trustless Execution)**. Those edits are in the repo only until you redeploy.

**zkde.fi** is the live site; it serves whatever was last deployed to Hostinger (or your host). To see the new copy at zkde.fi:

1. **Create a fresh deployment archive** (includes current landing page):
   ```bash
   ./deploy_zkdefi_to_hostinger.sh
   ```

2. **Deploy that archive to zkde.fi** using your usual method:
   - **Hostinger MCP:** “Deploy \<path-to-archive\> to zkde.fi using hosting_deployJsApplication”
   - **Hostinger panel:** Upload the generated `.tar.gz` to the zkde.fi site; Hostinger will run `npm install && npm run build`.

3. **Optional:** Set/update env vars on the host (e.g. `NEXT_PUBLIC_API_URL`, contract addresses) if needed.

After deployment, the live site will show the zkDE + GATE hero line, value props, “How it works,” and footer copy.

**To verify locally first:** run `cd frontend && npm run dev` and open http://localhost:3001 — you’ll see the updated landing page without deploying.
