import type { IndexerConfig, ReputationVector } from "./types";
import { StarknetRPC } from "./rpc-client";
import { getTransactionCount } from "./signals/tx-count";
import { getAccountType } from "./signals/account-type";
import { getWalletAge } from "./signals/wallet-age";
import { getBridgeInflow } from "./signals/bridge-inflow";

export async function computeVector(
  rpc: StarknetRPC,
  wallet: string,
  config: IndexerConfig
): Promise<ReputationVector> {
  const currentBlock = await rpc.getBlockNumber();

  // Fetch signals in parallel where possible
  const [txCountResult, accountTypeResult, walletAgeResult, bridgeInflowResult] = 
    await Promise.all([
      getTransactionCount(rpc, wallet),
      getAccountType(rpc, wallet),
      getWalletAge(rpc, wallet),
      getBridgeInflow(rpc, wallet),
    ]);

  return {
    version: "0.1",
    wallet,
    timestamp: Math.floor(Date.now() / 1000),
    chain: config.chain,
    signals: {
      wallet_age_days: walletAgeResult.value,
      wallet_age_source: walletAgeResult.source !== "unresolved_wallet_age_strategy" ? "deploy_account_tx" : null,
      account_type: accountTypeResult.value,
      transaction_count: txCountResult.value,
      transaction_count_note: "outbound_only_getNonce",
      protocol_categories: [],
      protocol_category_count: 0,
      liquidation_count: null,
      liquidation_predicate: "no_lending_activity",
      bridge_inflow: bridgeInflowResult.value,
    },
    privacy_behavior_profile: null,
    deferred_signals: [
      "transparency_willingness",
      "capital_origin_legibility",
      "privacy_tool_pattern",
      "cross_protocol_consistency",
      "behavioral_continuity"
    ],
    coverage: {
      protocols_indexed: config.verifiedProtocols,
      protocols_attempted_no_events: config.attemptedProtocols.filter(
        (name) => !config.verifiedProtocols.includes(name)
      ),
      blocks_scanned_from: 0,
      blocks_scanned_to: currentBlock,
      indexer_version: "0.1.0",
      known_gaps: "wallet-age, bridge-inflow, liquidations, protocol-breadth pending v0.2",
    },
  };
}
