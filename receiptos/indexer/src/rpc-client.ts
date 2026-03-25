import { RpcProvider } from "starknet";

export interface EventFilterLike {
  address?: string;
  from_block?: { block_number: number };
  to_block?: { block_number: number };
  keys?: string[][];
  chunk_size?: number;
  continuation_token?: string;
}

interface EventsResponseLike {
  events: unknown[];
  continuation_token?: string;
}

export class StarknetRPC {
  private provider: RpcProvider;
  private requestCount = 0;

  constructor(rpcUrl: string) {
    this.provider = new RpcProvider({ nodeUrl: rpcUrl });
  }

  async getNonce(address: string): Promise<number> {
    this.requestCount += 1;
    const nonceHex = await this.provider.getNonceForAddress(address);
    return Number.parseInt(nonceHex, 16);
  }

  async getClassHashAt(address: string): Promise<string> {
    this.requestCount += 1;
    return this.provider.getClassHashAt(address);
  }

  async getBlockNumber(): Promise<number> {
    this.requestCount += 1;
    return this.provider.getBlockNumber();
  }

  async *getEvents(filter: EventFilterLike): AsyncGenerator<unknown[]> {
    let continuationToken: string | undefined;

    do {
      this.requestCount += 1;
      const response = await this.withBackoff<EventsResponseLike>(() => this.provider.getEvents({
        ...filter,
        chunk_size: filter.chunk_size ?? 100,
        continuation_token: continuationToken,
      }) as Promise<EventsResponseLike>);

      yield response.events;
      continuationToken = response.continuation_token;
    } while (continuationToken);
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  private async withBackoff<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
    for (let i = 0; i < maxRetries; i += 1) {
      try {
        return await fn();
      } catch (error) {
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
