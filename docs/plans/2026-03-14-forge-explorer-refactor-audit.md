# zkSyslog Explorer — Audit & Stylish Refactor Brief

**Date:** 2026-03-14**Scope:** Post-functionality audit; redesign brief for a stylish refactor.

**Refactor done (2026-03):** Single design system at `backend/app/static/forge-explorer.css`, served at **GET /explorer/static/explorer.css**. All explorer pages link to it and use shared chrome via `_forge_header_html()` / `_forge_footer_links_html()` in `backend/app/api/routes/forge.py`. **Public path:** zkde.fi/explorer (router prefix `/explorer`, mounted at app root and at `/api/v1/zkdefi`).

---

## 1. What Exists

### Routes
- **GET /forge/** — Homepage (search, scope chips, stats, feed, lanes, Explorer API).
- **GET /forge/feed** — JSON; items have `detail_href`; `paths` in response.
- **GET /forge/search** — JSON; results have `detail_href`; `paths`.
- **GET /forge/detail/{type}/{id}** — HTML/JSON; 3 panes; relationships have `href`; `self_href` + `paths`.
- **GET /forge/status**, **/forge/paths**, **/forge/health**, **/forge/proving**, **/forge/lane/{id}** — As implemented.

APIs link; paths are discoverable. Functionality is in place.

### HTML Pages
- **Home:** Header (brand, Health/Proving, status), search bar + scope chips, search results, stat strip, feed table, lanes, Explorer API block, footer.
- **Detail:** Breadcrumb, title, Summary / Verification Timeline / Relationships panes.
- **Lane:** Back link, title + badge, table.
- **Health / Proving:** Minimal: back link, h1, one paragraph.

### Front-end (home)
Scope chips, search, Clear, Load more, URL sync, "/" focus. All working.

---

## 2. Inconsistencies & Debt

### CSS
- **Homepage:** Large inline style block; :root with --bg, --panel, --link, --emerald, --cyan, etc.
- **Detail:** Separate inline block; smaller :root (no --link, --cyan); different body padding and container width (1000px vs 1100px).
- **Lane:** Own minimal inline CSS; 900px container.
- **Health/Proving:** Inline body/a only; no :root, no shared chrome.

No single source of truth. Changing palette or type means editing several template strings in forge.py.

### Typography
- Fonts: Inter, Segoe UI, JetBrains Mono, Fira Code — no preconnect or single --font-sans/--font-mono.
- Mix of px and rem; no type scale. Section titles and labels are ad hoc.

### Color
- Link color: sometimes --link (cyan), sometimes --emerald. Badges: only onchain/runtime; no pending/error/unknown. Focus-visible only on scope chips.

### Layout
- Different max-widths: 1100 (home), 1000 (detail), 900 (lane). No shared --space-section. One breakpoint at 640px; no tablet or large-screen.

### Components
- Header only on home. Lane/Health/Proving/Detail use plain `<nav><a>← …</a></nav>` with no logo or shared footer.
- Tables: same columns but styles repeated. No shared .card/.panel. Empty states are text-only.

### Motion & a11y
- No loading skeleton for search; no focus ring on buttons/links. No skip link; tables without caption. Detail has breadcrumb aria; others lack landmarks.

### Identity
- Footer says StarkForge / zkSyslog — Obsqra Labs but no logo or proof-first visual. Health/Proving feel like afterthoughts. No “signature” element.

---

## 3. What the Redesign Needs

### 3.1 One design system
- **Tokens:** Colors (bg, surface, border, text, muted, primary, link, success, warning, error), type scale, spacing scale, radius. Use same tokens on every page.
- **One content width** (e.g. 1100px) and one section spacing for home, detail, lane, health, proving.

### 3.2 Typography
- Type scale (e.g. --text-xs … --text-xl); single --font-sans, --font-mono; preconnect. One h1 style, one section title, one caption.

### 3.3 Color & focus
- One rule for links (primary vs secondary). Badges: 3–4 states (success, warning, error, neutral). Focus-visible for all interactives.

### 3.4 Shared chrome
- Same header (brand + nav + status) and footer on home, detail, lane, health, proving. Back/breadcrumb inside that chrome.

### 3.5 Layout & responsive
- 2–3 breakpoints (e.g. &lt;640, 640–1024, &gt;1024). Same section gap and grid behavior.

### 3.6 Polish
- Loading: spinner or skeleton for search. Optional short transition on results/load more. Focus first result for keyboard.

### 3.7 Identity
- One proof-first hook on home (e.g. short “Evidence flow” line or icon). Optional type-specific treatment on detail (icon per object type). Health/Proving use same layout and tokens.

### 3.8 Implementation
- **Option A:** One big CSS block in forge.py, inject in every response; duplicate header/footer in each template.
- **Option B (recommended):** One static `explorer.css` (tokens + components); all HTML pages link to it; same header/footer in every view. Refactor is in one CSS file.
- **Option C:** Shared base template with slots for content; same chrome everywhere.

---

## 4. Refactor Checklist

- [x] Single token set (colors, type, spacing, radius) used everywhere.
- [x] One shared CSS file or single injected block for all explorer HTML.
- [x] Same chrome (header + footer) on home, detail, lane, health, proving.
- [x] Type scale and font loading; consistent h1, section title, caption; preconnect in head.
- [x] Link/badge semantics; focus-visible on all interactives (buttons, links, scope chips).
- [x] One content width and section spacing; 2–3 breakpoints.
- [x] Empty states and search loading — "Searching…" at start of doSearch().
- [ ] Optional: evidence-flow or brand moment; type-specific detail.
- [x] A11y: landmarks (main#main-content), skip link, table captions (.sr-only), focus order.

---

## 5. Files to Touch

- **forge.py:** Replace or reduce inline CSS; add shared header/footer to lane, health, proving, detail.
- **New static CSS (if Option B):** e.g. `forge-explorer.css` with full design system.
- **Design doc:** Optionally reference this audit in the consolidation design.

No API changes required; only HTML structure and CSS.
