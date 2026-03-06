# Staging zkdefi work for GitHub

Use these commits to add the zkdefi hackathon work in logical chunks (run from repo root). No deploy or push until hackathon start.

## Commit 1 – Contracts and circuits

```bash
git add zkdefi/contracts/ zkdefi/circuits/ zkdefi/scripts/
git commit -m "zkde.fi: contracts (proof-gated agent, selective disclosure, confidential transfer) and circuits"
```

## Commit 2 – Backend

```bash
git add zkdefi/backend/
git commit -m "zkdefi: backend API (deposit, withdraw, disclosure, private_deposit)"
```

## Commit 3 – Frontend base and landing

```bash
git add zkdefi/frontend/
git commit -m "zkde.fi: frontend (agent page, landing, panels, connect)"
```

## Commit 4 – Narrative and judges doc

```bash
git add zkdefi/README.md zkdefi/docs/API.md zkdefi/docs/ARCHITECTURE.md zkdefi/docs/FOR_JUDGES.md zkdefi/docs/SETUP.md zkdefi/docs/nginx.conf.example
git commit -m "zkdefi: README, ARCHITECTURE, FOR_JUDGES, API, SETUP (three pillars, Garaga vs MIST)"
```

## Commit 5 – Submission and demo flow

```bash
git add zkdefi/docs/SUBMISSION.md zkdefi/docs/GIT_STAGING.md
git add zkdefi/.gitignore zkdefi/LICENSE
git commit -m "zkde.fi: SUBMISSION checklist, demo flow, video script"
```

---

Optional: if you prefer fewer commits, combine 1+2 as "contracts + backend", and 4+5 as "docs and submission".
