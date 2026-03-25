import { NextResponse } from "next/server";
import { RpcProvider, Account, Contract, ec, hash } from "starknet";
import { fetchVector } from "@/lib/vector";
import { RECEIPT_REGISTRY_ADDRESS, STARKNET_RPC, RECEIPT_REGISTRY_ABI } from "@/lib/contract";

/**
 * POST /api/claim
 * Body: { "wallet_address": "0x..." }
 *
 * Server-side claim flow (spec Step 3.5):
 * 1. Re-fetch the vector for the wallet.
 * 2. Compute the policy hash (same deterministic hash as the attester).
 * 3. Sign with the attester private key (server-side only).
 * 4. Submit issue_attested_receipt to the ReceiptRegistry on Sepolia.
 * 5. Return receipt_id + tx_hash.
 */

const ATTESTER_SK = process.env.RECEIPTOS_ATTESTER_SK ?? "";
const SUBMITTER_ADDRESS = process.env.RECEIPTOS_SUBMITTER_ADDRESS ?? "";
const SUBMITTER_PK = process.env.RECEIPTOS_SUBMITTER_PK ?? "";

export async function POST(request: Request) {
  // Validate env
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
    // 1. Re-fetch vector server-side
    const vector = await fetchVector(address);

    // 2. Compute deterministic policy hash from signals
    const signalValues = vector.signals.map((s) =>
      s.value != null ? s.value.toString() : "null"
    );
    const policyHash = hash.computePoseidonHashOnElements(
      signalValues.map((v) => BigInt(v === "null" ? 0 : v))
    );

    // 3. Sign with attester key
    const signature = ec.starkCurve.sign(policyHash.toString(), ATTESTER_SK);

    // 4. Submit to chain
    const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });
    const account = new Account(provider, SUBMITTER_ADDRESS, SUBMITTER_PK);

    const contract = new Contract(
      RECEIPT_REGISTRY_ABI as any,
      RECEIPT_REGISTRY_ADDRESS,
      account
    );

    // Weight = 100 for now (default claim weight)
    const weight = 100;
    const tx = await contract.invoke("issue_attested_receipt", [
      policyHash,
      "0x" + signature.r.toString(16),
      "0x" + signature.s.toString(16),
      weight,
    ]);

    await provider.waitForTransaction(tx.transaction_hash);

    // Read new next_receipt_id to get the issued ID
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
