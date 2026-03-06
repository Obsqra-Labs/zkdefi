# Nginx config for zkde.fi (fix ChunkLoadError)

ChunkLoadError and missing CSS on zkde.fi happen when **HTML and _next/static chunks are from different builds** (e.g. nginx cached old HTML, or Node was restarted with a new build but nginx still serves cached responses).

## 1. Proxy everything to Node (recommended)

Let the Next.js app on port 3001 serve **all** requests (HTML and `/_next/static/*`). That way one build’s HTML and chunks always match.

```nginx
server {
    listen 443 ssl http2;
    server_name zkde.fi www.zkde.fi;
    # ssl_certificate /path/to/fullchain.pem;
    # ssl_certificate_key /path/to/privkey.pem;

    # Don't cache the document — after deploy users must get fresh HTML
    location = / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        proxy_cache off;
    }

    # Don't cache app routes (HTML / RSC)
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        proxy_cache off;
    }

    # Optional: long cache for hashed static chunks (Next.js sets immutable)
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

If you use **proxy_cache** elsewhere, either:

- **Disable it** for this server (no `proxy_cache` / `proxy_cache_valid`), or  
- Use a **cache key that includes the build** (e.g. a version header from Node) so old HTML is never served after deploy.

## 2. After each frontend deploy

On the **server that hosts zkde.fi**:

1. **Full rebuild and restart** (same build for HTML and chunks):
   ```bash
   cd /path/to/zkdefi
   ./deploy_production.sh
   ```
2. **Reload nginx** so it drops any cached response for this site:
   ```bash
   sudo nginx -t && sudo nginx -s reload
   ```
3. If you use **proxy_cache**, clear it (path depends on your config), e.g.:
   ```bash
   sudo rm -rf /var/cache/nginx/zkde.fi/*   # if you use proxy_cache_path
   sudo nginx -s reload
   ```

## 3. If ChunkLoadError still appears

- **Hard refresh** in the browser (Ctrl+Shift+R / Cmd+Shift+R) or open the site in a private window.
- Confirm the **same** `.next` build is used: only one `npm run build` followed by `npm start` (or pm2 restart), with no mix of old and new build files.
- Check that **315-6bad31781ca4e364.js** (or the failing chunk) exists on the server:
  ```bash
  ls -la /path/to/zkdefi/frontend/.next/static/chunks/315-*.js
  ```
  If the hash differs from what the browser requests, HTML and chunks are from different builds — run `./deploy_production.sh` again and reload nginx.
