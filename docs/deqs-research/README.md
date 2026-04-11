# Technical report on getting a workable deqs-server deployed

## Context

We are trying to deploy [deqs-server](https://github.com/mobilecoinofficial/deqs) to be able to add the SCI `SubmitQuotes → GetQuotes → LiveUpdates → key-image cleanup` flow into the DDEX MVP app.

The `deqs-server` hasn't been updated for 3 years, the last commit was `commit 948f212a9c1ad8cd5495d36f4b7d2139e2556bbd` dated `Thu Apr 20 10:21:59 2023 -0600`. As we'll see after compiling with `attempt 1`, the ecosystem has moved on and the project is in a bitrotten state.

## Attempt 1: Compiling from last commit

> `Dockerfile`: Check the compilation details at `Dockerfile-last-commit` in this folder.

### Overview of deployment artifacts

The following files were moved manually to the server after compiling through the Dockerfile:
- Ledger file: `data.mdb`. In the deployment, it stays in a separate drive currently mounted at `/mnt/HC_Volume_105354787`.
- Commands `deqs-server` and `deqs-test-cli` were manually moved to `/usr/local/bin`.
- The compile protoset file `deqs.protoset` was manually moved to `/usr/local/share/deqs/`.

This means that the current deployment only uses Docker for the compilation stage. All the files and binaries are running natively in the server instance.

You can build the binaries by running: 
```
docker build --tag deqs-latest-commit . -f ./Dockerfile-last-commit
```

### How to run the commands in the current public deployment

If you want to see the error state at length to understand better the issues found:

- SSH into the deployment machine at `65.108.52.51`
```
ssh root@65.108.52.51
```

- Run the `deqs-server` with
```
MC_LOG=trace \
IAS_MODE=DEV \
SGX_MODE=SW deqs-server \
  --client-listen-uri insecure-deqs://127.0.0.1:7000 \
  --db-path /tmp/quotes.db \
  --ledger-db /mnt/HC_Volume_105354787
```

- Run LiveUpdates
```
# grpcurl -d '' -vv -plaintext -protoset /usr/local/share/deqs/deqs.protoset     127.0.0.1:7000 deqs.DeqsClientAPI.LiveUpdates
```

Which gives empty reply

```
Resolved method descriptor:
rpc LiveUpdates ( .deqs.LiveUpdatesRequest ) returns ( stream .deqs.LiveUpdate );

Request metadata to send:
(empty)
```

- Run SCI quote creation
```
MC_LOG=trace \
IAS_MODE=DEV \
SGX_MODE=SW deqs-test-cli \
   --rng-seed 1 submit-quotes \
   --deqs-uri insecure-deqs://127.0.0.1:7000 \
   --ledger-db /mnt/HC_Volume_105354787
```

Which errors out with ledger block incompatibility:

```
Generating 1 SCIs..., mc.app: deqs-test-cli, mc.module: deqs_test_cli, mc.src: test-cli/src/bin/main.rs:157
thread 'main' panicked at 'called `Result::unwrap()` on an `Err` value: Invalid block version: 3', /app/mc-test-utils/src/lib.rs:55:10
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

## Attempt 2: Compiling after updating mobilecoind to v6.1.1

> `Dockerfile`: Check the compilation details, which include fixes and patcihng, at `Dockerfile-mobilecoind-v611` in this folder.

You can build the binaries by running: 
```
docker build --tag deqs-mobilecoind-v611 . -f ./Dockerfile-mobilecoind-v611
```

This attempt doesn't compile yet. The current problem comes from the `schnorrkel` dependency: 

```
   Compiling proc-macro-crate v1.1.3
error[E0599]: no function or associated item named `from_bits` found for struct `Scalar` in the current scope
   --> /usr/local/cargo/git/checkouts/schnorrkel-e757aee99726fffa/b76d8c3/src/keys.rs:198:27
    |
198 |         let key = Scalar::from_bits(key);
    |                           ^^^^^^^^^ function or associated item not found in `Scalar`
    |
note: if you're trying to build a new `Scalar` consider using one of the following associated functions:
      Scalar::from_bytes_mod_order
      Scalar::from_bytes_mod_order_wide
      Scalar::random
      Scalar::hash_from_bytes
      and 2 others
   --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/curve25519-dalek-4.1.3/src/scalar.rs:237:5
    |
237 |       pub fn from_bytes_mod_order(bytes: [u8; 32]) -> Scalar {
    |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
250 |       pub fn from_bytes_mod_order_wide(input: &[u8; 64]) -> Scalar {
    |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
597 |       pub fn random<R: CryptoRngCore + ?Sized>(rng: &mut R) -> Self {
    |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
625 | /     pub fn hash_from_bytes<D>(input: &[u8]) -> Scalar
626 | |     where
627 | |         D: Digest<OutputSize = U64> + Default,
    | |______________________________________________^

error[E0599]: no function or associated item named `from_bits` found for struct `Scalar` in the current scope
   --> /usr/local/cargo/git/checkouts/schnorrkel-e757aee99726fffa/b76d8c3/src/keys.rs:527:27
    |
527 |         let key = Scalar::from_bits(key);
    |                           ^^^^^^^^^ function or associated item not found in `Scalar`
    |
note: if you're trying to build a new `Scalar` consider using one of the following associated functions:
      Scalar::from_bytes_mod_order
      Scalar::from_bytes_mod_order_wide
      Scalar::random
      Scalar::hash_from_bytes
      and 2 others
   --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/curve25519-dalek-4.1.3/src/scalar.rs:237:5
    |
237 |       pub fn from_bytes_mod_order(bytes: [u8; 32]) -> Scalar {
    |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
250 |       pub fn from_bytes_mod_order_wide(input: &[u8; 64]) -> Scalar {
    |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
597 |       pub fn random<R: CryptoRngCore + ?Sized>(rng: &mut R) -> Self {
    |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
625 | /     pub fn hash_from_bytes<D>(input: &[u8]) -> Scalar
626 | |     where
627 | |         D: Digest<OutputSize = U64> + Default,
    | |______________________________________________^

error[E0599]: no function or associated item named `from_bits` found for struct `Scalar` in the current scope
   --> /usr/local/cargo/git/checkouts/schnorrkel-e757aee99726fffa/b76d8c3/src/sign.rs:75:27
    |
 75 |         return Ok(Scalar::from_bits(bytes))
    |                           ^^^^^^^^^ function or associated item not found in `Scalar`
    |
note: if you're trying to build a new `Scalar` consider using one of the following associated functions:
      Scalar::from_bytes_mod_order
      Scalar::from_bytes_mod_order_wide
      Scalar::random
      Scalar::hash_from_bytes
      and 2 others
   --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/curve25519-dalek-4.1.3/src/scalar.rs:237:5
    |
237 |       pub fn from_bytes_mod_order(bytes: [u8; 32]) -> Scalar {
    |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
250 |       pub fn from_bytes_mod_order_wide(input: &[u8; 64]) -> Scalar {
    |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
597 |       pub fn random<R: CryptoRngCore + ?Sized>(rng: &mut R) -> Self {
    |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
625 | /     pub fn hash_from_bytes<D>(input: &[u8]) -> Scalar
626 | |     where
627 | |         D: Digest<OutputSize = U64> + Default,
    | |______________________________________________^

   Compiling sec1 v0.3.0
For more information about this error, try `rustc --explain E0599`.
error: could not compile `schnorrkel-og` (lib) due to 3 previous errors
warning: build failed, waiting for other jobs to finish...
Error: building at STEP "RUN cargo build --release --bin deqs-server": while running runtime: exit status 101
```
