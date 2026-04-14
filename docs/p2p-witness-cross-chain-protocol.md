# P2P Witnessed Cross-Chain Protocol for DDEX

## Status

This document is a standalone engineering artifact for the ddex repository. It consolidates the current research, protocol analysis, and implementation direction for a non-custodial MobileCoin–Ethereum trading system built on top of the existing SCI workflow already implemented in ddex.

The intended audience is the engineering team building the wallet, orderbook, and cross-chain settlement logic.

---

## 1. Executive Summary

The recommended long-term direction for ddex is:

- use **SCI** as the MobileCoin-side settlement primitive,
- use an **Ethereum escrow contract** as the Ethereum-side lock,
- use a **client-swarm witness network** instead of a dedicated oracle backend,
- keep signing and wallet control **fully client-side** using the existing Rust → WASM transaction path.

In this model, every active node can act as:

1. a **wallet**,
2. a **P2P orderbook peer**, and
3. a **witness** that validates ETH and MobileCoin events for others.

This does not eliminate the oracle function. It **distributes** it across the app network.

### Why this path is attractive

- It avoids custody by a bridge operator.
- It fits the existing ddex MobileCoin SCI workflow.
- It preserves MobileCoin privacy on the MOB leg.
- It avoids a centralized oracle backend.
- It gives a natural path toward a P2P orderbook.

### What it is not

This is **not** a pure HTLC-based trustless atomic swap in the strongest possible sense. It is a **distributed-attestation protocol** in which a threshold of witness nodes validates the external-chain event.

That makes it materially more decentralized than a bridge or a single oracle, but still not identical to native same-chain settlement.

---

## 2. Research Basis

This plan is grounded in four sources of evidence:

### A. Verified ddex implementation state

The ddex codebase already proves the MobileCoin side of the flow end to end:

- account-key derivation,
- Fog balance sync,
- ring member and proof assembly,
- SCI creation,
- SCI filling,
- consensus submission,
- and visible balance changes after settlement.

Relevant code paths include:

- [crates/wallet-core/src/sci.rs](../crates/wallet-core/src/sci.rs)
- [crates/wallet-core/src/transaction/builder.rs](../crates/wallet-core/src/transaction/builder.rs)
- [crates/wallet-core/src/digestible.rs](../crates/wallet-core/src/digestible.rs)
- [frontend/src/screens/Test/WasmSCIE2ETest.tsx](../frontend/src/screens/Test/WasmSCIE2ETest.tsx)

### B. MobileCoin SCI and partial-fill design

The MobileCoin protocol provides:

- SCI via MCIP 31,
- optional partial-fill rules via MCIP 42,
- private transaction discovery via Fog,
- ring-signature-based sender privacy,
- and a natural fit for client-side signing.

### C. DEQS architecture

DEQS proves that SCI offers can be distributed and pruned in a peer-to-peer quote network. It is a strong reference for quote structure and quote lifecycle, even if the final ddex implementation does not depend on the DEQS daemon directly.

Reference:

- [docs/deqs-research/README.md](deqs-research/README.md)

### D. Antelope architecture experience

Antelope demonstrates a useful split of responsibilities for Ethereum watchers, MobileCoin watchers, background task processing, and service orchestration. The ddex design can reuse these lessons without inheriting a custodial backend model.

---

## 3. Problem Statement

We want a system where users can trade:

- MOB for ETH,
- ETH for MOB,
- and later potentially ERC-20 assets,

without:

- a centralized bridge custody model,
- a dedicated oracle backend,
- or surrendering wallet control to the server.

The key protocol limitation is:

> SCI can only directly enforce conditions inside the MobileCoin ledger.

That means a native MOB ↔ ETH swap requires something beyond SCI alone to bind the Ethereum and MobileCoin legs.

---

## 4. Feasible Architecture Options

| Option | Custody | Trust Model | Complexity | Fit for ddex |
| --- | --- | --- | --- | --- |
| Wrapped ETH on MobileCoin via bridge | Operator or federation custody | Bridge keys | Low to medium | Good for fast MVP, weak for trust minimization |
| Single backend oracle + SCI | No custody of traded assets | Central oracle trust | Medium | Feasible, but a single point of failure remains |
| Manual client-only verification | No custody | Counterparty honesty and local checks | Medium | Usable for manual swaps, weak in adversarial markets |
| **Client-swarm witness network + SCI + ETH escrow** | No custody | Threshold witness trust | Medium-high | **Best match for the P2P ddex vision** |
| Pure cryptographic HTLC atomic swap | No custody | Minimal trust | High | Research path, not the best implementation target today |

