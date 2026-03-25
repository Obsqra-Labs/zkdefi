export async function getLiquidationCount(_rpc, _wallet) {
    return {
        value: {
            liquidation_count: null,
            predicate: "no_lending_activity",
        },
        source: "unresolved_lending_events",
        blockRange: [0, 0],
        requestCount: 0,
    };
}
