import { ec } from "starknet";
export class AttesterSigner {
    privateKey;
    publicKey;
    fullPublicKey;
    constructor(privateKey) {
        this.privateKey = privateKey;
        this.publicKey = ec.starkCurve.getStarkKey(privateKey);
        this.fullPublicKey = ec.starkCurve.getPublicKey(privateKey);
    }
    sign(policyHash) {
        const signature = ec.starkCurve.sign(policyHash, this.privateKey);
        return {
            r: `0x${signature.r.toString(16)}`,
            s: `0x${signature.s.toString(16)}`,
        };
    }
    verify(policyHash, signature) {
        return verifyWithPublicKey(policyHash, signature, this.fullPublicKey);
    }
}
export function verifyWithPublicKey(policyHash, signature, fullPublicKey) {
    const starkSignature = new ec.starkCurve.Signature(BigInt(signature.r), BigInt(signature.s));
    return ec.starkCurve.verify(starkSignature, policyHash, fullPublicKey);
}
