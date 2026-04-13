# Technical report on getting a workable deqs-server deployed

## Context

We are trying to deploy [deqs-server](https://github.com/mobilecoinofficial/deqs) to be able to add the SCI `SubmitQuotes → GetQuotes → LiveUpdates → key-image cleanup` flow into the DDEX MVP app.

The `deqs-server` hasn't been updated for 3 years, the last commit was `commit 948f212a9c1ad8cd5495d36f4b7d2139e2556bbd` dated `Thu Apr 20 10:21:59 2023 -0600`. As we'll see after compiling with `attempt 1`, the ecosystem has moved on and the project is in a bitrotten state.

## Attempts to compile and run `deqs-server`

### Attempt 1: Compiling from last commit

> `Dockerfile`: Check the compilation details at `Dockerfile-last-commit` in this folder.

You can build the binaries by running:
```
docker build --tag deqs-latest-commit . -f ./Dockerfile-last-commit
```

### Attempt 2: Compiling after updating mobilecoind to v6.1.1

> `Dockerfile`: Check the compilation details, which include fixes and patcihng, at `Dockerfile-mobilecoind-v611` in this folder.

You can build the binaries by running:
```
docker build --tag deqs-mobilecoind-v611 . -f ./Dockerfile-mobilecoind-v611
```

This attempt currently compiles, pending of runtime errors check.

## Overview of deployment artifacts

The following files were moved manually to the server after compiling through the Dockerfile:
- Ledger file: `data.mdb`. In the deployment, it stays in a separate drive currently mounted at `/mnt/HC_Volume_105354787`.
- Commands `deqs-server`, `deqs-liquidity-bot`, `mobilecoind` and `mobilecoind-json` were manually moved to `/usr/local/bin`.
- The compile protoset file `deqs.protoset` was manually moved to `/usr/local/share/deqs/`.
- The `ingest-enclave.css` was manually moved to `/usr/local/share/mobilecoind/`

This means that the current deployment only uses Docker for the compilation stage. All the files and binaries are running natively in the server instance.

## How to run the commands in the current public deployment

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

Which errors out with stale quote message:

```
2026-04-13 01:48:49.578425491 UTC INFO deqs-test-cli started: { "GIT_COMMIT": "948f212-modified", "MOBILECOIN_GIT_COMMIT": "v6.0.2-10-gc18a29126", "PROFILE": "release", "DEBUG": "false", "OPT_LEVEL": "3", "DEBUG_ASSERTIONS": "false", "TARGET_ARCH": "x86_64", "TARGET_OS": "linux", "TARGET_FEATURE": "fxsr,sse,sse2,x87", "RUSTFLAGS": "?", "SGX_MODE": "SW" }, mc.app: deqs-test-cli, mc.module: mc_common::logger::loggers, mc.src: mobilecoin/common/src/logger/loggers/mod.rs:235
2026-04-13 01:48:49.578494783 UTC WARN Creating insecure gRPC connection to 127.0.0.1:7000, mc.app: deqs-test-cli, mc.module: mc_util_grpc::grpcio_extensions, mc.src: mobilecoin/util/grpc/src/grpcio_extensions.rs:48
2026-04-13 01:48:49.578528792 UTC INFO Ledger db is currently at version: MetadataVersion { database_format_version: 20220921, created_by_crate_version: "6.1.1", _s: LedgerDbMetadataStoreSettings }, mc.app: deqs-test-cli, mc.module: mc_ledger_db::ledger_db, mc.src: mobilecoin/ledger/db/src/ledger_db.rs:446
2026-04-13 01:48:49.578554728 UTC INFO Generating 1 SCIs..., mc.app: deqs-test-cli, mc.module: deqs_test_cli, mc.src: test-cli/src/bin/main.rs:157
2026-04-13 01:48:49.758573714 UTC INFO Submitting 1 SCIs..., mc.app: deqs-test-cli, mc.module: deqs_test_cli, mc.src: test-cli/src/bin/main.rs:186
status_codes: QUOTE_IS_STALE
error_messages: "Quote has a spent keyimage"
quotes {
}
```

### Next steps

`deqs-test-cli` does not help with creating real quotes, it's meant only for testing purposes.

To integrate with DEQS the next steps are:

- Deploy mobilecoind and let it running to have a synced ledger database locally accessible.
- Prepare documentation on how to use `deqs-liquidity-bot`
- Create shim server to proxy HTTPS requests to command line.
