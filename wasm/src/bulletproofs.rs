//! Bulletproofs range proof prover.
//!
//! Implements the Bulletproofs range proof protocol for proving that
//! committed values lie in [0, 2^64). This matches the dalek-bulletproofs
//! implementation used by MobileCoin consensus for verification.
//!
//! Reference: Bünz et al., "Bulletproofs: Short Proofs for Confidential
//! Transactions and More" (https://eprint.iacr.org/2017/1066)
//!
//! Compatibility: Generator derivation, Merlin transcript labels, and
//! proof structure match dalek-bulletproofs / mc-bulletproofs exactly.

use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::traits::VartimeMultiscalarMul;
use merlin::Transcript;
use sha3::{Shake256, digest::{Update, ExtendableOutput, XofReader}};
use serde::{Serialize, Deserialize};

/// Number of bits in the range proof (64-bit values)
const N_BITS: usize = 64;

// ── Generator derivation ──
// Matches dalek-bulletproofs GeneratorsChain: SHAKE-256 XOF

/// Deterministic generator chain using SHAKE-256, matching dalek-bulletproofs.
/// Domain: SHAKE-256(b"GeneratorsChain" || label), then squeeze 64 bytes per point.
struct GeneratorsChain {
    reader: sha3::digest::core_api::XofReaderCoreWrapper<sha3::Shake256ReaderCore>,
}

impl GeneratorsChain {
    fn new(label: &[u8]) -> Self {
        let mut shake = Shake256::default();
        shake.update(b"GeneratorsChain");
        shake.update(label);
        GeneratorsChain {
            reader: shake.finalize_xof(),
        }
    }
}

impl Iterator for GeneratorsChain {
    type Item = RistrettoPoint;

    fn next(&mut self) -> Option<Self::Item> {
        let mut uniform_bytes = [0u8; 64];
        self.reader.read(&mut uniform_bytes);
        Some(RistrettoPoint::from_uniform_bytes(&uniform_bytes))
    }
}

/// Pedersen generators for Bulletproofs, matching dalek-bulletproofs BulletproofGens.
pub(crate) struct BulletproofGens {
    /// Per-party G generators (n_bits per party)
    pub g_vec: Vec<RistrettoPoint>,
    /// Per-party H generators (n_bits per party)
    pub h_vec: Vec<RistrettoPoint>,
}

impl BulletproofGens {
    /// Create generators for `m` aggregated proofs of `n`-bit values.
    ///
    /// Matches dalek-bulletproofs: each party gets its own SHAKE-256 stream
    /// with label [b'G' or b'H', party_index as u32 LE]. Generators are
    /// laid out in party-major order (party 0 first, then party 1, etc.).
    pub fn new(n: usize, m: usize) -> Self {
        let mut g_vec = Vec::with_capacity(n * m);
        let mut h_vec = Vec::with_capacity(n * m);

        for party in 0..m {
            let mut label = [b'G', 0, 0, 0, 0];
            label[1..5].copy_from_slice(&(party as u32).to_le_bytes());
            g_vec.extend(GeneratorsChain::new(&label).take(n));

            label[0] = b'H';
            h_vec.extend(GeneratorsChain::new(&label).take(n));
        }

        BulletproofGens { g_vec, h_vec }
    }
}

/// Pedersen commitment generators (basepoints B and B_blinding).
///
/// MobileCoin convention (differs from dalek-bulletproofs defaults):
///   B = token-specific generator H_token (for committed value)
///   B_blinding = RISTRETTO_BASEPOINT_POINT (for blinding factor)
///
/// Commitment: C = value * B + blinding * B_blinding
pub(crate) struct PedersenGens {
    /// Base for the committed value
    pub b: RistrettoPoint,
    /// Base for the blinding factor
    pub b_blinding: RistrettoPoint,
}

impl Default for PedersenGens {
    fn default() -> Self {
        PedersenGens {
            b: RISTRETTO_BASEPOINT_POINT,
            b_blinding: {
                // The blinding generator matches dalek-bulletproofs:
                // hash_to_point(SHA3-512("PedersenGeneratorsBlinding"))
                let mut gen = GeneratorsChain::new(b"PedersenGeneratorsBlinding");
                gen.next().unwrap()
            },
        }
    }
}

