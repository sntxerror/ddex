# MobileCoin Network Endpoints Research

Verified 2026-03-13.

## TestNet

| Service | Endpoint | Protocol | Status |
| --- | --- | --- | --- |
| Consensus Node 1 | `mc://node1.test.mobilecoin.com/` | gRPC (ports 443, 8443) | Reachable |
| Consensus Node 2 | `mc://node2.test.mobilecoin.com/` | gRPC (ports 443, 8443) | Reachable |
| Fog (gateway) | `fog.test.mobilecoin.com:443` | gRPC | Reachable |
| TX Source (Node 1) | `https://s3-us-west-1.amazonaws.com/mobilecoin.chain/node1.test.mobilecoin.com/` | HTTPS | S3 archive |
| TX Source (Node 2) | `https://s3-us-west-1.amazonaws.com/mobilecoin.chain/node2.test.mobilecoin.com/` | HTTPS | S3 archive |
| Enclave distribution | `https://enclave-distribution.test.mobilecoin.com/production.json` | HTTPS | 200 OK |
| Chain ID | `test` | | |

### Fog subdomains

`fog-view.test.mobilecoin.com`, `fog-ledger.test.mobilecoin.com`, and `fog-report.test.mobilecoin.com` do **not** resolve in public DNS. The individual Fog services (View, Ledger, Report, Ingest) are behind the single `fog.test.mobilecoin.com` gateway.

### Fog service roles

- **Fog Ingest** - processes blockchain, creates encrypted indexes using ORAM inside SGX. Emits Fog Reports with its public key.
- **Fog View** - helps users find their TxOuts based on PRNG indexes created by Ingest. Hosts ORAM inside SGX.
- **Fog Ledger** - key-image checks (is a TxOut spent?), Merkle proofs of membership for transaction construction. SGX + ORAM.
- **Fog Report** - hosts the Fog Report (public key record) so senders can encrypt recipient info for Fog Ingest.

### Browser access

Browsers cannot make native gRPC (HTTP/2 binary) calls. We need a **gRPC-Web proxy** (Envoy or similar) that translates:

- gRPC-Web (HTTP/1.1 + base64-encoded protobuf) from the browser
- to native gRPC (HTTP/2 + binary protobuf) toward Fog and consensus nodes

The proxy is stateless, holds no keys, and does not inspect user data.

## MainNet

| Service | Endpoint | Protocol |
| --- | --- | --- |
| Consensus Node 1 | `mc://node1.prod.mobilecoinww.com/` | gRPC |
| Consensus Node 2 | `mc://node2.prod.mobilecoinww.com/` | gRPC |
| TX Source (Node 1) | `https://ledger.mobilecoinww.com/node1.prod.mobilecoinww.com/` | HTTPS |
| TX Source (Node 2) | `https://ledger.mobilecoinww.com/node2.prod.mobilecoinww.com/` | HTTPS |
| Enclave distribution | `https://enclave-distribution.prod.mobilecoin.com/production.json` | HTTPS |
| Chain ID | `main` | |

## Full-Service (reference wallet backend)

Docker images published per-network with pre-configured peer connections:

```bash
# TestNet
docker run -it -p 127.0.0.1:9090:9090 \
  --volume $(pwd)/testnet/fs-data:/data \
  mobilecoin/full-service:v2.10.7-testnet

# MainNet
docker run -it -p 127.0.0.1:9090:9090 \
  --volume $(pwd)/mainnet/fs-data:/data \
  mobilecoin/full-service:v2.10.7-mainnet
```

Manual run example (testnet):

```bash
mkdir -p ./testnet-dbs/
RUST_LOG=info,mc_connection=info,mc_ledger_sync=info ./full-service \
  --wallet-db ./testnet-dbs/wallet.db \
  --ledger-db ./testnet-dbs/ledger-db/ \
  --peer mc://node1.test.mobilecoin.com/ \
  --peer mc://node2.test.mobilecoin.com/ \
  --tx-source-url https://s3-us-west-1.amazonaws.com/mobilecoin.chain/node1.test.mobilecoin.com/ \
  --tx-source-url https://s3-us-west-1.amazonaws.com/mobilecoin.chain/node2.test.mobilecoin.com/ \
  --fog-ingest-enclave-css $(pwd)/ingest-enclave.css \
  --chain-id test
```

## SGX Enclave Measurements (v7.1.0 - latest)

### TestNet

| Enclave | MRENCLAVE |
| --- | --- |
| MRSIGNER | `bf7fa957a6a94acb588851bc8767e0ca57706c79f4fc2aa6bcb993012c3c386c` |
| consensus | `b31e1d01939df31d51855317eed5ab7be4e7c77bf13d51230e38c3f5cb9af332` |
| ingest | `0578f62dd30d92e31cb8d2df8e84ca216aaf12a5ffdea011042282b53a9e9a7a` |
| view | `3892a844d9ed7dd0f41027a43910935429bd36d82cc8dc1db2aba98ba7929dd1` |
| ledger | `57f5ba050d15d3e9c1cf19222e44a370fb64d8a683c9b33f3d433699ca2d58f2` |

### MainNet

| Enclave | MRENCLAVE |
| --- | --- |
| MRSIGNER | `2c1a561c4ab64cbc04bfa445cdf7bed9b2ad6f6b04d38d3137f3622b29fdb30e` |
| consensus | `b7b40b173c6e42db3d4ab54b8080440238726581ab2f4235e27c1475cf494592` |
| ingest | `0578f62dd30d92e31cb8d2df8e84ca216aaf12a5ffdea011042282b53a9e9a7a` |
| view | `57f5ba050d15d3e9c1cf19222e44a370fb64d8a683c9b33f3d433699ca2d58f2` |
| ledger | `3892a844d9ed7dd0f41027a43910935429bd36d82cc8dc1db2aba98ba7929dd1` |
