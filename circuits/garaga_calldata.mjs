#!/usr/bin/env node
/**
 * garaga_calldata.mjs
 *
 * Generates Garaga-formatted calldata from a snarkjs Groth16 proof + verification key.
 * Uses the official `garaga` npm package (v1.0.1).
 *
 * Usage:
 *   node garaga_calldata.mjs <proof.json> <public.json> <vkey.json>
 *
 * Outputs JSON array of calldata integers (decimal strings) to stdout.
 * Exits 0 on success, 2 on error.
 */

import { init, getGroth16CallData, CurveId } from 'garaga';
import { readFileSync } from 'fs';

const [proofPath, publicPath, vkPath] = process.argv.slice(2);

if (!proofPath || !publicPath || !vkPath) {
  console.error('Usage: node garaga_calldata.mjs <proof.json> <public.json> <vkey.json>');
  process.exit(1);
}

// Convert snarkjs G1 point [x, y, "1"] to Garaga G1Point {x, y, curveId}
function toG1(arr) {
  return {
    x: BigInt(arr[0]),
    y: BigInt(arr[1]),
    curveId: CurveId.BN254,
  };
}

// Convert snarkjs G2 point [[x0, x1], [y0, y1], ["1","0"]] to Garaga G2Point
function toG2(arr) {
  return {
    x: [BigInt(arr[0][0]), BigInt(arr[0][1])],
    y: [BigInt(arr[1][0]), BigInt(arr[1][1])],
    curveId: CurveId.BN254,
  };
}

try {
  await init();

  const proofJson = JSON.parse(readFileSync(proofPath, 'utf-8'));
  const publicJson = JSON.parse(readFileSync(publicPath, 'utf-8'));
  const vkJson = JSON.parse(readFileSync(vkPath, 'utf-8'));

  // Build Groth16Proof object from snarkjs format
  const proof = {
    a: toG1(proofJson.pi_a),
    b: toG2(proofJson.pi_b),
    c: toG1(proofJson.pi_c),
    publicInputs: publicJson.map((v) => BigInt(v)),
  };

  // Build Groth16VerifyingKey from snarkjs vkey format
  const verifyingKey = {
    alpha: toG1(vkJson.vk_alpha_1),
    beta: toG2(vkJson.vk_beta_2),
    gamma: toG2(vkJson.vk_gamma_2),
    delta: toG2(vkJson.vk_delta_2),
    ic: vkJson.IC.map((pt) => toG1(pt)),
  };

  const calldata = getGroth16CallData(proof, verifyingKey, CurveId.BN254);

  // Output as JSON array of decimal strings
  const result = calldata.map((v) => v.toString());
  console.log(JSON.stringify(result));
} catch (err) {
  console.error(`Error: ${err.message || err}`);
  process.exit(2);
}
