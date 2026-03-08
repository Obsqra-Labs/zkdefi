import { init, getGroth16CallData, CurveId } from 'garaga';
import { readFileSync } from 'fs';

function toG1(arr) {
  return { x: BigInt(arr[0]), y: BigInt(arr[1]), curveId: CurveId.BN254 };
}
function toG2(arr) {
  return { x: [BigInt(arr[0][0]), BigInt(arr[0][1])], y: [BigInt(arr[1][0]), BigInt(arr[1][1])], curveId: CurveId.BN254 };
}

try {
  await init();
  console.log('init OK');
  
  const proof = JSON.parse(readFileSync('/tmp/test_proof.json', 'utf-8'));
  const pub = JSON.parse(readFileSync('/tmp/test_public.json', 'utf-8'));
  const vk = JSON.parse(readFileSync('build/PrivateDeposit_vkey.json', 'utf-8'));

  console.log('publicInputs count:', pub.length);
  console.log('IC count:', vk.IC.length);

  const proofData = {
    a: toG1(proof.pi_a),
    b: toG2(proof.pi_b),
    c: toG1(proof.pi_c),
    publicInputs: pub.map(v => BigInt(v)),
  };
  
  const vkData = {
    alpha: toG1(vk.vk_alpha_1),
    beta: toG2(vk.vk_beta_2),
    gamma: toG2(vk.vk_gamma_2),
    delta: toG2(vk.vk_delta_2),
    ic: vk.IC.map(pt => toG1(pt)),
  };
  
  console.log('Calling getGroth16CallData...');
  const calldata = getGroth16CallData(proofData, vkData, CurveId.BN254);
  console.log('SUCCESS! Calldata length:', calldata.length);
} catch(e) {
  console.error('ERROR:', e.message);
}