### Recommendation

The strongest practical direction for ddex is:

## SCI + Ethereum escrow + threshold witness attestations from the client swarm

---

## 5. Core Protocol Principle

The protocol should separate responsibilities cleanly:

### MobileCoin side

SCI locks the MOB being offered.

### Ethereum side

An escrow contract locks the ETH or ERC-20 value.

### Witness side

A threshold of witness nodes validates:

1. the ETH escrow has been funded correctly, and later
2. the MobileCoin SCI settlement actually landed.

Only when both legs are satisfied should the ETH escrow release funds.

---

## 6. Node Model

Every active ddex node should be able to perform three roles.

### 6.1 Wallet role

The node can:

- hold MobileCoin keys,
- hold Ethereum keys,
- build SCI locally,
- fill SCI locally,
- deploy or fund ETH escrow contracts,
- sign attestations.

### 6.2 Orderbook role

The node can:

- publish quotes,
- receive quotes from peers,
- expire quotes,
- mark quotes as dead after key-image spend,
- and gossip order status changes.

### 6.3 Witness role

The node can:

- independently verify Ethereum events,
- independently verify MobileCoin settlement,
- sign witness statements,
- and relay those statements to other peers.

---

## 7. Role Invariant

A simple rule keeps the protocol consistent:

> The party selling MOB is always the SCI maker.

That means:

- for **MOB → ETH**, the MOB seller creates the SCI,
- for **ETH → MOB**, the MOB seller still creates the SCI.

SCI remains the MobileCoin-side primitive regardless of economic direction.

---

## 8. Order Schema

Every quote should carry both trading terms and settlement metadata.

### 8.1 Trading fields

- order id
- maker side, sell MOB or buy MOB
- MOB amount
- ETH amount
- asset type, ETH or ERC-20
- quote expiry

### 8.2 MobileCoin fields

- SCI blob
- key image
- tombstone block
- maker receive-output parameters
- optional partial-fill flag, disabled in V1

### 8.3 Ethereum fields

- chain id
- token address if ERC-20
- escrow contract template version
- expected recipient
- timeout and refund conditions

### 8.4 Witness policy fields

- witness set version
- threshold, for example 3-of-5
- message format version
- attestation hash domain separator

---

## 9. Detailed Protocol Flow

## 9.1 MOB → ETH

Alice has MOB and wants ETH. Bob has ETH and wants MOB.

### Step 1: Alice creates the SCI

Alice's app:

1. derives MobileCoin keys locally,
2. syncs via Fog,
3. finds a spendable TxOut,
4. fetches ring members and membership proofs,
5. builds the required MobileCoin output for herself,
6. creates the SCI in WASM.

### Step 2: Alice publishes the order

The quote is gossiped through the P2P order network with the ETH escrow requirements and witness policy.

### Step 3: Bob funds the ETH escrow

Bob's Ethereum wallet module:

- deploys or interacts with the escrow contract,
- funds it with the required ETH amount,
- records the order id and settlement terms.

### Step 4: Witnesses verify the ETH leg

Witness nodes independently confirm:

- the correct contract is used,
- the correct amount is funded,
- the expected asset type matches,
- the intended recipient and order id match,
- and the funding transaction has sufficient confirmations.

Each witness then signs an **EscrowFunded** attestation.

### Step 5: Bob fills the SCI

Once the threshold is met, Bob's app fills the SCI locally and submits the MobileCoin settlement transaction.

### Step 6: Witnesses verify the MobileCoin leg

Witness nodes confirm that:

- the key image has been spent,
- the transaction reached consensus,
- the expected outputs are present.

They sign a **MobSettlementConfirmed** attestation.

### Step 7: ETH is released

The escrow contract releases funds to Alice when enough valid witness signatures are supplied.

If the MobileCoin leg does not complete before timeout, Bob gets a refund.

---

## 9.2 ETH → MOB

