import { ec } from "starknet";

export class AttesterSigner {
  private privateKey: string;
  public publicKey: string;

  constructor(privateKey: string) {
    this.privateKey = privateKey;
    this.publicKey = ec.starkCurve.getStarkKey(privateKey);
  }

  sign(policyHash: string): { r: string; s: string } {
    const signature = ec.starkCurve.sign(policyHash, this.privateKey);
    return {
      r: `0x${signature.r.toString(16)}`,
      s: `0x${signature.s.toString(16)}`,
    };
  }
}
