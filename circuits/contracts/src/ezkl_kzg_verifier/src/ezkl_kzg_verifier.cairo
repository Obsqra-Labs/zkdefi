#[starknet::interface]
pub trait IEzklKzgVerifier<TContractState> {
    /// Legacy selector used by existing parent backends.
    fn verify_kzg(self: @TContractState, payload: Span<felt252>) -> bool;

    /// Preferred selector: validates payload and binds it to a fact hash.
    fn verify_ezkl_kzg_v1(
        ref self: TContractState, expected_fact_hash: felt252, payload: Span<felt252>,
    ) -> bool;

    fn get_last_verification(
        self: @TContractState,
    ) -> (bool, felt252, felt252, felt252, felt252);
}

#[starknet::contract]
mod EzklKzgVerifier {
    use core::array::SpanTrait;
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use core::serde::Serde;
    use garaga::apps::noir::{G2_POINT_KZG_1, G2_POINT_KZG_2};
    use garaga::definitions::{G1G2Pair, G1Point};
    use garaga::pairing_check::{MPCheckHintBN254, multi_pairing_check_bn254_2P_2F};
    use garaga_verifier_noir_ezkl_bridge::honk_verifier_constants::precomputed_lines;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    const EZKL_KZG_V1_MARKER: felt252 = 0x657a6b6c5f6b7a675f7631;
    const PLACEHOLDER_MARKER: felt252 = 0x6e61746976655f6b7a675f706c616365686f6c6465725f7631;
    const KZG_MPCHECK_V1_MARKER: felt252 = 0x6b7a675f6d70636865636b5f7631;
    const HEADER_LEN: usize = 8;
    const TRAILER_G1_FELTS: usize = 16;
    const MAX_PUBLIC_INPUTS: usize = 4096;
    const MAX_OUTPUTS: usize = 4096;
    const MAX_PROOF_BLOB_FELTS: usize = 32768;

    #[storage]
    struct Storage {
        last_ok: bool,
        last_expected_fact_hash: felt252,
        last_proof_hash: felt252,
        last_payload_hash: felt252,
        last_marker: felt252,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        VerificationChecked: VerificationChecked,
    }

    #[derive(Drop, starknet::Event)]
    struct VerificationChecked {
        expected_fact_hash: felt252,
        proof_hash: felt252,
        payload_hash: felt252,
        marker: felt252,
        accepted: bool,
    }

