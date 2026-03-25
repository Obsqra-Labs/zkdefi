import classHashes from "../../../config/account-class-hashes.json";
export async function getAccountType(rpc, wallet) {
    const classHash = await rpc.getClassHashAt(wallet);
    const knownClassHashes = classHashes;
    let value = "unknown";
    if (knownClassHashes.argent.includes(classHash))
        value = "argent";
    else if (knownClassHashes.braavos.includes(classHash))
        value = "braavos";
    else if (knownClassHashes.openzeppelin.includes(classHash))
        value = "openzeppelin";
    return {
        value,
        source: "starknet_getClassHashAt",
        blockRange: [0, 0],
        requestCount: 1,
    };
}
