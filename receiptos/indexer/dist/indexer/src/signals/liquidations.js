import contracts from "../../../config/mainnet-contracts.json";
import selectors from "../../../config/event-selectors.json";
export async function getLiquidationCount(rpc, wallet) {
    const latestBlock = await rpc.getBlockNumber();
    const lookbackBlocks = Number.parseInt(process.env.ACTIVITY_LOOKBACK_BLOCKS ?? "50000", 10);
    const fromBlock = Math.max(0, latestBlock - lookbackBlocks);
    const startRequests = rpc.getRequestCount();
    const walletNormalized = normalizeAddress(wallet);
    if (!walletNormalized) {
        return {
            value: {
                liquidation_count: null,
                predicate: "no_lending_activity",
            },
            source: "invalid_wallet_address",
            blockRange: [fromBlock, latestBlock],
            requestCount: rpc.getRequestCount() - startRequests,
        };
    }
    const vesuAddress = getAddress("vesu_core");
    const supplySelector = getSelector("vesu_core", "supply");
    const liquidationSelector = getSelector("vesu_core", "liquidation");
    const supplyEvents = await countWalletMatches(rpc, {
        address: vesuAddress,
        selector: supplySelector,
        fromBlock,
        toBlock: latestBlock,
        matchesWallet: (data) => normalizeAddress(data[0]) === walletNormalized,
    });
    const liquidationEvents = await countWalletMatches(rpc, {
        address: vesuAddress,
        selector: liquidationSelector,
        fromBlock,
        toBlock: latestBlock,
        // data layout: [liquidator, user, asset, amount]
        matchesWallet: (data) => normalizeAddress(data[1]) === walletNormalized,
    });
    const hasLendingActivity = supplyEvents > 0 || liquidationEvents > 0;
    return {
        value: {
            liquidation_count: hasLendingActivity ? liquidationEvents : null,
            predicate: hasLendingActivity ? "has_lending_activity" : "no_lending_activity",
        },
        source: "starknet_getEvents_vesu_lending",
        blockRange: [fromBlock, latestBlock],
        requestCount: rpc.getRequestCount() - startRequests,
    };
}
async function countWalletMatches(rpc, opts) {
    if (!opts.address) {
        return 0;
    }
    let count = 0;
    const keys = isHexFelt(opts.selector) ? [[opts.selector]] : undefined;
    for await (const page of rpc.getEvents({
        address: opts.address,
        from_block: { block_number: opts.fromBlock },
        to_block: { block_number: opts.toBlock },
        keys,
    })) {
        for (const event of page) {
            const data = getEventData(event);
            if (data.length > 0 && opts.matchesWallet(data)) {
                count += 1;
            }
        }
    }
    return count;
}
function getAddress(contractName) {
    const entry = contracts[contractName];
    return isHexFelt(entry?.address) ? entry.address : undefined;
}
function getSelector(contractName, eventName) {
    const contractEntry = selectors[contractName];
    const selector = contractEntry?.[eventName]?.selector;
    return isHexFelt(selector) ? selector : undefined;
}
function getEventData(event) {
    if (!event || typeof event !== "object") {
        return [];
    }
    const data = event.data;
    if (!Array.isArray(data)) {
        return [];
    }
    return data.filter((value) => typeof value === "string");
}
function normalizeAddress(value) {
    if (typeof value !== "string" || value.length === 0) {
        return null;
    }
    try {
        return `0x${BigInt(value).toString(16)}`;
    }
    catch {
        return null;
    }
}
function isHexFelt(value) {
    return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}