impl PedersenGens {
    /// Create MC-style generators for a given token.
    /// B = H_token (value base), B_blinding = G (blinding base)
    pub fn for_token(h_token: RistrettoPoint) -> Self {
        PedersenGens {
            b: h_token,
            b_blinding: RISTRETTO_BASEPOINT_POINT,
        }
    }
}

impl PedersenGens {
    /// Commit: v * B + blinding * B_blinding
    pub fn commit(&self, value: Scalar, blinding: Scalar) -> RistrettoPoint {
        value * self.b + blinding * self.b_blinding
    }
}

/// A Bulletproofs range proof.
#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct RangeProof {
    /// Commitment to the bit-vectors a_L, a_R
    #[serde(rename = "A")]
    pub a_point: Vec<u8>, // 32 bytes
    /// Commitment to the blinding vectors s_L, s_R
    #[serde(rename = "S")]
    pub s_point: Vec<u8>, // 32 bytes
    /// Commitment to t_1 coefficient
    #[serde(rename = "T1")]
    pub t1_point: Vec<u8>, // 32 bytes
    /// Commitment to t_2 coefficient
    #[serde(rename = "T2")]
    pub t2_point: Vec<u8>, // 32 bytes
    /// Evaluation of t(x) at challenge point
    pub t_x: Vec<u8>, // 32 bytes (Scalar)
    /// Blinding factor for t_x
    pub t_x_blinding: Vec<u8>, // 32 bytes (Scalar)
    /// Blinding factor for the inner-product argument
    pub e_blinding: Vec<u8>, // 32 bytes (Scalar)
    /// Inner product proof
    pub ipp_proof: InnerProductProof,
}

/// Inner product argument proof.
#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct InnerProductProof {
    /// Left half-size commitments (log2(n*m) elements)
    #[serde(rename = "L")]
    pub l_vec: Vec<Vec<u8>>, // each 32 bytes
    /// Right half-size commitments (log2(n*m) elements)
    #[serde(rename = "R")]
    pub r_vec: Vec<Vec<u8>>, // each 32 bytes
    /// Final scalar a
    pub a: Vec<u8>, // 32 bytes
    /// Final scalar b
    pub b: Vec<u8>, // 32 bytes
}

impl RangeProof {
    /// Serialize to dalek-bulletproofs wire format (flat byte concatenation).
    ///
    /// Format: A(32) | S(32) | T1(32) | T2(32) | t_x(32) | t_x_blinding(32) | e_blinding(32)
    ///         | ipp: L[0](32) R[0](32) ... L[n-1](32) R[n-1](32) a(32) b(32)
    pub fn to_bytes(&self) -> Vec<u8> {
        let n_rounds = self.ipp_proof.l_vec.len();
        // 7 scalars/points + 2*n_rounds L/R + 2 final scalars
        let total = 7 * 32 + 2 * n_rounds * 32 + 2 * 32;
        let mut buf = Vec::with_capacity(total);

        buf.extend_from_slice(&self.a_point);
        buf.extend_from_slice(&self.s_point);
        buf.extend_from_slice(&self.t1_point);
        buf.extend_from_slice(&self.t2_point);
        buf.extend_from_slice(&self.t_x);
        buf.extend_from_slice(&self.t_x_blinding);
        buf.extend_from_slice(&self.e_blinding);

        // Inner product proof: interleaved L[i], R[i]
        for i in 0..n_rounds {
            buf.extend_from_slice(&self.ipp_proof.l_vec[i]);
            buf.extend_from_slice(&self.ipp_proof.r_vec[i]);
        }
        buf.extend_from_slice(&self.ipp_proof.a);
        buf.extend_from_slice(&self.ipp_proof.b);

        buf
    }
}

/// Generate a random scalar using getrandom
fn random_scalar() -> Scalar {
    let mut bytes = [0u8; 64];
    getrandom::getrandom(&mut bytes).expect("RNG failed");
    Scalar::from_bytes_mod_order_wide(&bytes)
}

/// Compute the inner product of two scalar vectors
fn inner_product(a: &[Scalar], b: &[Scalar]) -> Scalar {
    a.iter().zip(b.iter()).map(|(ai, bi)| ai * bi).fold(Scalar::ZERO, |sum, x| sum + x)
}

