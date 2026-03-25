import { NextResponse } from "next/server";
import { RpcProvider, Account, Contract, ec, hash } from "starknet";

/**
 * POST /api/receiptos/claim
 * Body: { "wallet_address": "0x..." }
 *
 * Server-side claim: re-fetches vector, signs policy hash, submits
 * issue_attested_receipt to the ReceiptRegistry on Starknet Sepolia.
 */

const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:8003";
const STARKNET_RPC =
  process.env.NEXT_PUBLIC_STARKNET_RPC ||
  "https://free-rpc.nethermind.io/sepolia-juno";
const REGISTRY_ADDRESS =
  process.env.NEXT_PUBLIC_RECEIPTOS_CONTRACT ||
  "0x0544ef8cbf8bf1ac7987bc0d2bb211434d515fbe10bab65f36e0f761c79bbdff";

const ATTESTER_SK = process.env.RECEIPTOS_ATTESTER_SK ?? "";
const SUBMITTER_ADDRESS = process.env.RECEIPTOS_SUBMITTER_ADDRESS ?? "";
const SUBMITTER_PK = process.env.RECEIPTOS_SUBMITTER_PK ?? "";

const REGISTRY_ABI = [
  {
    name: "issue_attested_receipt",
    type: "function",
    inputs: [
      { name: "policy_hash", type: "core::felt252" },
      { name: "sig_r", type: "core::felt252" },
      { name: "sig_s", type: "core::felt252" },
      { name: "weight", type: "core::integer::u128" },
    ],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "external",
  },
  {
    name: "get_next_receipt_id",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "view",
  },
] as const;

export async function POST(request: Request) {
  if (!ATTESTER_SK || !SUBMITTER_ADDRESS || !SUBMITTER_PK) {
    return NextResponse.json(
      { error: "Claim service not configured (missing server env)" },
      { status: 503 }
    );
  }

  let body: { wallet_address?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const address = body.wallet_address;
  if (!address || !/^0x[0-9a-fA-F]+$/.test(address)) {
    return NextResponse.json(
      { error: "Missing or invalid wallet_address" },
      { status: 400 }
    );
  }

  try {
    // 1. Fetch reputation from backend
    const scanRes = await fetch(
      `${BACKEND_URL}/api/v1/zkdefi/reputation/scan/${address}`,
      { method: "POST", headers: { "Content-Type": "application/json" } }
    );
    if (!scanRes.ok) throw new Error(`Reputation scan failed: ${scanRes.status}`);
    const raw = await scanRes.json();

    // 2. Compute deterministic policy hash from signal values
    const signals = Array.isArray(raw.signals) ? raw.signals : [];
    const nonce = Number(raw.nonce ?? 0);
    const protocolCount = Number(raw.protocol_count ?? 0);
    const hashInputs = [
      BigInt(findVal(signals, "wallet_age_days")),
      BigInt(raw.account_type ? 1 : 0),
      BigInt(nonce),
      BigInt(protocolCount),
      BigInt(findVal(signals, "liquidation_count")),
      BigInt(findVal(signals, "bridge_inflow")),
    ];
    const policyHash = hash.computePoseidonHashOnElements(hashInputs);

    // 3. Sign with attester key
    const signature = ec.starkCurve.sign(policyHash.toString(), ATTESTER_SK);

    // 4. Submit to chain
    const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });
    const account = new Account(provider, SUBMITTER_ADDRESS, SUBMITTER_PK);
    const contract = new Contract(REGISTRY_ABI as any, REGISTRY_ADDRESS, account);

    const tx = await contract.invoke("issue_attested_receipt", [
      policyHash,
      "0x" + signature.r.toString(16),
      "0x" + signature.s.toString(16),
      100, // weight
    ]);

    await provider.waitForTransaction(tx.transaction_hash);

    const nextId = await contract.call("get_next_receipt_id");
    const receiptId = Number(nextId) - 1;

    return NextResponse.json({
      receipt_id: receiptId,
      tx_hash: tx.transaction_hash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed";
    console.error("Claim error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function findVal(signals: Array<Record<string, unknown>>, key: string): number {
  const match = signals.find(
    (s) => s.signal === key || s.label === key || s.category === key
  );
  if (!match) return 0;
  const v = Number(match.value);
  return Number.isFinite(v) ? v : 0;
}
