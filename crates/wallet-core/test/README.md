# About

This folder contains scripts that validate WASM output against official mobilecoind outputs.

### Testings keys derivation
```bash
# Compare account key + subaddress derivation against mobilecoind
test/keys.mjs "<MNEMONIC>"
```

### Testing MOB transaction build
```bash
# NOTE (kif): This step should not be necessary since I already generated a valid fixture. See next step
test/make_tx_fixture.mjs --mnemonic "<FUNDED_MNEMONIC>" --fee 100000000 --input-count 2 --monitor-id ce34041d5ab9e17bbfaac9e76335c5a8a17b2430f5825f3547d2542aec9d3b77 --keep-monitors --output ./test/tx_fixture.json

# Compare transaction from fixture file to build_transaction WASM function output
test/txgen.mjs ./test/tx_fixture.json
```