/// Prove range with custom Pedersen generators (for MC token-specific commitments).
pub(crate) fn prove_range_with_generators(
    values: &[u64],
    blindings: &[Scalar],
    pc_gens: &PedersenGens,
) -> RangeProof {
    // Pad to next power of 2 by duplicating the last element,
    // matching MobileCoin's resize_slice_to_pow2 in range_proofs/mod.rs.
    let raw_m = values.len();
    let m = raw_m.checked_next_power_of_two().unwrap_or(raw_m);
    let mut padded_values = values.to_vec();
    let mut padded_blindings = blindings.to_vec();
    if m > raw_m {
        let last_v = *padded_values.last().unwrap();
        let last_b = *padded_blindings.last().unwrap();
        padded_values.resize(m, last_v);
        padded_blindings.resize(m, last_b);
    }

    let nm = N_BITS * m;

    let bp_gens = BulletproofGens::new(N_BITS, m);

    // ── Transcript setup (matches MobileCoin's mc_bulletproof_transcript) ──
    let mut transcript = Transcript::new(b"mc_bulletproof_transcript");

    // Domain separator for range proof (matches dalek-bulletproofs rangeproof_domain_sep)
    transcript.append_message(b"dom-sep", b"rangeproof v1");
    transcript.append_u64(b"n", N_BITS as u64);
    transcript.append_u64(b"m", m as u64);

    // Commit values (using padded arrays)
    let v_commitments: Vec<CompressedRistretto> = padded_values
        .iter()
        .zip(padded_blindings.iter())
        .map(|(&v, &b)| pc_gens.commit(Scalar::from(v), b).compress())
        .collect();

    for vc in &v_commitments {
        transcript.append_message(b"V", vc.as_bytes());
    }

    // ── Step 1: Compute a_L, a_R bit decomposition ──
    let mut a_l = vec![Scalar::ZERO; nm];
    let mut a_r = vec![Scalar::ZERO; nm];

    for j in 0..m {
        for i in 0..N_BITS {
            if (padded_values[j] >> i) & 1 == 1 {
                a_l[j * N_BITS + i] = Scalar::ONE;
                a_r[j * N_BITS + i] = Scalar::ZERO;
            } else {
                a_l[j * N_BITS + i] = Scalar::ZERO;
                a_r[j * N_BITS + i] = -Scalar::ONE;
            }
        }
    }

    // ── Step 2: Commit to a_L, a_R with blinding alpha ──
    let alpha = random_scalar();

    // A = alpha * B_blinding + <a_L, G> + <a_R, H>
    let a_point = alpha * pc_gens.b_blinding
        + RistrettoPoint::vartime_multiscalar_mul(
            a_l.iter().chain(a_r.iter()),
            bp_gens.g_vec.iter().take(nm).chain(bp_gens.h_vec.iter().take(nm)),
        );
    let a_compressed = a_point.compress();
    transcript.append_message(b"A", a_compressed.as_bytes());

    // ── Step 3: Commit to blinding vectors s_L, s_R ──
    let rho = random_scalar();
    let s_l: Vec<Scalar> = (0..nm).map(|_| random_scalar()).collect();
    let s_r: Vec<Scalar> = (0..nm).map(|_| random_scalar()).collect();

    // S = rho * B_blinding + <s_L, G> + <s_R, H>
    let s_point = rho * pc_gens.b_blinding
        + RistrettoPoint::vartime_multiscalar_mul(
            s_l.iter().chain(s_r.iter()),
            bp_gens.g_vec.iter().take(nm).chain(bp_gens.h_vec.iter().take(nm)),
        );
    let s_compressed = s_point.compress();
    transcript.append_message(b"S", s_compressed.as_bytes());

    // ── Step 4: Challenge y, z ──
    let y = transcript_challenge_scalar(&mut transcript, b"y");
    let z = transcript_challenge_scalar(&mut transcript, b"z");

    // ── Step 5: Compute polynomial coefficients t_1, t_2 ──
    // l(x) = (a_L - z*1^n) + s_L * x
    // r(x) = y^n ⊙ (a_R + z*1^n + s_R*x) + sum_j(z^(j+2) * 2^n_shifted)
    //
    // t(x) = <l(x), r(x)> = t_0 + t_1*x + t_2*x^2

    let mut y_powers = vec![Scalar::ONE; nm]; // y^0, y^1, ..., y^(nm-1)
    for i in 1..nm {
        y_powers[i] = y_powers[i - 1] * y;
    }

    let mut z_powers = vec![Scalar::ONE; m + 2]; // z^0, z^1, ..., z^(m+1)
    for i in 1..z_powers.len() {
        z_powers[i] = z_powers[i - 1] * z;
    }

    // 2^n vector for each party
    let mut two_n = vec![Scalar::ONE; N_BITS];
    for i in 1..N_BITS {
        two_n[i] = two_n[i - 1] + two_n[i - 1]; // 2^i
    }

    // l_0 = a_L - z * 1
    // l_1 = s_L
    let l_0: Vec<Scalar> = a_l.iter().map(|a| a - z).collect();
    let l_1: Vec<Scalar> = s_l.clone();

    // r_0 = y^n ⊙ (a_R + z) + sum_j(z^(j+2) * 2^n) for each party
    // r_1 = y^n ⊙ s_R
    let mut r_0 = vec![Scalar::ZERO; nm];
    let mut r_1 = vec![Scalar::ZERO; nm];

    for j in 0..m {
        for i in 0..N_BITS {
            let idx = j * N_BITS + i;
            r_0[idx] = y_powers[idx] * (a_r[idx] + z) + z_powers[j + 2] * two_n[i];
            r_1[idx] = y_powers[idx] * s_r[idx];
        }
    }

    let t_1 = inner_product(&l_0, &r_1) + inner_product(&l_1, &r_0);
    let t_2 = inner_product(&l_1, &r_1);

    // ── Step 6: Commit to t_1, t_2 ──
    let tau_1 = random_scalar();
    let tau_2 = random_scalar();

    let t1_point = pc_gens.commit(t_1, tau_1).compress();
    let t2_point = pc_gens.commit(t_2, tau_2).compress();

    transcript.append_message(b"T_1", t1_point.as_bytes());
    transcript.append_message(b"T_2", t2_point.as_bytes());

    // ── Step 7: Challenge x ──
    let x = transcript_challenge_scalar(&mut transcript, b"x");

    // ── Step 8: Compute evaluations ──
    // t_hat = t_0 + t_1*x + t_2*x^2  (computed from l(x), r(x))
    let l_x: Vec<Scalar> = l_0.iter().zip(l_1.iter()).map(|(a, b)| a + x * b).collect();
    let r_x: Vec<Scalar> = r_0.iter().zip(r_1.iter()).map(|(a, b)| a + x * b).collect();
    let t_hat = inner_product(&l_x, &r_x);

    // tau_x = tau_2 * x^2 + tau_1 * x + sum_j(z^(j+2) * blinding_j)
    let mut tau_x = tau_2 * x * x + tau_1 * x;
    for j in 0..m {
        tau_x += z_powers[j + 2] * padded_blindings[j];
    }

    // mu = alpha + rho * x
    let mu = alpha + rho * x;

    transcript.append_message(b"t_x", t_hat.as_bytes());
    transcript.append_message(b"t_x_blinding", tau_x.as_bytes());
    transcript.append_message(b"e_blinding", mu.as_bytes());

    // ── Step 9: Inner product proof ──
    // We need to prove <l_x, r_x> = t_hat with respect to generators G', H'
    // where H'_i = y^(-i) * H_i

    let y_inv = y.invert();
    let mut y_inv_powers = vec![Scalar::ONE; nm];
    for i in 1..nm {
        y_inv_powers[i] = y_inv_powers[i - 1] * y_inv;
    }

    // H' = y^(-i) * H_i
    let h_prime: Vec<RistrettoPoint> = bp_gens.h_vec.iter().take(nm)
        .enumerate()
        .map(|(i, h)| y_inv_powers[i] * h)
        .collect();

    let g_vec: Vec<RistrettoPoint> = bp_gens.g_vec.iter().take(nm).copied().collect();

    let ipp = prove_inner_product(
        &mut transcript,
        &pc_gens.b,
        &g_vec,
        &h_prime,
        &l_x,
        &r_x,
    );

    RangeProof {
        a_point: a_compressed.as_bytes().to_vec(),
        s_point: s_compressed.as_bytes().to_vec(),
        t1_point: t1_point.as_bytes().to_vec(),
        t2_point: t2_point.as_bytes().to_vec(),
        t_x: t_hat.as_bytes().to_vec(),
        t_x_blinding: tau_x.as_bytes().to_vec(),
        e_blinding: mu.as_bytes().to_vec(),
        ipp_proof: ipp,
    }
}

