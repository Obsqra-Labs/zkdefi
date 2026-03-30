import { NextResponse } from "next/server";
import { ec, hash } from "starknet";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * POST /api/receiptos/claim
 * Body: { "wallet_address": "0x..." }
 *
 * Server-side claim: re-fetches vector, computes deterministic policy hash
 * from signal values, signs with attester key, reads next_receipt_id, then
 * submits issue_attested_receipt to the ReceiptRegistry on Starknet Sepolia.
 */

const BACKEND_URL = process.env.BACKEND_API_URL || "http://127.0.0.1:8003";
const STARKNET_RPC =
  process.env.RECEIPTOS_STARKNET_RPC ||
  "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/EvhYN6geLrdvbYHVRgPJ7";
const REGISTRY_ADDRESS =
  process.env.NEXT_PUBLIC_RECEIPTOS_CONTRACT ||
  "0x0544ef8cbf8bf1ac7987bc0d2bb211434d515fbe10bab65f36e0f761c79bbdff";

const ATTESTER_SK = process.env.RECEIPTOS_ATTESTER_SK ?? "";
const SUBMITTER_PK = process.env.RECEIPTOS_SUBMITTER_PK ?? "";
const STARKLI_ACCOUNT = process.env.STARKNET_ACCOUNT || "/root/.starkli-wallets/deployer/account.json";

/** Read next_receipt_id from the contract so we can return it with the tx. */
async function readNextReceiptId(): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `starkli call '${REGISTRY_ADDRESS}' 'get_next_receipt_id' --rpc '${STARKNET_RPC}' 2>&1`,
      { timeout: 15_000 },
    );
    // starkli call returns a hex or decimal value on a line
    const match = stdout.trim().match(/(0x[0-9a-fA-F]+|\d+)/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

export async function POST(request: Request) {
  if (!ATTESTER_SK || !SUBMITTER_PK) {
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
      `${BACKEND_URL}/api/v1/zkdefi/reputation/user/${address}`,
    );
    if (!scanRes.ok) throw new Error(`Reputation fetch failed: ${scanRes.status}`);
    const raw = await scanRes.json();

    // 2. Compute deterministic policy hash from signal values only.
    //    No timestamp — same signals always produce the same hash.
    //    The contract enforces replay protection via used_policy_hashes.
    const walletAgeDays = Number(raw.tenure_days ?? 0);
    const accountType = raw.tier_name ? 1 : 0;
    const txCount = Number(raw.transaction_count ?? 0);
    const gates = raw.gates ?? {};
    const protocolCount = Object.values(gates).filter(Boolean).length;
    const liquidationCount = Number(raw.failed_txns ?? 0);
    const bridgeInflow = Math.round(Number(raw.collateral_eth ?? 0) * 1e18);
    const hashInputs = [
      BigInt(walletAgeDays),
      BigInt(accountType),
      BigInt(txCount),
      BigInt(protocolCount),
      BigInt(liquidationCount),
      BigInt(bridgeInflow),
    ];
    const policyHash = hash.computePoseidonHashOnElements(hashInputs);

    // 3. Sign with attester key
    const signature = ec.starkCurve.sign(policyHash.toString(), ATTESTER_SK);
    const sigR = "0x" + signature.r.toString(16);
    const sigS = "0x" + signature.s.toString(16);

    // 4. Read next_receipt_id before submitting so we know what ID gets assigned
    const receiptId = await readNextReceiptId();

    // 5. Submit to chain via starkli (V3 transactions with l1_data_gas)
    const args = [
      "starkli", "invoke",
      REGISTRY_ADDRESS,
      "issue_attested_receipt",
      policyHash.toString(), sigR, sigS, "0x64",
      "--rpc", STARKNET_RPC,
      "--account", STARKLI_ACCOUNT,
      "--private-key", SUBMITTER_PK,
      "--watch",
    ];
    const cmd = args.map(a => `'${a}'`).join(" ");

    const { stdout, stderr } = await execAsync(cmd + " 2>&1", { timeout: 120_000 });
    const combined = stdout + "\n" + stderr;
    // Check for errors
    if (combined.includes("Error:") || combined.includes("error:")) {
      const errorLine = combined.split("\n").find(l => l.includes("Error:") || l.includes("error:")) ?? combined;
      throw new Error(errorLine.trim());
    }
    // starkli --watch prints the tx hash as a 0x... hex string
    const txMatch = combined.match(/(0x[0-9a-fA-F]{50,})/);
    const txHash = txMatch?.[1] ?? "";

    let portableReceipt: Record<string, unknown> | null = null;
    try {
      const registerRes = await fetch(`${BACKEND_URL}/api/v1/receipt_vault/passport/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          wallet_address: address,
          receipt_id: receiptId,
          tx_hash: txHash,
          policy_hash: policyHash.toString(),
          tier_name: raw.tier_name ?? null,
          reputation_score: raw.reputation_score ?? null,
          gates: raw.gates ?? {},
          scanned_at: raw.scanned_at ?? null,
          claimed_at: new Date().toISOString(),
          claim_kind: "passport",
        }),
      });
      if (registerRes.ok) {
        const payload = await registerRes.json();
        portableReceipt = {
          registry_receipt_id: payload.registry_receipt_id ?? null,
          cid: payload.cid ?? null,
          gateway_url: payload.gateway_url ?? null,
          ipfs_uri: payload.ipfs_uri ?? null,
        };
      } else {
        console.error("Receipt vault registration failed:", await registerRes.text());
      }
    } catch (registerErr) {
      console.error("Receipt vault registration error:", registerErr);
    }

    return NextResponse.json({
      receipt_id: receiptId,
      tx_hash: txHash,
      portable_receipt: portableReceipt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed";
    console.error("Claim error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
