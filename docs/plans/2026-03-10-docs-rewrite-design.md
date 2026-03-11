# Documentation Rewrite — Design

**Status:** Design (pre-implementation)  
**Date:** 2026-03-10  
**Scope:** Single source of truth for zkde.fi: MVP/features, architecture, roadmap, deployment, API, specs. Verbose and technical; no mock or pseudo content. Architecture and flows in Mermaid.

---

## 1. Goals and constraints

### 1.1 Objectives

- **Single source of truth:** One coherent doc set so "what zkde.fi is," "what works today," "how to run and deploy," and "where we're going" are unambiguous.
- **Audience:** New developers (local run, contribute), integrators (API and flows), evaluators/partners (live vs roadmap), operators (deploy and troubleshoot).
- **Tone:** Verbose and technical. Reference real paths, modules, endpoints, and env vars. No placeholder code, mock payloads, or pseudo-APIs.
- **Diagrams:** Architecture, request flows, doc structure, and deployment topology in Mermaid; renderable in GitHub, MkDocs, or any Markdown viewer that supports Mermaid.

### 1.2 Non-goals

- Rewriting implementation plans in docs/plans/; the rewrite links to them and optionally adds a themed index.
- Replacing OpenAPI as the API contract; docs point at /docs and optionally provide a short overview by area.
- Migrating to a separate doc framework in this design; structure is file-based under docs/ with optional later rendering (e.g. docs.zkde.fi).
