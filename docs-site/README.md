# zkde.fi docs site

User-facing documentation for [zkde.fi](https://zkde.fi). Built with [VitePress](https://vitepress.dev/).

## Run locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173` (or the next available port).

## Build

```bash
npm run build
```

Output is in `docs/.vitepress/dist`. Serve that directory as static files.

## Deploy to docs.zkde.fi

1. Run `npm run build`.
2. Deploy the contents of `docs/.vitepress/dist` to your host (Vercel, Netlify, or any static host).
3. Point DNS: `docs.zkde.fi` → CNAME to your host (e.g. `your-project.vercel.app`).

Example (Vercel): link this repo or the `docs-site` folder; set root to `docs-site` and build command to `npm run build`; output directory to `docs/.vitepress/dist`.
