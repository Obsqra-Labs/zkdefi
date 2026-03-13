// EZKL-style bridge circuit (Noir -> Garaga HONK).
// Proves: model_output in [output_lower_bound, output_upper_bound];
//         expected_model_hash is the public model identity.
// Single aggregated model_output (Field) for minimal scaffold.

fn main(
    expected_model_hash: pub Field,
    output_lower_bound: pub u128,
    output_upper_bound: pub u128,
    model_output: u128,
) -> pub Field {
    // Keep model hash in the public input set for bridge identity binding.
    let _model_hash = expected_model_hash;
    assert(model_output >= output_lower_bound);
    assert(model_output <= output_upper_bound);
    1 as Field
}
