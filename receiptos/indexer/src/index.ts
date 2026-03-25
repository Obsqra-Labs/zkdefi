import type { IndexerConfig, ReputationVector } from "./types";
import { StarknetRPC } from "./rpc-client";
import { getTransactionCount } from "./signals/tx-count";
import { getAccountType } from "./signals/account-type";
import { getWalletAge } from "./signals/wallet-age";
import { getBridgeInflow } from "./signals/bridge-inflow";
import { getProtocolBreadth } from "./signals/protocol-breadth";
import { getLiquidationCount } from "./signals/liquidations";

export async function computeVector(
  rpc: StarknetRPC,
  wallet: string,
  config: IndexerConfig
): Promise<ReputationVector> {
  const currentBlock = await rpc.getBlockNumber();

  // Fetch signals in parallel where possible
  const [txCountResult, accountTypeResult, walletAgeResult, bridgeInflowResult, protocolBreadthResult, liquidationResult] = 
    await Promise.all([
      getTransactionCount(rpc, wallet),
      getAccountType(rpc, wallet),
      getWalletAge(rpc, wallet),
      getBridgeInflow(rpc, wallet),
      getProtocolBreadth(rpc, wallet),
      getLiquidationCount(rpc, wallet),
    ]);

  return {
    version: "0.1",
    wallet,
    timestamp: Math.floor(Date.now() / 1000),
    chain: config.chain,
    signals: {
      wallet_age_days: walletAgeResult.value,
      wallet_age_source: walletAgeResult.value !== null ? "first_invoke_tx" : null,
      account_type: accountTypeResult.value,
      transaction_count: txCountResult.value,
      transaction_count_note: "outbound_only_getNonce",
      protocol_categories: protocolBreadthResult.value.categories,
      protocol_category_count: protocolBreadthResult.value.count,
      liquidation_count: liquidationResult.value.liquidation_count,
      liquidation_predicate: liquidationResult.value.predicate,
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
      known_gaps: "selector verification gaps remain; all implemented signals are best-effort in bounded lookback windows",
    },
  };
}
