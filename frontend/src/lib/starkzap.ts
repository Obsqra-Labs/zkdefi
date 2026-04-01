/**
 * Starkzap SDK integration.
 *
 * We use starkzap for DeFi primitives (swap quotes via AVNU, token ops)
 * while keeping @starknet-react/core for React wallet hooks.
 */
import { StarkZap } from "starkzap";

let _instance: StarkZap | null = null;

export function getStarkZap(): StarkZap {
  if (!_instance) {
    _instance = new StarkZap({ network: "mainnet" });
  }
  return _instance;
}
