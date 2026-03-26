# Envoy gRPC-Web Proxy

An Envoy proxy that provides a single HTTP endpoint for MobileCoin's gRPC services. Any client — browser frontends, backend services, CLI tools — can reach both testnet and mainnet Fog/Consensus through it. Envoy translates HTTP/1.1 (or HTTP/2) to upstream gRPC over TLS.

The proxy is stateless and can be deployed on a separate, isolated machine as shared infrastructure. Multiple instances can run behind a load balancer for redundancy.

## Why a proxy?

Browsers cannot make native gRPC calls (HTTP/2 with trailers), so they need a gRPC-Web gateway. But the proxy is useful beyond browsers — it centralizes TLS termination, DNS resolution, and routing to MobileCoin nodes so that backend services don't each need their own gRPC client config. Envoy has first-class support for this via its `grpc_web` HTTP filter and handles both gRPC-Web and standard gRPC clients transparently.

## Architecture

```text
Clients (browser, backend service, curl, etc.)
  │  HTTP/1.1 (gRPC-Web) or HTTP/2 (gRPC)
  ▼
Envoy  :8080  (plain HTTP listener)
  │  ┌──────────── route prefix ────────────┐
  │  │  /test/fog/*        → fog_test       │
  │  │  /test/consensus/*  → consensus_test │
  │  │  /prod/fog/*        → fog_prod       │
  │  │  /prod/consensus/*  → consensus_prod │
  │  └──────────────────────────────────────┘
  ▼
MobileCoin nodes (gRPC / HTTP/2 + TLS :443)
```

## MobileCoin services

### Fog

Fog is MobileCoin's privacy-preserving balance and transaction lookup service. It runs inside Intel SGX enclaves so the server operator cannot see which transactions belong to which user. The wallet sends an encrypted request; Fog returns encrypted transaction outputs (TxOuts) that only the wallet's private keys can decrypt.

- **Testnet**: `fog.test.mobilecoin.com:443`
- **Mainnet**: `fog.prod.mobilecoinww.com:443`

### Consensus

Consensus nodes validate and commit transactions to the MobileCoin blockchain. The wallet builds and signs transactions locally (private keys never leave the browser), then submits the opaque serialized bytes to a consensus node. The node validates the transaction cryptographically without ever seeing the sender, receiver, or amount.

- **Testnet**: `node1.test.mobilecoin.com:443`
- **Mainnet**: `node1.prod.mobilecoinww.com:443`

## Routing

Each route uses `prefix_rewrite: "/"` to strip the network/service prefix before forwarding. For example:

```text
POST /test/fog/fog_common.FogKeyImageService/CheckKeyImages
  → upstream fog.test.mobilecoin.com:443 /fog_common.FogKeyImageService/CheckKeyImages
```

Both testnet and mainnet are available simultaneously — the frontend chooses which prefix to call.

## Env var templating

Envoy doesn't natively support environment variables in its YAML config. We work around this with `envsubst`:

1. `envoy.yaml` contains `${...}` placeholders (e.g., `${MC_TEST_FOG_HOST}`)
2. The [Dockerfile](Dockerfile) adds `gettext-base` (provides `envsubst`) to the Envoy image
3. [docker-compose.yml](docker-compose.yml) mounts envoy.yaml as a template and runs `envsubst` to produce the final config at container startup
4. Variables are defined in the root [.env](../.env.example) file

## CORS

The browser enforces same-origin policy. Since the frontend (e.g., `localhost:5173`) and Envoy (`localhost:8080`) are different origins, CORS headers are required. The config uses `CorsPolicy` in `typed_per_filter_config` on the virtual host to allow:

- **Origins**: `*` (any — fine for dev; tighten for production)
- **Headers**: gRPC-Web specific headers (`x-grpc-web`, `grpc-timeout`, `content-type`, etc.)
- **Exposed headers**: `grpc-status`, `grpc-message`, `grpc-status-details-bin` — these carry gRPC response metadata and must be readable by the browser

## HTTP filters (order matters)

1. **`grpc_web`** — decodes gRPC-Web framing into standard gRPC framing
2. **`cors`** — handles CORS preflight (`OPTIONS`) and adds response headers
3. **`router`** — actually routes the request to the matched cluster

## Cluster TLS

Each cluster has a `transport_socket` with `UpstreamTlsContext` + SNI. This means:

- Envoy initiates TLS to the upstream (the browser never does — it talks plain HTTP to Envoy)
- SNI tells the remote server which hostname the client intended (required when multiple services share an IP)
- The `STRICT_DNS` type resolves the hostname and load-balances across all returned IPs

## Running locally

```bash
# Start (builds the image on first run)
cd proxy
docker compose up --build

# Test all 4 routes
./test.sh

# Test against Codespace
./test.sh https://bug-free-eureka-r4pprjq5gp52gq4-8080.app.github.dev

# Logs
docker compose logs -f envoy

# Stop
docker compose down
```

`test.sh` sends a gRPC-Web request (`report.ReportAPI/GetReports` for Fog, `consensus_common.BlockchainAPI/GetLastBlockInfo` for Consensus) to each of the 4 routes and expects HTTP 200. Pass a custom base URL as the first argument to test a remote instance.

## Deployment

The proxy is a single stateless container. It can run:

- **Locally** — on the same machine as the frontend/backend during development
- **Codespaces** — port 8080 is auto-forwarded with HTTPS; the frontend detects `*.app.github.dev` URLs and adjusts automatically (see `proxyLogger.ts`)
- **Standalone server** — deployed on an isolated machine as shared infrastructure for multiple clients; point `VITE_PROXY_URL` or your backend config at its address
- **Redundant** — run multiple instances behind a load balancer; Envoy is stateless so any instance can serve any request

