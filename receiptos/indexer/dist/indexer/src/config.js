import contractConfig from "../../config/mainnet-contracts.json";
import selectorConfig from "../../config/event-selectors.json";
import classHashConfig from "../../config/account-class-hashes.json";
export function loadReceiptOsConfig() {
    return {
        contracts: contractConfig,
        selectors: selectorConfig,
        classHashes: classHashConfig,
    };
}
