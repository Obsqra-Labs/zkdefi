# Mainnet Footprint v0.1

This slice adds an isolated receiptos CLI for defensible Starknet mainnet footprint reporting.

Current command:

```bash
cd receiptos/indexer
npm run footprint -- --from-block 8000000 --to-block 8100000
```

Persist the latest full-history snapshot locally:

```bash
cd receiptos/indexer
npm run footprint:full
```

That writes JSON to `receiptos/indexer/out/mainnet-footprint.latest.json` while also printing the snapshot to stdout.

For larger private MIST windows, opt into chunked trace aggregation and persist per-chunk checkpoints:

```bash
cd receiptos/indexer
npx tsx src/footprint/cli.ts \
	--from-block 8433000 \
	--to-block 8433600 \
	--trace-chunk-size 100 \
	--trace-checkpoint-dir out/mist-trace-checkpoints
```

That keeps each chamber trace request bounded while writing one JSON checkpoint per processed chunk.

To resume a previous chunked run from its saved checkpoints and manifest:

```bash
cd receiptos/indexer
npx tsx src/footprint/cli.ts \
	--from-block 8433000 \
	--to-block 8433600 \
	--trace-chunk-size 100 \
	--trace-checkpoint-dir out/mist-trace-checkpoints \
	--trace-manifest-path out/mist-trace-checkpoints/manifest.json \
	--resume-trace-manifest
```

That reloads previously completed chunks from disk and only traces the missing chunks before emitting one full-window snapshot.

Chunked and resumed runs also emit compact progress lines to stderr in the form:

```text
[mist-trace 2/4] reused 8435100-8435149 calls=0
```

Stdout remains clean JSON, so the command is still pipeline-safe.

At the end of a chunked run, the CLI emits a final stderr summary line in the form:

```text
[mist-trace summary] traced=1 reused=3 chunks=4 calls=7 requests=42
```

What it computes today:

- Receipt Registry deployment status on mainnet
- Receipt Archive deployment status on mainnet
- MIST Chamber deployment status on mainnet
- Windowed `ReceiptIssued` event count
- Windowed `ReceiptConsumed` event count
- Windowed `CidAnchored` event count
- Unique receipt IDs touched in the requested block range
- Ekubo public route attribution counts from swap events
- Ekubo gross public swap delta totals in raw felt units (`gross_amount0_abs_raw`, `gross_amount1_abs_raw`)
- Bounded-window MIST chamber trace totals for `deposit`, `withdraw_no_zk`, and `seek_and_hide_no_zk`
- Bounded-window `handle_zkp` call counts
- Chunked private MIST aggregation for windows larger than the default trace bound when `--trace-chunk-size` is provided
- Normalized private MIST token totals with symbol, decimals, raw amount, and decimal display amount

What it does not claim yet:

- USD-normalized public execution notional
- Full-history private MIST notional across the entire chain without a dedicated trace index
- Cross-venue routed swap volume

Those broader notional metrics remain blocked until we add pool token mapping + USD normalization for public routes and an archival trace source for full-history private MIST.

Design constraints:

- Verified mainnet addresses only
- Windowed metrics only; no fake all-time totals from partial scans
- Event-derived counts instead of optimistic contract view calls
- Chamber notional comes from transaction traces because the deployed chamber ABI does not emit deposit or withdrawal events
- Large MIST windows must be split into explicit chunks; the CLI will not silently run an unbounded archival trace scan
- Token display normalization uses the local metadata mirror in `receiptos/config/mist-token-metadata.json`
- Resume support relies on a local manifest plus per-chunk checkpoint files; it does not yet provide distributed or remote checkpoint storage
- No dependency on the live backend or frontend runtime

Next extension points:

1. Add verified selector and amount parsing for the deployed MIST chamber.
2. Add pool token mapping + USD normalization on top of the Ekubo route attribution slice.
3. Persist periodic snapshots so the UI can show trend lines instead of one-off scans.
4. Replace chunked chamber trace scans with a dedicated archival trace index for full-history private-volume reporting.

Current operational note:

- A live full-history scan on 2026-04-04 returned 3 deployed contracts, 12 `ReceiptIssued`, 0 `ReceiptConsumed`, 12 `CidAnchored`, and 12 unique receipt IDs touched.
