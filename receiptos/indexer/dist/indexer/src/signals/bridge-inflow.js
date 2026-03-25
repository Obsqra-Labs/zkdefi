export async function getBridgeInflow(_rpc, _wallet) {
    return {
        value: null,
        source: "unresolved_bridge_contracts",
        blockRange: [0, 0],
        requestCount: 0,
    };
}
