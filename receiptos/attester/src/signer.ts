import { ec } from "starknet";

export interface StarkSignatureHex {
  r: string;
  s: string;
}

export class AttesterSigner {
  private readonly privateKey: string;
  public publicKey: string;
  public fullPublicKey: Uint8Array;

  constructor(privateKey: string) {
    this.privateKey = privateKey;
    this.publicKey = ec.starkCurve.getStarkKey(privateKey);
    this.fullPublicKey = ec.starkCurve.getPublicKey(privateKey);
  }

  sign(policyHash: string): StarkSignatureHex {
    const signature = ec.starkCurve.sign(policyHash, this.privateKey);
    return {
      r: `0x${signature.r.toString(16)}`,
      s: `0x${signature.s.toString(16)}`,
    };
  }

  verify(policyHash: string, signature: StarkSignatureHex): boolean {
    return verifyWithPublicKey(policyHash, signature, this.fullPublicKey);
  }
}

export function verifyWithPublicKey(
  policyHash: string,
  signature: StarkSignatureHex,
  fullPublicKey: Uint8Array,
): boolean {
  const starkSignature = new ec.starkCurve.Signature(BigInt(signature.r), BigInt(signature.s));
  return ec.starkCurve.verify(starkSignature, policyHash, fullPublicKey);
}
