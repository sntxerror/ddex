#!/bin/bash

# Script to generate MobileCoin keys from a mnemonic using the official mobilecoind JSON API
# This allows you to verify that your WASM-generated keys match the official API

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Safely read a top-level field from JSON input.
# Returns an empty string if the input is not valid JSON or the field is missing.
json_get_field() {
    local field_name="$1"
    python3 -c '
import json
import sys

field = sys.argv[1]
try:
    data = json.load(sys.stdin)
    value = data.get(field, "")
    if value is None:
        value = ""
    print(value)
except Exception:
    print("")
' "$field_name"
}

# Convert lowercase/uppercase hex into a decimal byte array like JS Uint8Array display.
# Example: "0a01ff" -> "10,1,255"
hex_to_byte_array() {
    local hex_value="$1"
    python3 -c '
import re
import sys

value = (sys.argv[1] or "").strip().lower()
if not re.fullmatch(r"[0-9a-f]*", value) or len(value) % 2 != 0:
    print("")
    raise SystemExit(0)

nums = [str(int(value[i:i+2], 16)) for i in range(0, len(value), 2)]
print(",".join(nums))
' "$hex_value"
}

# Configuration - adjust these to match your mobilecoind-json setup
# You can also set these as environment variables:
#   export MOBILECOIND_HOST=your-host
#   export MOBILECOIND_PORT=your-port
MOBILECOIND_HOST="${MOBILECOIND_HOST:-localhost}"
MOBILECOIND_PORT="${MOBILECOIND_PORT:-9090}"
API_URL="http://${MOBILECOIND_HOST}:${MOBILECOIND_PORT}"

print_info "Connecting to mobilecoind JSON API at: ${API_URL}"

