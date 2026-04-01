# Releasing zkde.fi (GitHub)

Checklist for maintainers when publishing a version on [Obsqra-Labs/zkdefi](https://github.com/Obsqra-Labs/zkdefi).

## Pre-release

1. **Merge** intended work to `main` with CI green.
2. **Update [CHANGELOG.md](CHANGELOG.md):** move `[Unreleased]` items under a new section `## [X.Y.Z] - YYYY-MM-DD`.
3. **Version tags:** Use semantic versioning for the Git tag (e.g. `v0.2.0`). Align any user-facing version strings in docs or UI only if you already maintain them in-repo.
4. **Scan for leaks:** No private keys, RPC URLs with embedded secrets, or production `.env` in the tree. Large binaries belong in release assets or external storage, not the default branch (see `.gitignore` for `*.zkey`, `*.ptau`, etc.).

## Create the GitHub release

1. **Tag** the commit on `main`:

   ```bash
   git pull origin main
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

2. On GitHub: **Releases → Draft a new release**, choose the tag, title `vX.Y.Z`, paste the changelog section for that version into the description.
3. **Attach artifacts** only if this release ships binaries (proving keys, packaged demos). Prefer documenting download URLs in the release notes.

## After release

- Add a new empty `## [Unreleased]` at the top of `CHANGELOG.md` on `main` for the next cycle.
