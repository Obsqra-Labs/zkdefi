import { StarknetRPC } from "./rpc-client";
import { computeVector } from "./index";
import type { IndexerConfig } from "./types";
import testWallets from "../../indexer/test/fixtures/test-wallets.json";

(async () => {
  const RPC_URL = process.env.STARKNET_RPC_URL || "https://rpc.starknet.lava.build";
  const rpc = new StarknetRPC(RPC_URL);

  const config: IndexerConfig = {
    chain: "starknet-mainnet",
    verifiedProtocols: ["starkgate_eth_bridge", "ekubo_core", "vesu_core"],
    attemptedProtocols: ["starkgate_token_bridge", "nostra_lending", "endur_staking", "mist_cash"],
  };

  // Test with first real wallet from fixture
  const testWallet = testWallets[0];
  console.log(`\n🔍 Testing indexer with wallet: ${testWallet.address}`);
  console.log(`   Profile: ${testWallet.profile}`);
  console.log(`   RPC: ${RPC_URL}\n`);

  try {
    const vector = await computeVector(rpc, testWallet.address, config);
    console.log("✅ Reputation vector computed successfully:");
    console.log(JSON.stringify(vector, null, 2));
  } catch (error) {
    console.error("❌ Error computing vector:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
