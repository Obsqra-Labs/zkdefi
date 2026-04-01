# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
where version tags are used.

## [Unreleased]

### Changed

- Repository hygiene for open-source releases: ignore local build caches (VitePress, Foundry, TypeScript incremental), ignore ephemeral portfolio-monitor test state JSON under `backend/data/`, and stop tracking generated VitePress cache artifacts and `frontend/tsconfig.tsbuildinfo`.

### Repository

- Add contributor and release process docs: [CONTRIBUTING.md](CONTRIBUTING.md), [RELEASING.md](RELEASING.md).

---

When you cut a GitHub release, move items under `[Unreleased]` into a dated section such as `## [0.1.0] - 2026-03-31` and set the tag to match the version.
