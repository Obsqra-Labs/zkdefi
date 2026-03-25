/**
 * Phase 1 signal tests - fixture-backed, no real RPC calls.
 *
 * Each signal is tested with a MockRPC that returns preset values derived
 * from the verified heavy_defi fixture wallet (block 8109387).
 */
import { describe, it, expect } from "vitest";
import { getTransactionCount } from "../src/signals/tx-count";
import { getAccountType } from "../src/signals/account-type";
import { getWalletAge } from "../src/signals/wallet-age";
import { getBridgeInflow } from "../src/signals/bridge-inflow";
import { getProtocolBreadth } from "../src/signals/protocol-breadth";
import { getLiquidationCount } from "../src/signals/liquidations";
// Verified fixture values from account-class-hashes.json / test-wallets.json
const ARGENT_CLASS_HASH = "0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003";
const WALLET = "0x10eb4fb373daf7fc8985aa3185d9b1aebb4b2025111895d12668e5ca0447d76";
// ── Mock helpers ──────────────────────────────────────────────────────────────
/**
 * Minimal mock that implements only the StarknetRPC surface the signals use.
 * `getEventsImpl(filter)` returns an array of event pages for each call.
 * Calls are served in FIFO order; once exhausted each call yields an empty page.
 */
function mockRpc(opts) {
    let reqCount = 0;
    let eventsCallIndex = 0;
    return {
        getNonce: async (_addr) => {
            reqCount++;
            return opts.nonce ?? 0;
        },
        getClassHashAt: async (_addr) => {
            reqCount++;
            if (opts.classHash instanceof Error)
                throw opts.classHash;
            return opts.classHash ?? "0x0";
        },
        getBlockNumber: async () => {
            reqCount++;
            return opts.blockNumber ?? 100000;
        },
        async *getEvents(filter) {
            reqCount++;
            const callIdx = eventsCallIndex++;
            const pages = opts.getEventsImpl?.(filter, callIdx) ?? [[]];
            for (const page of pages)
                yield page;
        },
        getRequestCount: () => reqCount,
    };
}
// ── Signal: tx-count ──────────────────────────────────────────────────────────
describe("getTransactionCount", () => {
    it("returns the nonce as transaction_count", async () => {
        const rpc = mockRpc({ nonce: 202518 });
        const result = await getTransactionCount(rpc, WALLET);
        expect(result.value).toBe(202518);
        expect(result.source).toBe("starknet_getNonce");
    });
    it("returns 0 for a fresh wallet with nonce 0", async () => {
        const rpc = mockRpc({ nonce: 0 });
        const result = await getTransactionCount(rpc, WALLET);
        expect(result.value).toBe(0);
    });
});
// ── Signal: account-type ──────────────────────────────────────────────────────
describe("getAccountType", () => {
    it("identifies an Argent wallet by class hash", async () => {
        const rpc = mockRpc({ classHash: ARGENT_CLASS_HASH });
        const result = await getAccountType(rpc, WALLET);
        expect(result.value).toBe("argent");
    });
    it("returns 'unknown' for an unrecognised class hash", async () => {
        const rpc = mockRpc({ classHash: "0xdeadbeef" });
        const result = await getAccountType(rpc, WALLET);
        expect(result.value).toBe("unknown");
    });
    it("returns null when the RPC call fails (account not deployed)", async () => {
        const rpc = mockRpc({ classHash: new Error("Contract not found") });
        const result = await getAccountType(rpc, WALLET);
        expect(result.value).toBeNull();
    });
});
// ── Signal: wallet-age ────────────────────────────────────────────────────────
describe("getWalletAge", () => {
    it("calculates age from the earliest event block", async () => {
        // current block 1_000_000, first event at 806_400 → 193_600 blocks → 26 days
        const CURRENT = 1_000_000;
        const FIRST_BLOCK = 806_400; // 193_600 blocks back
        const EXPECTED_DAYS = Math.floor((CURRENT - FIRST_BLOCK) / 7200); // 26
        const rpc = mockRpc({
            blockNumber: CURRENT,
            getEventsImpl: () => [[{ block_number: FIRST_BLOCK }]],
        });
        const result = await getWalletAge(rpc, WALLET);
        expect(result.value).toBe(EXPECTED_DAYS);
        expect(result.source).toBe("first_invoke_tx");
    });
    it("returns null when no events are found in the lookback window", async () => {
        const rpc = mockRpc({
            blockNumber: 500_000,
            getEventsImpl: () => [[]], // empty page
        });
        const result = await getWalletAge(rpc, WALLET);
        expect(result.value).toBeNull();
        expect(result.source).toContain("not_found");
    });
    it("picks the earliest of multiple event blocks", async () => {
        const CURRENT = 1_000_000;
        const rpc = mockRpc({
            blockNumber: CURRENT,
            getEventsImpl: () => [
                // one page with two events; the older block should win
                [{ block_number: 950_000 }, { block_number: 800_000 }],
            ],
        });
        const result = await getWalletAge(rpc, WALLET);
        expect(result.value).toBe(Math.floor((CURRENT - 800_000) / 7200)); // 27
    });
});
// ── Signal: bridge-inflow ─────────────────────────────────────────────────────
describe("getBridgeInflow", () => {
    /**
     * StarkGate ETH deposit event layout (observed at block 7917715):
     *   keys: [selector, token_name, l1_sender, l2_recipient]
     *   data: [amount_low, amount_high]
     */
    it("detects ETH bridge deposit when keys[3] matches wallet", async () => {
        // Normalise wallet to match what bridge-inflow.ts normalizeAddress produces
        const walletBigInt = BigInt(WALLET);
        const walletHex = `0x${walletBigInt.toString(16)}`;
        const DEPOSIT_EVENT = {
            keys: [
                "0x282f521c69b2bc696552b9e141009d3c84f2df75e2e7b7716644d31e60f23b1",
                "0x455448", // "ETH"
                "0x914d4e2c65b5c23cc9f4a7faf416c40105371fa7", // L1 sender
                walletHex, // L2 recipient ← match
            ],
            data: ["0x2386f26fc10000", "0x0"], // 0.01 ETH
        };
        const rpc = mockRpc({
            blockNumber: 200_000,
            getEventsImpl: (_f, callIndex) => callIndex === 0 ? [[DEPOSIT_EVENT]] : [[]],
        });
        const result = await getBridgeInflow(rpc, WALLET);
        expect(result.value).not.toBeNull();
        expect(result.value.tokens["ETH"]).toBeDefined();
        expect(result.value.total_events).toBe(1);
    });
    it("returns null when no matching deposit events are found", async () => {
        const rpc = mockRpc({
            blockNumber: 200_000,
            getEventsImpl: () => [[]],
        });
        const result = await getBridgeInflow(rpc, WALLET);
        expect(result.value).toBeNull();
        expect(result.source).toBe("no_bridge_deposits_in_lookback");
    });
    it("ignores deposit events addressed to a different wallet", async () => {
        const OTHER_WALLET = "0x1111111111111111111111111111111111111111111111111111111111111111";
        const DEPOSIT_EVENT = {
            keys: [
                "0x282f521c69b2bc696552b9e141009d3c84f2df75e2e7b7716644d31e60f23b1",
                "0x455448",
                "0x914d4e2c65b5c23cc9f4a7faf416c40105371fa7",
                OTHER_WALLET, // different recipient
            ],
            data: ["0x2386f26fc10000", "0x0"],
        };
        const rpc = mockRpc({
            blockNumber: 200_000,
            getEventsImpl: (_f, callIndex) => callIndex === 0 ? [[DEPOSIT_EVENT]] : [[]],
        });
        const result = await getBridgeInflow(rpc, WALLET);
        expect(result.value).toBeNull();
    });
});
// ── Signal: protocol-breadth ──────────────────────────────────────────────────
describe("getProtocolBreadth", () => {
    const walletBigInt = BigInt(WALLET);
    const walletHex = `0x${walletBigInt.toString(16)}`;
    it("returns empty categories when no events match", async () => {
        const rpc = mockRpc({
            blockNumber: 100_000,
            getEventsImpl: () => [[]],
        });
        const result = await getProtocolBreadth(rpc, WALLET);
        expect(result.value.categories).toEqual([]);
        expect(result.value.count).toBe(0);
    });
    it("detects 'dex' category when wallet appears in Ekubo swap event data", async () => {
        // getProtocolBreadth makes 4 getEvents calls:
        //   0 = starkgate_eth_bridge (bridge)
        //   1 = ekubo_core (dex)
        //   2 = vesu_core supply (lending)
        //   3 = vesu_core liquidation (lending)
        const EKUBO_SWAP_EVENT = {
            data: [walletHex, "0xabc", "0x0", "0x0"], // wallet in data
        };
        const rpc = mockRpc({
            blockNumber: 100_000,
            getEventsImpl: (_f, callIndex) => callIndex === 1 ? [[EKUBO_SWAP_EVENT]] : [[]],
        });
        const result = await getProtocolBreadth(rpc, WALLET);
        expect(result.value.categories).toContain("dex");
        expect(result.value.count).toBeGreaterThanOrEqual(1);
    });
    it("detects 'lending' category when wallet appears in Vesu supply event data[0]", async () => {
        const VESU_SUPPLY_EVENT = {
            data: [walletHex, "0xasset", "0x100", "0x0"],
        };
        // callIndex 2 = vesu supply
        const rpc = mockRpc({
            blockNumber: 100_000,
            getEventsImpl: (_f, callIndex) => callIndex === 2 ? [[VESU_SUPPLY_EVENT]] : [[]],
        });
        const result = await getProtocolBreadth(rpc, WALLET);
        expect(result.value.categories).toContain("lending");
    });
});
// ── Signal: liquidations ──────────────────────────────────────────────────────
describe("getLiquidationCount", () => {
    const walletBigInt = BigInt(WALLET);
    const walletHex = `0x${walletBigInt.toString(16)}`;
    it("returns no_lending_activity when no Vesu events found", async () => {
        const rpc = mockRpc({
            blockNumber: 100_000,
            getEventsImpl: () => [[]],
        });
        const result = await getLiquidationCount(rpc, WALLET);
        expect(result.value.predicate).toBe("no_lending_activity");
        expect(result.value.liquidation_count).toBeNull();
    });
    it("returns has_lending_activity with count 0 when supply exists but no liquidations", async () => {
        // getLiquidationCount makes 2 getEvents calls:
        //   0 = vesu supply
        //   1 = vesu liquidation
        const VESU_SUPPLY_EVENT = {
            data: [walletHex, "0xasset", "0x100", "0x0"],
        };
        const rpc = mockRpc({
            blockNumber: 100_000,
            getEventsImpl: (_f, callIndex) => callIndex === 0 ? [[VESU_SUPPLY_EVENT]] : [[]],
        });
        const result = await getLiquidationCount(rpc, WALLET);
        expect(result.value.predicate).toBe("has_lending_activity");
        expect(result.value.liquidation_count).toBe(0);
    });
    it("counts liquidation events where wallet is the liquidated user (data[1])", async () => {
        // data layout: [liquidator, user, asset, amount]
        const LIQUIDATION_EVENT = {
            data: ["0xliquidator", walletHex, "0xasset", "0x100"],
        };
        const SUPPLY_EVENT = {
            data: [walletHex, "0xasset", "0x100", "0x0"],
        };
        const rpc = mockRpc({
            blockNumber: 100_000,
            getEventsImpl: (_f, callIndex) => {
                if (callIndex === 0)
                    return [[SUPPLY_EVENT]]; // supply call
                if (callIndex === 1)
                    return [[LIQUIDATION_EVENT]]; // liquidation call
                return [[]];
            },
        });
        const result = await getLiquidationCount(rpc, WALLET);
        expect(result.value.predicate).toBe("has_lending_activity");
        expect(result.value.liquidation_count).toBe(1);
    });
});
