# Contributing to zkde.fi

Thank you for helping improve [zkde.fi](https://zkde.fi). This repository is maintained by [Obsqra Labs](https://obsqra.xyz).

## Before you open a PR

1. **Branch from `main`** with a short, descriptive name (e.g. `fix/portfolio-api-timeout`).
2. **Run the same checks as CI** locally when you touch the relevant areas:
   - Backend: `make test-backend` (from repo root; requires Python 3.12 and `backend/requirements.txt`).
   - Frontend: `make build-frontend` (Node 20, lockfile in `frontend/`).
3. **Do not commit secrets.** Use `backend/.env.example` and `frontend/.env.example` as templates; real `.env` files are gitignored.
4. **Conflict-safe paths:** PRs that modify certain high-churn paths may be rejected by `scripts/check_conflict_safe_paths.sh` (see script for the enforced set).

## CI

GitHub Actions runs on pushes and PRs to `main`: backend tests, frontend build, proof regression, and showcase gate. A green CI run is expected before merge.

## Code style

- **Python:** Match existing modules in `backend/app/` (FastAPI patterns, type hints where used).
- **TypeScript / React:** Follow existing `frontend/src/` conventions (ESLint where configured).

## Questions

For security-sensitive reports, see [SECURITY.md](SECURITY.md). For general discussion, open a GitHub issue or PR with context and links to any related specs under `docs/`.
