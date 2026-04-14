# Technical report on getting a workable deqs-server deployed

## Context

We are trying to deploy [deqs-server](https://github.com/mobilecoinofficial/deqs) to be able to add the SCI `SubmitQuotes → GetQuotes → LiveUpdates → key-image cleanup` flow into the DDEX MVP app.

The `deqs-server` hasn't been updated for 3 years, the last commit was `commit 948f212a9c1ad8cd5495d36f4b7d2139e2556bbd` dated `Thu Apr 20 10:21:59 2023 -0600`.

In order to compile the binaries of the project again, the submodule dependency on [mobilecoind](https://github.com/mobilecoinfoundation/mobilecoin) had to be updated to [v6.1.1](https://github.com/mobilecoinfoundation/mobilecoin/tree/v6.1.1).

## Overview of deployment artifacts

> `Dockerfile`: Check the compilation details, which include fixes and patcihng, in the `Dockerfile` in this folder.

The binaries can be built by running:
```
docker build --tag deqs . -f ./Dockerfile
```

The following files were moved manually to the server after compiling through the Dockerfile:
- Ledger file: `data.mdb`. In the deployment, it stays in a separate drive currently mounted at `/mnt/HC_Volume_105354787`.
- Commands `deqs-server`, `deqs-liquidity-bot`, `mobilecoind` and `mobilecoind-json` were manually moved to `/usr/local/bin`.
- The compile protoset file `deqs.protoset` was manually moved to `/usr/local/share/deqs/`.
- The `ingest-enclave.css` was manually moved to `/usr/local/share/mobilecoind/`

This means that the current deployment only uses Docker for the compilation stage. All the files and binaries are running natively in the server instance.

## How to run the commands in the current public deployment

> `NOTE`: All the services below running in `tmux` sessions will be eventually configured as `systemd service units`. To detach from a running tmux session with `ctrl+b` then `d`.

### Connecting to public server

SSH into the deployment machine at `65.108.52.51`
```
ssh root@65.108.52.51
```

### Running `mobilecoind`

`mobilecoind` should be running inside a `tmux` session:
```
tmux attach-session -t mobilecoind
```

If the service is not running, or you decide to stop it to run again, start it with
```
mobilecoind \
   --ledger-db /mnt/synced-ledger-db \
   --poll-interval 10 \
   --peer mc://node1.prod.mobilecoinww.com/ \
   --peer mc://node2.prod.mobilecoinww.com/ \
   --chain-id main \
   --tx-source-url https://ledger.mobilecoinww.com/node1.prod.mobilecoinww.com/ \
   --tx-source-url https://ledger.mobilecoinww.com/node2.prod.mobilecoinww.com/ \
   --mobilecoind-db /usr/local/share/mobilecoind/transaction-db-prod \
   --fog-ingest-enclave-css /usr/local/share/mobilecoind/ingest-enclave.css \
   --listen-uri insecure-mobilecoind://127.0.0.1:4444/
```

### Running `deqs-server`

`deqs-server` should be running inside a `tmux` session:
```
tmux attach-session -t deqs-server
```

If the service is not running, or you decide to stop it to run again, start it with
```
MC_LOG=trace \
IAS_MODE=DEV \
SGX_MODE=SW deqs-server \
  --client-listen-uri insecure-deqs://127.0.0.1:7000 \
  --db-path /tmp/quotes.db \
  --ledger-db /mnt/synced-ledger-db
```

### Running `LiveUpdates`

Before creating any SCIs, you can run the `LiveUpdates` endpoint to receive new SCI creation posts:
```
# grpcurl -d '' -vv -plaintext -protoset /usr/local/share/deqs/deqs.protoset     127.0.0.1:7000 deqs.DeqsClientAPI.LiveUpdates
```

### Running `deqs-liquidity-bot`

To create SCIs to exchange 1 MOB for 2 eUSD, we run:
```
deqs-liquidity-bot \
    --deqs insecure-deqs://127.0.0.1:7000 \
    --base-token-id 0 \
    --counter-token-id 1 \
    --swap-rate 2 \
    --ledger-db /mnt/synced-ledger-db \
    --account-key /usr/local/share/deqs/key.json \
    --wallet-db /usr/local/share/deqs/wallet.db \
    --admin-listen-uri insecure-mca://0.0.0.0:9090/
```

This will create an SCI for each TxOut the account holds.

To check whether some TxOut is pending of being included in an SCI, we query `GetPendingTxOuts`(if empty, all of them should appear in `GetListedTxOuts`):
```
grpcurl -plaintext \
  -protoset /usr/local/share/deqs/liquidity-bot-admin.protoset \
  localhost:9090 deqs.DeqsLiquidityBotAdminAPI.GetPendingTxOuts
```

To see the transaction included in SCIs, we query `GetListedTxOuts`:
```
grpcurl -plaintext \
  -protoset /usr/local/share/deqs/liquidity-bot-admin.protoset \
  localhost:9090 deqs.DeqsLiquidityBotAdminAPI.GetListedTxOuts
```

To see the Quotes to exchange MOB for eUSD created by DEQS, we run `GetQuotes` with:
```
grpcurl -plaintext -protoset /usr/local/share/deqs/deqs.protoset \
    -d '{"pair": {"base_token_id": 0, "counter_token_id": 1}, "base_range_min": 0, "base_range_max": "18446744073709551615", "limit": 100}' \
    localhost:7000 deqs.DeqsClientAPI.GetQuotes
```

#### How does the liquidity bot work?

The liquidity bot works with a specific key file with Mobilecoin credentials and self managed wallet file. The key file has the following shape:
The account-key file needs the following shape:
```
{
  "mnemonic": "word1 word2 word3 ... word24",
  "account_index": 0,
  "fog_report_url": null,
  "fog_report_id": null,
  "fog_authority_spki": null
}
```

To run SCIs for different users, we would have to manage these as separate files and properly link to them when running the liquidity bot service for each user.

It is important to reiterate, that the current bot mode of operation is to create an SCI for each TxOut owned by the account holder. The bot code can be used for future steps where we would like control about which specific quantity to swap for another coin.

### Next steps

To integrate DDEX with DEQS the next steps are:

- Create shim server to proxy HTTPS requests to command line.
