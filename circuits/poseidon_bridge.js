#!/usr/bin/env node
/**
 * Poseidon Hash Bridge — Reads JSON from stdin, outputs BN254 Poseidon hash.
 *
 * Input:  {"values": [123, 456, ...]}
 * Output: {"hash": "<decimal string>"}
 *
 * Uses circomlibjs buildPoseidon() — identical hash function to Circom's
 * poseidon.circom template, so hashes will match circuit commitments.
 *
 * Usage from Python:
 *   subprocess.run(["node", "circuits/poseidon_bridge.js"],
 *                  input='{"values":[1,2,3]}', capture_output=True, text=True)
 */

const { buildPoseidon } = require("circomlibjs");

async function main() {
  // Read stdin
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString());

  if (!input.values || !Array.isArray(input.values)) {
    console.error(JSON.stringify({ error: "Expected {\"values\": [...]}" }));
    process.exit(1);
  }

  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // Convert inputs to BigInt
  const vals = input.values.map((v) => BigInt(v));

  // Compute Poseidon hash
  const hash = poseidon(vals);

  // Output as decimal string (same format as circuit public signals)
  const result = F.toString(hash, 10);
  console.log(JSON.stringify({ hash: result }));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
