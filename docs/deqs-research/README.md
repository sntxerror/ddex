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

This attempt doesn't compile yet. The current problem comes from the `value-bag-1.0.0-alpha.9` dependency and the newer Rust compiler semantics used:

```
error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:72:21
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
72 |             usize: (USIZE, OPTION_USIZE),
   |                     ^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:72:28
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
72 |             usize: (USIZE, OPTION_USIZE),
   |                            ^^^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:73:18
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
73 |             u8: (U8, OPTION_U8),
   |                  ^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:73:22
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
73 |             u8: (U8, OPTION_U8),
   |                      ^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:74:19
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
74 |             u16: (U16, OPTION_U16),
   |                   ^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:74:24
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
74 |             u16: (U16, OPTION_U16),
   |                        ^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:75:19
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
75 |             u32: (U32, OPTION_U32),
   |                   ^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:75:24
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
75 |             u32: (U32, OPTION_U32),
   |                        ^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:76:19
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
76 |             u64: (U64, OPTION_U64),
   |                   ^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:76:24
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
76 |             u64: (U64, OPTION_U64),
   |                        ^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:77:20
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
77 |             u128: (U128, OPTION_U128),
   |                    ^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:77:26
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
77 |             u128: (U128, OPTION_U128),
   |                          ^^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:79:21
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
79 |             isize: (ISIZE, OPTION_ISIZE),
   |                     ^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:79:28
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
79 |             isize: (ISIZE, OPTION_ISIZE),
   |                            ^^^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:80:18
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
80 |             i8: (I8, OPTION_I8),
   |                  ^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:80:22
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
80 |             i8: (I8, OPTION_I8),
   |                      ^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:81:19
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
81 |             i16: (I16, OPTION_I16),
   |                   ^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:81:24
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
81 |             i16: (I16, OPTION_I16),
   |                        ^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:82:19
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
82 |             i32: (I32, OPTION_I32),
   |                   ^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:82:24
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
82 |             i32: (I32, OPTION_I32),
   |                        ^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:83:19
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
83 |             i64: (I64, OPTION_I64),
   |                   ^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:83:24
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
83 |             i64: (I64, OPTION_I64),
   |                        ^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:84:20
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
84 |             i128: (I128, OPTION_I128),
   |                    ^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:84:26
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
84 |             i128: (I128, OPTION_I128),
   |                          ^^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:86:19
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
86 |             f32: (F32, OPTION_F32),
   |                   ^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:86:24
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
86 |             f32: (F32, OPTION_F32),
   |                        ^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:87:19
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
87 |             f64: (F64, OPTION_F64),
   |                   ^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:87:24
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
87 |             f64: (F64, OPTION_F64),
   |                        ^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:89:20
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
89 |             char: (CHAR, OPTION_CHAR),
   |                    ^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:89:26
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
89 |             char: (CHAR, OPTION_CHAR),
   |                          ^^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:90:20
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
90 |             bool: (BOOL, OPTION_BOOL),
   |                    ^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:90:26
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
90 |             bool: (BOOL, OPTION_BOOL),
   |                          ^^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:92:28
   |
32 |                             const $const_ident: TypeId = TypeId::of::<$ty>();
   |                             -------------------------- constant defined here
...
92 |             &'static str: (STATIC_STR, OPTION_STATIC_STR),
   |                            ^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:92:40
   |
35 |                             const $option_ident: TypeId = TypeId::of::<Option<$ty>>();
   |                             --------------------------- constant defined here
...
92 |             &'static str: (STATIC_STR, OPTION_STATIC_STR),
   |                                        ^^^^^^^^^^^^^^^^^ can't be used in patterns
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details

error: function pointers and raw pointers not derived from integers in patterns behave unpredictably and should not be relied upon
  --> /usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.0.0-alpha.9/src/internal/cast/primitive.rs:55:29
   |
38 |                           const STR: TypeId = TypeId::of::<str>();
   |                           ----------------- constant defined here
...
55 |                               STR => |v| Some(Internal::from(unsafe { &**(v as *const &'a Self as *const &'a str) })),
   |                               ^^^ can't be used in patterns
...
71 | /         to_internal![
72 | |             usize: (USIZE, OPTION_USIZE),
73 | |             u8: (U8, OPTION_U8),
74 | |             u16: (U16, OPTION_U16),
...  |
96 | |             String: (STRING, OPTION_STRING),
97 | |         ];
   | |_________- in this macro invocation
   |
   = note: see https://github.com/rust-lang/rust/issues/70861 for details
   = note: this error originates in the macro `to_internal` (in Nightly builds, run with -Z macro-backtrace for more info)

   Compiling zerovec-derive v0.11.3
error: could not compile `value-bag` (lib) due to 35 previous errors
warning: build failed, waiting for other jobs to finish...
Error: building at STEP "RUN cargo +nightly-2026-01-01 build --release --bin deqs-server": while running runtime: exit status 101
```