    fn validate_payload(
        expected_fact_hash: felt252, payload: Span<felt252>,
    ) -> (bool, felt252, felt252, felt252) {
        let payload_len = payload.len();
        if payload_len < HEADER_LEN {
            return (false, 0, 0, 0);
        }

        let marker = *payload.at(0);
        if marker != EZKL_KZG_V1_MARKER {
            return (false, marker, 0, 0);
        }
        if marker == PLACEHOLDER_MARKER {
            return (false, marker, 0, 0);
        }

        let n_public: usize = match (*payload.at(4)).try_into() {
            Option::Some(v) => v,
            Option::None => {
                return (false, marker, 0, 0);
            },
        };
        let n_outputs: usize = match (*payload.at(5)).try_into() {
            Option::Some(v) => v,
            Option::None => {
                return (false, marker, 0, 0);
            },
        };
        let n_blob: usize = match (*payload.at(6)).try_into() {
            Option::Some(v) => v,
            Option::None => {
                return (false, marker, 0, 0);
            },
        };

        if n_public > MAX_PUBLIC_INPUTS || n_outputs > MAX_OUTPUTS || n_blob > MAX_PROOF_BLOB_FELTS {
            return (false, marker, 0, 0);
        }

        let base_len = HEADER_LEN + n_public + n_outputs + n_blob;
        if payload_len <= base_len {
            return (false, marker, 0, 0);
        }

        // Reject synthetic/empty payloads in the native lane.
        if n_blob == 0 {
            return (false, marker, 0, 0);
        }
        let raw_proof_json_hash = *payload.at(7);
        if raw_proof_json_hash == 0 {
            return (false, marker, 0, 0);
        }

        let proof_hash = *payload.at(3);
        let payload_hash = poseidon_hash_span(payload);
        let fact_ok =
            expected_fact_hash == 0 || expected_fact_hash == proof_hash
                || expected_fact_hash == payload_hash;
        if !fact_ok {
            return (false, marker, payload_hash, proof_hash);
        }

        // Cryptographic trailer:
        // [kzg_mpcheck_v1 marker][pair0_g1 (8 felts)][pair1_g1 (8 felts)][hint_len][hint_felts...]
        let mut trailer = payload.slice(base_len, payload_len - base_len);
        let trailer_marker = *trailer.pop_front().unwrap();
        if trailer_marker != KZG_MPCHECK_V1_MARKER {
            return (false, marker, payload_hash, proof_hash);
        }
        if trailer.len() < (TRAILER_G1_FELTS + 1) {
            return (false, marker, payload_hash, proof_hash);
        }

        let pair0 = match Serde::<G1Point>::deserialize(ref trailer) {
            Option::Some(v) => v,
            Option::None => {
                return (false, marker, payload_hash, proof_hash);
            },
        };
        let pair1 = match Serde::<G1Point>::deserialize(ref trailer) {
            Option::Some(v) => v,
            Option::None => {
                return (false, marker, payload_hash, proof_hash);
            },
        };
        if pair0.is_zero() || pair1.is_zero() {
            return (false, marker, payload_hash, proof_hash);
        }

        let hint_len: usize = match (*trailer.pop_front().unwrap()).try_into() {
            Option::Some(v) => v,
            Option::None => {
                return (false, marker, payload_hash, proof_hash);
            },
        };
        if hint_len == 0 || trailer.len() != hint_len {
            return (false, marker, payload_hash, proof_hash);
        }

        let mut hint_serialized = trailer;
        let mpcheck_hint = match Serde::<MPCheckHintBN254>::deserialize(ref hint_serialized) {
            Option::Some(v) => v,
            Option::None => {
                return (false, marker, payload_hash, proof_hash);
            },
        };
        if hint_serialized.len() != 0 {
            return (false, marker, payload_hash, proof_hash);
        }

        let pair0_kzg = G1G2Pair { p: pair0, q: G2_POINT_KZG_1 };
        let pair1_kzg = G1G2Pair { p: pair1, q: G2_POINT_KZG_2 };
        let mut lines = precomputed_lines.span();
        let kzg_ok = match multi_pairing_check_bn254_2P_2F(
            pair0_kzg, pair1_kzg, lines, mpcheck_hint,
        ) {
            Result::Ok(v) => v,
            Result::Err(_) => false,
        };
        if !kzg_ok {
            return (false, marker, payload_hash, proof_hash);
        }

        (true, marker, payload_hash, proof_hash)
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.last_ok.write(false);
        self.last_expected_fact_hash.write(0);
        self.last_proof_hash.write(0);
        self.last_payload_hash.write(0);
        self.last_marker.write(0);
    }

    #[abi(embed_v0)]
    impl EzklKzgVerifierImpl of super::IEzklKzgVerifier<ContractState> {
        fn verify_kzg(self: @ContractState, payload: Span<felt252>) -> bool {
            let (ok, _, _, _) = validate_payload(0, payload);
            assert(ok, 'INVALID_KZG');
            true
        }

        fn verify_ezkl_kzg_v1(
            ref self: ContractState, expected_fact_hash: felt252, payload: Span<felt252>,
        ) -> bool {
            let (ok, marker, payload_hash, proof_hash) = validate_payload(expected_fact_hash, payload);
            self.last_ok.write(ok);
            self.last_expected_fact_hash.write(expected_fact_hash);
            self.last_proof_hash.write(proof_hash);
            self.last_payload_hash.write(payload_hash);
            self.last_marker.write(marker);

            self.emit(
                VerificationChecked {
                    expected_fact_hash,
                    proof_hash,
                    payload_hash,
                    marker,
                    accepted: ok,
                },
            );
            assert(ok, 'INVALID_KZG');
            true
        }

        fn get_last_verification(
            self: @ContractState,
        ) -> (bool, felt252, felt252, felt252, felt252) {
            (
                self.last_ok.read(),
                self.last_expected_fact_hash.read(),
                self.last_proof_hash.read(),
                self.last_payload_hash.read(),
                self.last_marker.read(),
            )
        }
    }
}
