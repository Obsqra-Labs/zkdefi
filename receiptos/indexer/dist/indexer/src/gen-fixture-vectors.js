/**
 * Generates ReputationVector output for all 10 fixture wallets.
 * Writes one JSON file per wallet to test/fixtures/vector-outputs/.
 * Also emits a benchmark summary to vector-outputs/_benchmark.json.
 *
 * Usage: npx tsx src/gen-fixture-vectors.ts
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { StarknetRPC } from "./rpc-client";
import { computeVector } from "./index";
import wallets from "../../indexer/test/fixtures/test-wallets.json";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, "../test/fixtures/vector-outputs");
const config = {
    chain: "starknet-mainnet",
    verifiedProtocols: ["starkgate_eth_bridge", "ekubo_core", "vesu_core"],
    attemptedProtocols: ["starkgate_eth_bridge", "starkgate_token_bridge", "ekubo_core", "vesu_core"],
};
async function main() {
    if (!existsSync(OUT_DIR))
        mkdirSync(OUT_DIR, { recursive: true });
    const rpc = new StarknetRPC(process.env.STARKNET_RPC_URL ?? "https://rpc.starknet.lava.build");
    const benchmark = [];
    for (const wallet of wallets) {
        const { address, profile } = wallet;
        const requestsBefore = rpc.getRequestCount();
        const t0 = Date.now();
        let error = null;
        try {
            const vector = await computeVector(rpc, address, config);
            const wallMs = Date.now() - t0;
            const requests = rpc.getRequestCount() - requestsBefore;
            const outFile = resolve(OUT_DIR, `${profile}.json`);
            writeFileSync(outFile, JSON.stringify(vector, null, 2));
            console.log(`[${profile}] OK  ${wallMs}ms  ${requests} reqs  -> ${outFile}`);
            benchmark.push({ profile, address, wall_ms: wallMs, rpc_requests: requests, error: null });
        }
        catch (err) {
            const wallMs = Date.now() - t0;
            const requests = rpc.getRequestCount() - requestsBefore;
            error = err instanceof Error ? err.message : String(err);
            console.error(`[${profile}] ERR ${wallMs}ms  ${requests} reqs  -> ${error}`);
            benchmark.push({ profile, address, wall_ms: wallMs, rpc_requests: requests, error });
        }
    }
    // Write benchmark summary
    const total_ms = benchmark.reduce((s, r) => s + r.wall_ms, 0);
    const total_requests = benchmark.reduce((s, r) => s + r.rpc_requests, 0);
    const max_ms = Math.max(...benchmark.map((r) => r.wall_ms));
    const failures = benchmark.filter((r) => r.error !== null).length;
    const summary = {
        generated_at: new Date().toISOString(),
        total_wallets: benchmark.length,
        failures,
        total_ms,
        max_wall_ms: max_ms,
        total_rpc_requests: total_requests,
        rows: benchmark,
    };
    writeFileSync(resolve(OUT_DIR, "_benchmark.json"), JSON.stringify(summary, null, 2));
    console.log(`\nDone. ${benchmark.length - failures}/${benchmark.length} OK | total=${total_ms}ms max=${max_ms}ms rpc_total=${total_requests}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