Alice has ETH and wants MOB. Bob has MOB and wants ETH.

This is the mirror flow, but Bob, the MOB seller, creates the SCI.

1. Bob creates and publishes the SCI.
2. Alice funds ETH escrow.
3. Witnesses validate the ETH funding.
4. Alice fills Bob's SCI on MobileCoin.
5. Witnesses validate MobileCoin settlement.
6. Bob receives ETH from escrow.

---

## 10. Implementation Concept for ddex

## 10.1 MobileCoin path

This should remain close to the already verified ddex implementation.

### Existing modules to keep and extend

- [crates/wallet-core/src/sci.rs](../crates/wallet-core/src/sci.rs)
- [crates/wallet-core/src/transaction/builder.rs](../crates/wallet-core/src/transaction/builder.rs)
- [crates/wallet-core/src/transaction/encode.rs](../crates/wallet-core/src/transaction/encode.rs)
- [crates/wallet-core/src/digestible.rs](../crates/wallet-core/src/digestible.rs)
- [frontend/src/screens/Test/WasmSCIE2ETest.tsx](../frontend/src/screens/Test/WasmSCIE2ETest.tsx)

### MobileCoin workflow inside the app

1. derive keys from mnemonic in Rust and WASM,
2. generate Fog-enabled addresses,
3. sync balances through Fog,
4. fetch ring samples and proofs,
5. create or fill SCI in WASM,
6. submit to MobileCoin consensus,
7. re-sync via Fog and update wallet state.

This path is already the most mature part of the stack and should not be re-architected unnecessarily.

## 10.2 Ethereum path

Add a dedicated wallet and contract layer that can:

- hold ETH or ERC-20 funds,
- deploy or fund escrow contracts,
- verify bytecode and parameters,
- detect claim and refund eligibility,
- submit release or refund calls.

## 10.3 P2P orderbook path

Add a peer transport that can:

- publish quotes,
- subscribe to quotes,
- gossip order status changes,
- relay witness attestations,
- handle quote expiry.

This can begin with a hybrid relay while preserving a future path to full peer gossip.

## 10.4 Witness engine

The witness engine should be a separate logical module with its own key pair.

### Important rule

Do not use the same key for:

- wallet ownership,
- quote signing,
- and witness attestations.

Separate keys reduce blast radius if any one function is compromised.

---

## 11. P2P Witness Implementation

This is the most security-critical subsystem.

## 11.1 Witness attestation format

Each witness message should include:

- message type,
- order id,
- chain id,
- tx hash,
- block number or ledger height,
- asset and amount,
- escrow contract address,
- expiry time,
- witness public key,
- signature over a domain-separated payload.

## 11.2 Threshold model

For V1, use a threshold witness set, such as:

- 3 of 5, or
- 5 of 9.

Only a valid threshold should be able to trigger ETH release.

## 11.3 Why the witness layer exists

Because MobileCoin consensus cannot directly verify Ethereum chain state. The witness layer is the translation mechanism between:

- public ETH state,
- and private MobileCoin-side SCI settlement.

---

## 12. Attack Resistance by Design

## 12.1 Sybil resistance

This is the most important design problem.

### Not safe enough

Do not rely on:

- anonymous one-device-one-vote,
- open voting by all peers,
- unrestricted witness participation.

### Recommended model

#### V1

Use a **permissioned witness public key set**.

That means:

- every app can verify,
- but only approved witness keys count toward release.

#### V2

Move toward **bonded witnesses**.

That means:

- witnesses lock value,
- false attestations become punishable,
- witness admission becomes more open while remaining costly to attack.

### Why this works

A Sybil attacker can spawn many fake clients, but they do not gain release authority unless they also control enough witness keys or enough economic stake.

## 12.2 Replay resistance

Every attestation must be bound to:

- a specific order id,
- a specific chain id,
- a specific escrow contract,
- and a specific expiry window.

That prevents old signatures from being reused against new orders.

## 12.3 Equivocation resistance

Witness signatures are attributable. If a node signs conflicting attestations for the same order, it can be removed or later slashed.

## 12.4 Eclipse and routing isolation

Mitigations should include:

- multiple peer connections,
- multiple ETH RPC sources,
- redundant MobileCoin network views,
- conservative acceptance rules.

