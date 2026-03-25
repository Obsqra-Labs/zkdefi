export async function computeVector(rpc, wallet, config) {
    const currentBlock = await rpc.getBlockNumber();
    return {
        version: "0.1",
        wallet,
        timestamp: Math.floor(Date.now() / 1000),
        chain: config.chain,
        signals: {
            wallet_age_days: null,
            wallet_age_source: null,
            account_type: "unknown",
            transaction_count: 0,
            transaction_count_note: "outbound_only_getNonce",
            protocol_categories: [],
            protocol_category_count: 0,
            liquidation_count: null,
            liquidation_predicate: "no_lending_activity",
            bridge_inflow: null,
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
            protocols_attempted_no_events: config.attemptedProtocols.filter((name) => !config.verifiedProtocols.includes(name)),
            blocks_scanned_from: 0,
            blocks_scanned_to: currentBlock,
            indexer_version: "0.1.0",
            known_gaps: "Phase 0 unresolved contracts/selectors pending",
        },
    };
}
