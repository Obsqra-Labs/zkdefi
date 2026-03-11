// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IEzklVerifier {
    function verifyProof(bytes calldata proof, uint256[] calldata instances) external returns (bool);
}

interface IStarknetCore {
    function sendMessageToL2(uint256 toAddress, uint256 selector, uint256[] calldata payload)
        external
        payable
        returns (bytes32);
}

/// @notice Verifies EZKL proofs on L1 then forwards a canonical message to Starknet L2/L3.
/// Payload format matches contracts/src/l1_ezkl_bridge_receiver.cairo:
/// [model_hash, output_commitment, verified, nonce_low, nonce_high, chain_id_low, chain_id_high]
contract L1EzklBridgeSender {
    IEzklVerifier public immutable verifier;
    IStarknetCore public immutable starknetCore;
    uint256 public immutable l2Receiver;
    uint256 public immutable l2Selector;
    uint256 public nonce;

    event EzklVerifiedAndBridged(
        address indexed caller,
        uint256 indexed nonce,
        uint256 indexed modelHash,
        uint256 outputCommitment,
        bytes32 messageHash
    );

    constructor(address verifierAddress, address starknetCoreAddress, uint256 receiver, uint256 selector) {
        require(verifierAddress != address(0), "VERIFIER_ZERO");
        require(starknetCoreAddress != address(0), "STARKNET_CORE_ZERO");
        require(receiver != 0, "L2_RECEIVER_ZERO");
        require(selector != 0, "L2_SELECTOR_ZERO");

        verifier = IEzklVerifier(verifierAddress);
        starknetCore = IStarknetCore(starknetCoreAddress);
        l2Receiver = receiver;
        l2Selector = selector;
    }

    function verifyAndBridge(bytes calldata proof, uint256[] calldata instances, uint256 modelHash, uint256 outputCommitment)
        external
        payable
        returns (uint256 usedNonce, bytes32 messageHash)
    {
        bool ok = verifier.verifyProof(proof, instances);
        require(ok, "EZKL_VERIFY_FAILED");

        usedNonce = nonce;
        nonce = usedNonce + 1;

        uint256[] memory payload = _payload(modelHash, outputCommitment, usedNonce);
        messageHash = starknetCore.sendMessageToL2{value: msg.value}(l2Receiver, l2Selector, payload);

        emit EzklVerifiedAndBridged(msg.sender, usedNonce, modelHash, outputCommitment, messageHash);
    }

    function previewPayload(uint256 modelHash, uint256 outputCommitment, uint256 nonceValue)
        external
        view
        returns (uint256[] memory)
    {
        return _payload(modelHash, outputCommitment, nonceValue);
    }

    function _payload(uint256 modelHash, uint256 outputCommitment, uint256 nonceValue)
        internal
        view
        returns (uint256[] memory payload)
    {
        payload = new uint256[](7);
        payload[0] = modelHash;
        payload[1] = outputCommitment;
        payload[2] = 1; // verified = true
        payload[3] = nonceValue & ((uint256(1) << 128) - 1);
        payload[4] = nonceValue >> 128;
        payload[5] = block.chainid & ((uint256(1) << 128) - 1);
        payload[6] = block.chainid >> 128;
    }
}
