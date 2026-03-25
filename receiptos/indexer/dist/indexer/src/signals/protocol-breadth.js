export async function getProtocolBreadth(_rpc, _wallet) {
    return {
        value: { categories: [], count: 0 },
        source: "unresolved_protocol_mapping",
        blockRange: [0, 0],
        requestCount: 0,
    };
}
