export async function getWalletAge(_rpc, _wallet) {
    return {
        value: null,
        source: "unresolved_wallet_age_strategy",
        blockRange: [0, 0],
        requestCount: 0,
    };
}
