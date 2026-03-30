#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hash, ec } from "starknet";

const DEFAULT_REGISTRY_ADDRESS = "0x0544ef8cbf8bf1ac7987bc0d2bb211434d515fbe10bab65f36e0f761c79bbdff";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function stringToFelts(text) {
  const bytes = Buffer.from(text, "utf8");
  if (!bytes.length) return ["0x0"];
  const felts = [];
  for (let i = 0; i < bytes.length; i += 31) {
    const chunk = bytes.subarray(i, i + 31);
    const hex = chunk.toString("hex") || "00";
    felts.push(`0x${BigInt(`0x${hex}`).toString(16)}`);
  }
  return felts;
}

function poseidonHashText(text) {
  return hash.computePoseidonHashOnElements(stringToFelts(text));
}

function runStarkli(args) {
  const result = spawnSync("starkli", args, {
    encoding: "utf8",
    timeout: 180_000,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.status !== 0) {
    fail(output || "starkli command failed");
  }
  return output;
}

function extractFirstValue(output) {
  const match = output.match(/(0x[0-9a-fA-F]+|\d+)/);
  if (!match) fail(`Unable to parse starkli output: ${output}`);
  return match[1];
}

function extractTxHash(output) {
  const match = output.match(/0x[0-9a-fA-F]{64}/);
  if (!match) fail(`Unable to find tx hash in starkli output: ${output}`);
  return match[0];
}

function cmdHashString(args) {
  const text = String(args.text ?? "");
  if (!text) fail("--text is required");
  process.stdout.write(
    JSON.stringify({
      hash: poseidonHashText(text),
      felt_count: stringToFelts(text).length,
    }),
  );
}

function cmdHashFile(args) {
  const path = String(args.path ?? "");
  if (!path) fail("--path is required");
  const content = readFileSync(path, "utf8");
  process.stdout.write(
    JSON.stringify({
      hash: poseidonHashText(content),
      felt_count: stringToFelts(content).length,
      canonical_json: false,
    }),
  );
}

function cmdHashJsonFile(args) {
  const path = String(args.path ?? "");
  if (!path) fail("--path is required");
  const payload = JSON.parse(readFileSync(path, "utf8"));
  const canonical = canonicalJson(payload);
  process.stdout.write(
    JSON.stringify({
      hash: poseidonHashText(canonical),
      felt_count: stringToFelts(canonical).length,
      canonical_json: true,
    }),
  );
}

function cmdIssueRegistry(args) {
  const policyHash = String(args["policy-hash"] ?? "");
  const weight = String(args.weight ?? "");
  const registry = String(
    args.registry
      ?? process.env.RECEIPTOS_REGISTRY_ADDRESS
      ?? process.env.RECEIPT_REGISTRY_ADDRESS
      ?? process.env.NEXT_PUBLIC_RECEIPTOS_CONTRACT
      ?? DEFAULT_REGISTRY_ADDRESS,
  );
  const rpc = String(args.rpc ?? process.env.RECEIPTOS_STARKNET_RPC ?? process.env.STARKNET_RPC_URL ?? "");
  const account = String(args.account ?? process.env.STARKNET_ACCOUNT ?? "");
  const submitterPk = String(args["submitter-pk"] ?? process.env.RECEIPTOS_SUBMITTER_PK ?? "");
  const attesterSk = String(args["attester-sk"] ?? process.env.RECEIPTOS_ATTESTER_SK ?? "");
  if (!policyHash || !weight || !registry || !rpc || !account || !submitterPk || !attesterSk) {
    fail("Missing required issue-registry args or env");
  }

  const signature = ec.starkCurve.sign(policyHash, attesterSk);
  const sigR = `0x${signature.r.toString(16)}`;
  const sigS = `0x${signature.s.toString(16)}`;

  const nextOutput = runStarkli(["call", registry, "get_next_receipt_id", "--rpc", rpc]);
  const receiptId = extractFirstValue(nextOutput);
  const invokeOutput = runStarkli([
    "invoke",
    registry,
    "issue_attested_receipt",
    policyHash,
    sigR,
    sigS,
    weight,
    "--rpc",
    rpc,
    "--account",
    account,
    "--private-key",
    submitterPk,
    "--watch",
  ]);

  process.stdout.write(
    JSON.stringify({
      receipt_id: receiptId,
      tx_hash: extractTxHash(invokeOutput),
      signature: { r: sigR, s: sigS },
    }),
  );
}

function cmdAnchorCid(args) {
  const archive = String(args.archive ?? process.env.RECEIPTOS_ARCHIVE_ADDRESS ?? "");
  const rpc = String(args.rpc ?? process.env.RECEIPTOS_STARKNET_RPC ?? process.env.STARKNET_RPC_URL ?? "");
  const account = String(args.account ?? process.env.STARKNET_ACCOUNT ?? "");
  const submitterPk = String(args["submitter-pk"] ?? process.env.RECEIPTOS_SUBMITTER_PK ?? "");
  const receiptId = String(args["receipt-id"] ?? "");
  const cidHash = String(args["cid-hash"] ?? "");
  if (!archive || !rpc || !account || !submitterPk || !receiptId || !cidHash) {
    fail("Missing required anchor-cid args or env");
  }

  const invokeOutput = runStarkli([
    "invoke",
    archive,
    "anchor_cid",
    receiptId,
    cidHash,
    "--rpc",
    rpc,
    "--account",
    account,
    "--private-key",
    submitterPk,
    "--watch",
  ]);

  process.stdout.write(
    JSON.stringify({
      receipt_id: receiptId,
      cid_hash: cidHash,
      tx_hash: extractTxHash(invokeOutput),
    }),
  );
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

switch (command) {
  case "hash-string":
    cmdHashString(args);
    break;
  case "hash-file":
    cmdHashFile(args);
    break;
  case "hash-json-file":
    cmdHashJsonFile(args);
    break;
  case "issue-registry":
    cmdIssueRegistry(args);
    break;
  case "anchor-cid":
    cmdAnchorCid(args);
    break;
  default:
    fail(`Unknown command: ${command || "(none)"}`);
}