A node should never trust one peer's settlement statement by itself.

## 12.5 RPC spoofing

Mitigate by:

- verifying contract bytecode hash locally,
- checking multiple RPC providers or self-hosted nodes,
- waiting for confirmation depth,
- rejecting parameter mismatches.

## 12.6 Front-running and theft

SCI already protects the MobileCoin side against direct theft. The ETH escrow must likewise be bound to the exact order terms and recipient so that funding the wrong contract or wrong order cannot release value incorrectly.

## 12.7 Spam and griefing

Mitigate by:

- signed quote messages,
- quote TTL,
- witness rate limits,
- bounded caches,
- optional local peer-quality scoring.

---

## 13. Security Caveats and Breach Scenarios

| Threat | Impact | Mitigation |
| --- | --- | --- |
| Witness Sybil swarm | Fake approval of ETH event | permissioned keys first, bonded witnesses later |
| Witness collusion | wrongful ETH release | sufficiently high threshold, diversity of operators |
| Ethereum reorg | false funding signal | wait required confirmations and include block number in attestation |
| Browser sleep or mobile suspend | poor witness liveness | dedicated witness mode, desktop-preferred witnesses |
| Client compromise | stolen wallet or witness authority | key separation, secure storage, rotation |
| Attestation withholding | delayed settlement | redundant witnesses, timeout and refund paths |
| RPC misconfiguration | bad ETH validation view | multi-source verification |
| Fog outage | wallet visibility disruption | clear degraded-mode UX, retry and resync logic |

### Important caveat

This design is safer than a bridge and more decentralized than a single oracle backend, but it is still a witness-trust model. It is not cryptographically identical to a pure native atomic swap.

---

## 14. Bottlenecks and UX Constraints

### MobileCoin bottlenecks

- Fog is a hard dependency for balance and settlement visibility.
- Ring member and proof acquisition adds latency before submission.
- Balance refresh requires another sync after submission.

### Ethereum bottlenecks

- confirmation wait dominates the UX,
- gas costs penalize small trades,
- the ETH leg is public and not privacy-preserving in the same way as MobileCoin.

### Client-network bottlenecks

- browser tabs are unreliable long-lived witnesses,
- mobile devices suspend aggressively,
- high witness quality may require desktop or semi-persistent peers.

---

## 15. Partial Fills Guidance

The first cross-chain release should be **all-or-nothing only**.

Reasons:

- one quote maps to one ETH escrow instance,
- witness logic stays simple,
- auditability is much better,
- refund semantics are straightforward.

Cross-chain partial fills should be deferred until the base protocol is mature.

---

## 16. Recommended Roadmap

### Phase 0

Already achieved in ddex:

- real SCI E2E flow,
- Fog integration,
- WASM signing,
- successful live MobileCoin submission.

### Phase 1

Build a cross-chain pilot:

- ETH escrow contract,
- ETH wallet integration,
- local ETH validation,
- fixed witness set,
- threshold attestation release.

### Phase 2

Add the P2P network layer:

- quote gossip,
- witness attestation gossip,
- local state persistence,
- desktop witness mode.

### Phase 3

Decentralize further:

- bonded witnesses,
- witness rotation,
- privacy routing improvements,
- partial fills later if justified.

---

## 17. Open Questions

1. Should ETH release verify witness signatures directly in the contract or through an aggregator relay?
2. What confirmation threshold is acceptable for the first supported EVM network?
3. What is the minimum threshold size that balances safety and latency?
4. How should witness keys be rotated without breaking old orders?
5. Should the first launch target only one EVM network, such as mainnet or Base?
6. Do we want a hybrid relay or solver to bootstrap the network while preserving the P2P protocol design?
7. What should the operational model be for long-lived high-availability witness nodes?

---

## 18. Final Recommendation

The best architecture for ddex is:

## wallet + orderbook + witness in every node

with:

- **SCI for MOB**,
- **ETH escrow for the EVM leg**,
- **threshold witness attestations from the client swarm**,
- **Fog + WASM kept as the core MobileCoin transaction workflow**.

This is the clearest path from the current ddex SCI MVP to a genuinely non-custodial cross-chain trading system that can later evolve into a full P2P network.
