import { ec } from "starknet";
export class AttesterSigner {
    privateKey;
    publicKey;
    constructor(privateKey) {
        this.privateKey = privateKey;
        this.publicKey = ec.starkCurve.getStarkKey(privateKey);
    }
    sign(policyHash) {
        const signature = ec.starkCurve.sign(policyHash, this.privateKey);
        return {
            r: `0x${signature.r.toString(16)}`,
            s: `0x${signature.s.toString(16)}`,
        };
    }
}
