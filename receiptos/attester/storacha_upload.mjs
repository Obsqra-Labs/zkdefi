#!/usr/bin/env node

import { readFileSync } from "node:fs";

import * as Client from "@storacha/client";
import { StoreMemory } from "@storacha/client/stores/memory";
import * as Proof from "@storacha/client/proof";
import { Signer } from "@storacha/client/principal/ed25519";

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

async function createClient(args) {
  const key = String(args.key ?? process.env.STORACHA_AGENT_KEY ?? "").trim();
  const proofValue = String(args.proof ?? process.env.STORACHA_SPACE_PROOF ?? "").trim();
  const preferredSpaceDid = String(args.space ?? process.env.STORACHA_SPACE_DID ?? "").trim();
  if (!key || !proofValue) {
    fail("Missing STORACHA_AGENT_KEY or STORACHA_SPACE_PROOF");
  }

  const principal = Signer.parse(key);
  const store = new StoreMemory();
  const client = await Client.create({ principal, store });
  const proof = await Proof.parse(proofValue);
  const space = await client.addSpace(proof);
  await client.setCurrentSpace(preferredSpaceDid || space.did());
  return client;
}

async function cmdUploadJsonFile(args) {
  const path = String(args.path ?? "").trim();
  const name = String(args.name ?? "receipt-bundle.json").trim() || "receipt-bundle.json";
  const gatewayHost = String(args.gateway_host ?? process.env.STORACHA_GATEWAY_HOST ?? "w3s.link").trim() || "w3s.link";
  if (!path) {
    fail("--path is required");
  }

  const client = await createClient(args);
  const content = readFileSync(path);
  const file = new File([content], name, { type: "application/json" });
  const cid = await client.uploadDirectory([file]);
  process.stdout.write(
    JSON.stringify({
      cid: cid.toString(),
      ipfs_uri: `ipfs://${cid}`,
      gateway_url: `https://${cid}.ipfs.${gatewayHost}/${name}`,
      filename: name,
      space_did: client.currentSpace()?.did() ?? null,
    }),
  );
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

switch (command) {
  case "upload-json-file":
    await cmdUploadJsonFile(args);
    break;
  default:
    fail(`Unknown command: ${command || "(none)"}`);
}

