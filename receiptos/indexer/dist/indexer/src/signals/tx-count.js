export async function getTransactionCount(rpc, wallet) {
    const nonce = await rpc.getNonce(wallet);
    return {
        value: nonce,
        source: "starknet_getNonce",
        blockRange: [0, 0],
        requestCount: 1,
    };
}
