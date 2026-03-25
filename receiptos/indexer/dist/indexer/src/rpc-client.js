import { RpcProvider } from "starknet";
export class StarknetRPC {
    provider;
    requestCount = 0;
    constructor(rpcUrl) {
        this.provider = new RpcProvider({ nodeUrl: rpcUrl });
    }
    async getNonce(address) {
        this.requestCount += 1;
        const nonceHex = await this.provider.getNonceForAddress(address);
        return Number.parseInt(nonceHex, 16);
    }
    async getClassHashAt(address) {
        this.requestCount += 1;
        return this.provider.getClassHashAt(address);
    }
    async getBlockNumber() {
        this.requestCount += 1;
        return this.provider.getBlockNumber();
    }
    async *getEvents(filter) {
        let continuationToken;
        do {
            this.requestCount += 1;
            const response = await this.withBackoff(() => this.provider.getEvents({
                ...filter,
                chunk_size: filter.chunk_size ?? 100,
                continuation_token: continuationToken,
            }));
            yield response.events;
            continuationToken = response.continuation_token;
        } while (continuationToken);
    }
    getRequestCount() {
        return this.requestCount;
    }
    async withBackoff(fn, maxRetries = 5) {
        for (let i = 0; i < maxRetries; i += 1) {
            try {
                return await fn();
            }
            catch (error) {
                const message = error instanceof Error ? error.message.toLowerCase() : "";
                const isRateLimited = message.includes("429") || message.includes("rate");
                if (!isRateLimited || i === maxRetries - 1) {
                    throw error;
                }
                const delayMs = 2 ** i * 1000;
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        throw new Error("Max retries exceeded");
    }
}
