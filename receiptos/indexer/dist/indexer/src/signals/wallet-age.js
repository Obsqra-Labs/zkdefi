export async function getWalletAge(rpc, wallet) {
    const latestBlock = await rpc.getBlockNumber();
    const lookbackBlocks = Number.parseInt(process.env.WALLET_AGE_LOOKBACK_BLOCKS ?? "200000", 10);
    const fromBlock = Math.max(0, latestBlock - lookbackBlocks);
    const startRequests = rpc.getRequestCount();
    let firstSeenBlock = null;
    for await (const page of rpc.getEvents({
        address: wallet,
        from_block: { block_number: fromBlock },
        to_block: { block_number: latestBlock },
    })) {
        for (const event of page) {
            const blockNumber = getEventBlockNumber(event);
            if (blockNumber !== null && (firstSeenBlock === null || blockNumber < firstSeenBlock)) {
                firstSeenBlock = blockNumber;
            }
        }
    }
    if (firstSeenBlock === null) {
        return {
            value: null,
            source: "first_invoke_tx_not_found_in_lookback",
            blockRange: [fromBlock, latestBlock],
            requestCount: rpc.getRequestCount() - startRequests,
        };
    }
    // Starknet mainnet averages roughly 12s/block (~7200 blocks/day).
    const walletAgeDays = Math.max(0, Math.floor((latestBlock - firstSeenBlock) / 7200));
    return {
        value: walletAgeDays,
        source: "first_invoke_tx",
        blockRange: [firstSeenBlock, latestBlock],
        requestCount: rpc.getRequestCount() - startRequests,
    };
}
function getEventBlockNumber(event) {
    if (!event || typeof event !== "object") {
        return null;
    }
    const maybeBlock = event.block_number;
    return typeof maybeBlock === "number" ? maybeBlock : null;
}
