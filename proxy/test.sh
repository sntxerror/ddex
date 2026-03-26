#!/usr/bin/env bash
# Test all proxy routes with gRPC-Web requests.
# Usage: ./test.sh [base_url]
#   base_url defaults to http://localhost:8080

set -uo pipefail

BASE="${1:-http://localhost:8080}"
# gRPC length-prefixed empty message: 1 zero byte (compression flag) + 4 zero bytes (length)
FRAME_FILE=$(mktemp)
printf '\x00\x00\x00\x00\x00' > "$FRAME_FILE"
trap 'rm -f "$FRAME_FILE"' EXIT

pass=0
fail=0

test_route() {
  local prefix="$1" method="$2" label="$3"
  local url="${BASE}/${prefix}/${method}"
  local http_code
  http_code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 \
    -X POST \
    -H 'Content-Type: application/grpc-web+proto' \
    -H 'X-Grpc-Web: 1' \
    --data-binary @"$FRAME_FILE" \
    "$url" 2>/dev/null) || http_code="000"

  if [[ "$http_code" == "200" ]]; then
    echo "  OK   $label  ($http_code)"
    pass=$((pass + 1))
  else
    echo "  FAIL $label  ($http_code)  $url"
    fail=$((fail + 1))
  fi
}

test_route "test/fog"       "report.ReportAPI/GetReports"                       "Testnet Fog"
test_route "test/consensus" "consensus_common.BlockchainAPI/GetLastBlockInfo"    "Testnet Consensus"
test_route "prod/fog"       "report.ReportAPI/GetReports"                       "Mainnet Fog"
test_route "prod/consensus" "consensus_common.BlockchainAPI/GetLastBlockInfo"    "Mainnet Consensus"

echo ""
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