/// Produce a challenge scalar from the transcript.
/// Matches dalek-bulletproofs transcript usage.
fn transcript_challenge_scalar(transcript: &mut Transcript, label: &'static [u8]) -> Scalar {
    let mut bytes = [0u8; 64];
    transcript.challenge_bytes(label, &mut bytes);
    Scalar::from_bytes_mod_order_wide(&bytes)
}

/// Inner product argument proof.
///
/// Proves that <a, b> = c where the verifier knows
/// P = <a, G> + <b, H> + c * U.
///
/// Uses the recursive halving protocol from Bulletproofs Section 4.
fn prove_inner_product(
    transcript: &mut Transcript,
    q_base: &RistrettoPoint,
    g: &[RistrettoPoint],
    h: &[RistrettoPoint],
    a: &[Scalar],
    b: &[Scalar],
) -> InnerProductProof {
    let mut g = g.to_vec();
    let mut h = h.to_vec();
    let mut a = a.to_vec();
    let mut b = b.to_vec();

    let mut l_vec = Vec::new();
    let mut r_vec = Vec::new();

    let mut n = g.len();

    // w challenge is a range proof challenge (before IPP domain sep)
    let w = transcript_challenge_scalar(transcript, b"w");
    // Q = w * pc_gens.B (the value generator, NOT the ristretto basepoint)
    let q = w * q_base;

    // Inner product domain separator (after w, before first u challenge)
    // Matches dalek-bulletproofs innerproduct_domain_sep
    transcript.append_message(b"dom-sep", b"ipp v1");
    transcript.append_u64(b"n", n as u64);

    while n > 1 {
        let half = n / 2;

        let (a_lo, a_hi) = a.split_at(half);
        let (b_lo, b_hi) = b.split_at(half);
        let (g_lo, g_hi) = g.split_at(half);
        let (h_lo, h_hi) = h.split_at(half);

        // L = <a_lo, g_hi> + <b_hi, h_lo> + <a_lo, b_hi> * Q
        let c_l = inner_product(a_lo, b_hi);
        let l_point = RistrettoPoint::vartime_multiscalar_mul(
            a_lo.iter().chain(b_hi.iter()).chain(core::iter::once(&c_l)),
            g_hi.iter().chain(h_lo.iter()).chain(core::iter::once(&q)),
        );
        let l_compressed = l_point.compress();

        // R = <a_hi, g_lo> + <b_lo, h_hi> + <a_hi, b_lo> * Q
        let c_r = inner_product(a_hi, b_lo);
        let r_point = RistrettoPoint::vartime_multiscalar_mul(
            a_hi.iter().chain(b_lo.iter()).chain(core::iter::once(&c_r)),
            g_lo.iter().chain(h_hi.iter()).chain(core::iter::once(&q)),
        );
        let r_compressed = r_point.compress();

        transcript.append_message(b"L", l_compressed.as_bytes());
        transcript.append_message(b"R", r_compressed.as_bytes());

        l_vec.push(l_compressed.as_bytes().to_vec());
        r_vec.push(r_compressed.as_bytes().to_vec());

        // Challenge u
        let u = transcript_challenge_scalar(transcript, b"u");
        let u_inv = u.invert();

        // Fold
        a = a_lo.iter().zip(a_hi.iter())
            .map(|(lo, hi)| u * lo + u_inv * hi)
            .collect();
        b = b_lo.iter().zip(b_hi.iter())
            .map(|(lo, hi)| u_inv * lo + u * hi)
            .collect();
        g = g_lo.iter().zip(g_hi.iter())
            .map(|(lo, hi)| RistrettoPoint::vartime_multiscalar_mul(&[u_inv, u], &[*lo, *hi]))
            .collect();
        h = h_lo.iter().zip(h_hi.iter())
            .map(|(lo, hi)| RistrettoPoint::vartime_multiscalar_mul(&[u, u_inv], &[*lo, *hi]))
            .collect();

        n = half;
    }

    InnerProductProof {
        l_vec,
        r_vec,
        a: a[0].as_bytes().to_vec(),
        b: b[0].as_bytes().to_vec(),
    }
}
