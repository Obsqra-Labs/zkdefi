import { GasMode } from "@/types/ekubo";

export interface StarkzapExecutionResult {
  transaction_hash: string;
  provider: "starkzap";
}

export interface StarkzapExecutionInput {
  calls: unknown;
  gasMode: GasMode;
}

export interface StarkzapAdapter {
  available: boolean;
  walletProvider: string;
  paymasterAvailable: boolean;
  controllerAvailable: boolean;
  reason?: string;
  executeWithPaymaster?: (input: StarkzapExecutionInput) => Promise<StarkzapExecutionResult>;
}
