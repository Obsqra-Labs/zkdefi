# Frontend 400 on static chunks (CSS/JS)

If you see **400 Bad Request** on `/_next/static/chunks/*.js` or `*.css` when opening the app (e.g. `/agent`), the server is rejecting those requests.

## Likely cause: browser extension

Console messages like **inject.js**, **lockdown-install.js**, **SES Removing unpermitted intrinsics** indicate a **browser extension** (e.g. MetaMask, Brave Shields, or another wallet/security extension) is injecting scripts. Some extensions intercept or modify `fetch()` and can cause the dev server to respond with 400 to chunk requests.

## What to do

1. **Test in Incognito / Private window**  
   Extensions are usually disabled there. Open `http://localhost:3001/agent` in an incognito window. If the 400s disappear and the app loads, the extension is the cause.

2. **Disable extensions for localhost**  
   In your browser, disable the wallet/security extension for `http://localhost:3001` (or use a separate profile without that extension).

3. **Use another browser**  
   Open the app in a browser that doesn’t have the same extensions (e.g. Chrome vs Firefox).

4. **Run production build locally**  
   Static files are served differently in production mode, which can avoid the 400:
   ```bash
   cd frontend && npm run build && npm run start
   ```
   Then open `http://localhost:3001/agent`.

## If you’re behind a proxy or tunnel

If you’re not using `http://localhost:3001` directly but a tunnel (e.g. ngrok, Cloudflare Tunnel) or a reverse proxy, the proxy might be sending or altering headers and triggering 400. Try opening **http://localhost:3001** directly to confirm.

## Summary

- **400 on `/_next/static/...`** = server is rejecting the request (often due to request shape/headers).
- **Quick check:** Incognito window → if it works, disable or relax the extension for localhost.
- **Alternative:** Run `npm run build && npm run start` and test on the same port.
