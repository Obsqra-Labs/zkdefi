// Versioned EZKL-style bridge circuit (Noir -> Garaga HONK).
// Stronger than the original Path A scaffold:
// - binds expected_model_hash
// - binds timestamp
// - binds ezkl_proof_hash as a public commitment input
// - checks model_weights_hash == expected_model_hash
// - checks 8 model outputs against shared bounds

fn main(
    expected_model_hash: pub Field,
    output_lower_bound: pub u128,
    output_upper_bound: pub u128,
    timestamp: pub Field,
    ezkl_proof_hash: pub Field,
    model_output: [u128; 8],
    model_weights_hash: Field,
) -> pub Field {
    let _timestamp = timestamp;
    let _proof_commitment = ezkl_proof_hash;

    assert(model_weights_hash == expected_model_hash);

    for i in 0..8 {
        assert(model_output[i] >= output_lower_bound);
        assert(model_output[i] <= output_upper_bound);
    }

    1 as Field
}
