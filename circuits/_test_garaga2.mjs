import { init, getGroth16CallData, get_groth16_calldata, CurveId } from 'garaga';
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

  // Try the snake_case API too
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

  console.log('Trying getGroth16CallData...');
  try {
    const calldata = getGroth16CallData(proofData, vkData, CurveId.BN254);
    console.log('SUCCESS camelCase! len:', calldata.length);
    console.log('First 5:', calldata.slice(0, 5).map(String));
    process.exit(0);
  } catch(e) {
    console.error('camelCase error:', e);
  }

  console.log('Trying get_groth16_calldata...');
  try {
    const calldata = get_groth16_calldata(proofData, vkData, CurveId.BN254);
    console.log('SUCCESS snake! len:', calldata.length);
    console.log('First 5:', calldata.slice(0, 5).map(String));
    process.exit(0);
  } catch(e) {
    console.error('snake error:', e);
  }
} catch(e) {
  console.error('OUTER:', e);
}