# Check if mnemonic is provided
if [ $# -eq 0 ]; then
    print_error "Usage: $0 '<mnemonic phrase>' [--offline]"
    echo ""
    echo "Options:"
    echo "  --offline    Generate entropy only (don't connect to mobilecoind API)"
    echo ""
    echo "Example:"
    echo "  $0 'muffin rare crime tired ginger rice jump output luxury submit way search upon glass tenant electric bargain apology right promote divide myth minute invest'"
    echo ""
    echo "  $0 'muffin rare crime tired ginger rice jump output luxury submit way search upon glass tenant electric bargain apology right promote divide myth minute invest' --offline"
    exit 1
fi

MNEMONIC="$1"
OFFLINE_MODE=false

if [ "$2" = "--offline" ]; then
    OFFLINE_MODE=true
    print_warning "Offline mode: Will only generate entropy, not full keys"
fi

print_info "Generating keys from mnemonic..."
print_info "Mnemonic: ${MNEMONIC:0:50}..."

# Step 1: Convert mnemonic to entropy using Python
print_info "Step 1: Converting mnemonic to entropy..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Use the Python script to convert mnemonic to entropy
ENTROPY=$(/Users/kif/dev/vast/venv/bin/python "${SCRIPT_DIR}/mnemonic_to_entropy.py" "$MNEMONIC" 2>&1)

if [ $? -ne 0 ]; then
    print_error "Failed to convert mnemonic to entropy"
    echo "$ENTROPY"
    exit 1
fi

print_info "Entropy: $ENTROPY"

# If offline mode, just print the entropy and exit
if [ "$OFFLINE_MODE" = true ]; then
    echo ""
    echo "========================================"
    echo "  OFFLINE MODE - ENTROPY ONLY"
    echo "========================================"
    echo ""
    echo "MNEMONIC:"
    echo "  $MNEMONIC"
    echo ""
    echo "ENTROPY (hex):"
    echo "  $ENTROPY"
    echo ""
    echo "========================================"
    echo ""
    print_info "Use this entropy with your WASM code or mobilecoind API"
    exit 0
fi

# Step 2: Generate account keys from entropy using mobilecoind JSON API
print_info "Step 2: Generating account keys from entropy via mobilecoind JSON API..."

KEYS_RESPONSE=$(curl -s -w "\n%{http_code}" "${API_URL}/entropy/${ENTROPY}")
HTTP_CODE="${KEYS_RESPONSE##*$'\n'}"
KEYS_RESPONSE="${KEYS_RESPONSE%$'\n'*}"

if [ "$HTTP_CODE" != "200" ]; then
    print_error "Failed to connect to mobilecoind JSON API at ${API_URL}"
    print_error "HTTP Status Code: $HTTP_CODE"
    print_error "Response: $KEYS_RESPONSE"
    print_error ""
    print_error "Make sure mobilecoind-json is running and accessible"
    print_error "You can set custom host/port with:"
    print_error "  MOBILECOIND_HOST=your-host MOBILECOIND_PORT=your-port $0 '$MNEMONIC'"
    exit 1
fi

# Parse the JSON response
VIEW_PRIVATE_KEY=$(echo "$KEYS_RESPONSE" | json_get_field "view_private_key")
SPEND_PRIVATE_KEY=$(echo "$KEYS_RESPONSE" | json_get_field "spend_private_key")

if [ -z "$VIEW_PRIVATE_KEY" ] || [ -z "$SPEND_PRIVATE_KEY" ]; then
    print_error "Failed to parse keys from API response"
    echo "Response: $KEYS_RESPONSE"
    exit 1
fi

print_info "View Private Key:  $VIEW_PRIVATE_KEY"
print_info "Spend Private Key: $SPEND_PRIVATE_KEY"

# Step 3: Create a monitor to get the public address
print_info "Step 3: Creating monitor to get public address..."

MONITOR_RESPONSE=$(curl -s -w "\n%{http_code}" "${API_URL}/monitors" \
  -d "{\"account_key\": {\"view_private_key\":\"${VIEW_PRIVATE_KEY}\", \"spend_private_key\":\"${SPEND_PRIVATE_KEY}\"}, \"first_subaddress\": 0, \"num_subaddresses\": 1}" \
  -X POST \
  -H 'Content-Type: application/json')

HTTP_CODE="${MONITOR_RESPONSE##*$'\n'}"
MONITOR_RESPONSE="${MONITOR_RESPONSE%$'\n'*}"

if [ "$HTTP_CODE" != "200" ]; then
    print_error "Failed to create monitor"
    print_error "HTTP Status Code: $HTTP_CODE"
    print_error "Response: $MONITOR_RESPONSE"
    exit 1
fi

MONITOR_ID=$(echo "$MONITOR_RESPONSE" | json_get_field "monitor_id")

if [ -z "$MONITOR_ID" ]; then
    print_error "Failed to create monitor"
    echo "Response: $MONITOR_RESPONSE"
    exit 1
fi

print_info "Monitor ID: $MONITOR_ID"

# Step 4: Get the public address for subaddress 0
print_info "Step 4: Getting public address for subaddress 0..."

ADDRESS_RESPONSE=$(curl -s -w "\n%{http_code}" "${API_URL}/monitors/${MONITOR_ID}/subaddresses/0/public-address")

HTTP_CODE="${ADDRESS_RESPONSE##*$'\n'}"
ADDRESS_RESPONSE="${ADDRESS_RESPONSE%$'\n'*}"

if [ "$HTTP_CODE" != "200" ]; then
    print_error "Failed to get public address"
    print_error "HTTP Status Code: $HTTP_CODE"
    print_error "Response: $ADDRESS_RESPONSE"
    exit 1
fi

# Parse the address response
VIEW_PUBLIC_KEY=$(echo "$ADDRESS_RESPONSE" | json_get_field "view_public_key")
SPEND_PUBLIC_KEY=$(echo "$ADDRESS_RESPONSE" | json_get_field "spend_public_key")
B58_ADDRESS=$(echo "$ADDRESS_RESPONSE" | json_get_field "b58_address_code")

VIEW_PRIVATE_KEY_BYTES=$(hex_to_byte_array "$VIEW_PRIVATE_KEY")
SPEND_PRIVATE_KEY_BYTES=$(hex_to_byte_array "$SPEND_PRIVATE_KEY")
VIEW_PUBLIC_KEY_BYTES=$(hex_to_byte_array "$VIEW_PUBLIC_KEY")
SPEND_PUBLIC_KEY_BYTES=$(hex_to_byte_array "$SPEND_PUBLIC_KEY")

if [ -z "$VIEW_PUBLIC_KEY" ] || [ -z "$SPEND_PUBLIC_KEY" ]; then
    print_error "Failed to parse public address from API response"
    echo "Response: $ADDRESS_RESPONSE"
    exit 1
fi

# Step 5: Clean up - remove the monitor
print_info "Step 5: Cleaning up monitor..."
curl -s -X DELETE "${API_URL}/monitors/${MONITOR_ID}" > /dev/null 2>&1 || true

# Print summary
echo ""
echo "========================================"
echo "  MOBILECOIND JSON API GENERATED KEYS"
echo "========================================"
echo ""
echo "MNEMONIC:"
echo "  $MNEMONIC"
echo ""
echo "ENTROPY:"
echo "  $ENTROPY"
echo ""
echo "PRIVATE KEYS:"
echo "  View Private Key:  $VIEW_PRIVATE_KEY"
echo "  Spend Private Key: $SPEND_PRIVATE_KEY"
echo ""
echo "PUBLIC KEYS (Subaddress 0):"
echo "  View Public Key:   $VIEW_PUBLIC_KEY"
echo "  Spend Public Key:  $SPEND_PUBLIC_KEY"
echo ""
echo "WASM-STYLE BYTE ARRAYS:"
echo "  View Private Key:  [$VIEW_PRIVATE_KEY_BYTES]"
echo "  Spend Private Key: [$SPEND_PRIVATE_KEY_BYTES]"
echo "  View Public Key:   [$VIEW_PUBLIC_KEY_BYTES]"
echo "  Spend Public Key:  [$SPEND_PUBLIC_KEY_BYTES]"
echo ""
echo "B58 ADDRESS:"
echo "  $B58_ADDRESS"
echo ""
echo "========================================"
echo ""
print_info "You can now compare these keys with your WASM-generated keys"
print_info "Use the entropy '$ENTROPY' with your WASM code to verify the derivation matches"
