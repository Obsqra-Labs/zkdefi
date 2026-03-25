import classHashConfig from "../../../config/account-class-hashes.json";
export async function getAccountType(rpc, wallet) {
    const classHash = await rpc.getClassHashAt(wallet);
    const config = classHashConfig;
    let value = "unknown";
    if (config.argent?.class_hash === classHash)
        value = "argent";
    else if (config.braavos?.class_hash === classHash)
        value = "braavos";
    else if (config.openzeppelin?.class_hash === classHash && config.openzeppelin?.class_hash !== "unresolved")
        value = "openzeppelin";
    return {
        value,
        source: "starknet_getClassHashAt + account-class-hashes.json",
        blockRange: [0, 0],
        requestCount: 1,
    };
}
