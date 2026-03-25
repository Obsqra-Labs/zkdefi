import contracts from "../../../config/mainnet-contracts.json";
import selectors from "../../../config/event-selectors.json";
export async function getBridgeInflow(rpc, wallet) {
    const latestBlock = await rpc.getBlockNumber();
    const lookbackBlocks = Number.parseInt(process.env.BRIDGE_LOOKBACK_BLOCKS ?? "50000", 10);
    const fromBlock = Math.max(0, latestBlock - lookbackBlocks);
    const startRequests = rpc.getRequestCount();
    const walletNormalized = normalizeAddress(wallet);
    if (!walletNormalized) {
        return {
            value: null,
            source: "invalid_wallet_address",
            blockRange: [fromBlock, latestBlock],
            requestCount: rpc.getRequestCount() - startRequests,
        };
    }
    const bridgeConfigs = [
        {
            bridge: "starkgate_eth_bridge",
            contractAddress: getAddress("starkgate_eth_bridge"),
            depositSelector: getSelector("starkgate_eth_bridge", "deposit"),
        },
        {
            bridge: "starkgate_token_bridge",
            contractAddress: getAddress("starkgate_token_bridge"),
            depositSelector: undefined,
        },
    ];
    const tokenTotals = new Map();
    const tokenEventCounts = new Map();
    const bridgesIndexed = new Set();
    let totalEvents = 0;
    for (const bridgeConfig of bridgeConfigs) {
        if (!bridgeConfig.contractAddress) {
            continue;
        }
        const keyFilter = isHexFelt(bridgeConfig.depositSelector) ? [[bridgeConfig.depositSelector]] : undefined;
        for await (const page of rpc.getEvents({
            address: bridgeConfig.contractAddress,
            from_block: { block_number: fromBlock },
            to_block: { block_number: latestBlock },
            keys: keyFilter,
        })) {
            for (const event of page) {
                const parsed = parseBridgeDepositEvent(event, walletNormalized);
                if (!parsed) {
                    continue;
                }
                const tokenSymbol = bridgeConfig.bridge === "starkgate_eth_bridge" ? "ETH" : "BRIDGED_TOKEN";
                tokenTotals.set(tokenSymbol, (tokenTotals.get(tokenSymbol) ?? 0n) + parsed.amount);
                tokenEventCounts.set(tokenSymbol, (tokenEventCounts.get(tokenSymbol) ?? 0) + 1);
                bridgesIndexed.add(bridgeConfig.bridge);
                totalEvents += 1;
            }
        }
    }
    if (totalEvents === 0) {
        return {
            value: null,
            source: "no_bridge_deposits_in_lookback",
            blockRange: [fromBlock, latestBlock],
            requestCount: rpc.getRequestCount() - startRequests,
        };
    }
    const inflow = {
        tokens: Object.fromEntries(Array.from(tokenTotals.entries()).map(([token, total]) => [token, {
                raw_amount: total.toString(),
                decimals: 18,
                event_count: tokenEventCounts.get(token) ?? 0,
            }])),
        total_events: totalEvents,
        bridges_indexed: Array.from(bridgesIndexed),
    };
    return {
        value: inflow,
        source: "starknet_getEvents_bridge_deposits",
        blockRange: [fromBlock, latestBlock],
        requestCount: rpc.getRequestCount() - startRequests,
    };
}
function getAddress(contractName) {
    const entry = contracts[contractName];
    const address = entry?.address;
    return isHexFelt(address) ? address : undefined;
}
function getSelector(contractName, eventName) {
    const contractEntry = selectors[contractName];
    const selector = contractEntry?.[eventName]?.selector;
    return isHexFelt(selector) ? selector : undefined;
}
function parseBridgeDepositEvent(event, walletNormalized) {
    if (!event || typeof event !== "object")
        return null;
    const ev = event;
    const keys = ev.keys;
    const data = ev.data;
    // StarkGate ETH bridge deposit event layout:
    //   keys: [selector, token_name, l1_sender, l2_recipient]
    //   data: [amount_low, amount_high]
    if (!Array.isArray(keys) || keys.length < 4)
        return null;
    if (!Array.isArray(data) || data.length < 1)
        return null;
    const recipientNormalized = normalizeAddress(keys[3]);
    if (!recipientNormalized || recipientNormalized !== walletNormalized)
        return null;
    const amountLow = parseBigIntFelt(data[0]);
    if (amountLow === null)
        return null;
    const amountHigh = data.length >= 2 ? (parseBigIntFelt(data[1]) ?? 0n) : 0n;
    const amount = amountLow + amountHigh * (2n ** 128n);
    if (amount < 0n)
        return null;
    return { amount };
}
function normalizeAddress(value) {
    const asBigInt = parseBigIntFelt(value);
    return asBigInt === null ? null : `0x${asBigInt.toString(16)}`;
}
function parseBigIntFelt(value) {
    if (typeof value !== "string" || value.length === 0) {
        return null;
    }
    try {
        return value.startsWith("0x") || value.startsWith("0X") ? BigInt(value) : BigInt(value);
    }
    catch {
        return null;
    }
}
function isHexFelt(value) {
    return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}
