# Portable Passport v1 (PPP)

This folder defines the portable passport contract used across profile, passport, and execution surfaces.

## Contents
- schema/portable-passport-v1.schema.json: canonical JSON schema
- examples/minimal.json: minimal valid payload
- examples/public-card.json: redacted public payload

## Design Rules
- One canonical payload for all trust surfaces.
- Claims must be machine-readable and proof-referenceable.
- Privacy defaults to selective disclosure.
- Public payloads must not expose sensitive balances or strategy-level detail.

## Verification
Consumers should validate payload version and schema first, then evaluate claims and provenance.
