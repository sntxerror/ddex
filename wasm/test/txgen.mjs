#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import init, { build_transaction } from '../pkg/wasm.js';

function parseArgs(argv) {
  const fixturePath = (argv[0] || process.env.BUILD_TX_FIXTURE_PATH || '').trim();
  if (!fixturePath) {
    throw new Error('Usage: node test/compare_build_tx_wasm_vs_mobilecoind.mjs <fixture-path>');
  }
  return fixturePath;
}

function normalizeHex(value) {
  return String(value || '').trim().toLowerCase().replace(/^0x/, '');
}

function bytesToHex(bytes) {
  return Array.from(bytes || [], (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return [];
  if (normalized.length % 2 !== 0) throw new Error(`Invalid hex length: ${hex}`);
  const out = [];
  for (let i = 0; i < normalized.length; i += 2) out.push(parseInt(normalized.slice(i, i + 2), 16));
  return out;
}

function sha256Hex(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function toBigInt(value, fieldName) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string' && value.trim() !== '') return BigInt(value.trim());
  throw new Error(`Missing or invalid bigint field: ${fieldName}`);
}

function pickFirst(obj, keys) {
  for (const key of keys) {
    if (Object.hasOwn(obj, key) && obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function loadFixture(path) {
  const fixture = JSON.parse(readFileSync(path, 'utf8'));
  const input = pickFirst(fixture, ['build_transaction_input', 'input', 'wasm_input']);
  const expected = pickFirst(fixture, ['mobilecoind_output', 'expected', 'mobilecoind']);

  if (!input || typeof input !== 'object') {
    throw new Error('Fixture is missing build_transaction_input (or input/wasm_input) object');
  }
  if (!expected || typeof expected !== 'object') {
    throw new Error('Fixture is missing mobilecoind_output (or expected/mobilecoind) object');
  }

  return { input, expected };
}

function getWasmBuildTxData(input) {
  const fogPubRaw = pickFirst(input, ['fog_ingest_pubkey', 'fogIngestPubkey']);
  const fogPub = Array.isArray(fogPubRaw) && fogPubRaw.length > 0 ? fogPubRaw : null;

  const result = build_transaction(
    input.account_key,
    input.inputs,
    input.recipient,
    toBigInt(input.amount, 'amount'),
    toBigInt(input.fee, 'fee'),
    input.change_recipient,
    toBigInt(input.tombstone_block, 'tombstone_block'),
    fogPub,
    toBigInt(pickFirst(input, ['payment_request_id', 'paymentRequestId']) || 0, 'payment_request_id'),
  );

  console.log(result);
  console.log('------');

  return {
    tx_prefix_hash: bytesToHex(result.tx_prefix_hash || []),
    confirmation_number: bytesToHex(result.confirmation_number || []),
    tx_bytes_sha256: sha256Hex(result.tx_bytes || []),
    key_images: (result.key_images || []).map((ki) => bytesToHex(ki)).map(normalizeHex).sort(),
  };
}

function normalizeExpected(expected) {
  const expectedTxBytesHex = normalizeHex(
    pickFirst(expected, ['tx_bytes_hex', 'tx_bytes', 'txBytesHex', 'txHex']) || '',
  );

  let expectedTxBytesSha256 = normalizeHex(
    pickFirst(expected, ['tx_bytes_sha256', 'txBytesSha256']) || '',
  );

  if (!expectedTxBytesSha256 && expectedTxBytesHex) {
    expectedTxBytesSha256 = sha256Hex(hexToBytes(expectedTxBytesHex));
  }

  return {
    tx_prefix_hash: normalizeHex(pickFirst(expected, ['tx_prefix_hash', 'txPrefixHash']) || ''),
    confirmation_number: normalizeHex(pickFirst(expected, ['confirmation_number', 'confirmationNumber']) || ''),
    tx_bytes_sha256: expectedTxBytesSha256,
    key_images: (pickFirst(expected, ['key_images', 'keyImages']) || []).map(normalizeHex).sort(),
  };
}

function compareField(label, actual, expected) {
  if (!expected) {
    console.log(`${label}: SKIPPED (missing in fixture)`);
    return true;
  }

  const match = actual === expected;
  console.log(`${label}: ${match ? 'MATCH' : 'MISMATCH'}`);
  console.log(`  WASM:       ${actual}`);
  console.log(`  mobilecoind:${expected}`);
  return match;
}

function printComparison(actual, expected) {
  let ok = true;
  console.log('Comparing WASM build_transaction vs mobilecoind fixture output');
  console.log('');

  ok = compareField('Tx Prefix Hash', actual.tx_prefix_hash, expected.tx_prefix_hash) && ok;
  ok = compareField('Confirmation Number', actual.confirmation_number, expected.confirmation_number) && ok;
  ok = compareField('Tx Bytes SHA-256', actual.tx_bytes_sha256, expected.tx_bytes_sha256) && ok;

  if (expected.key_images.length === 0) {
    console.log('Key Images: SKIPPED (missing in fixture)');
  } else {
    const actualJoined = actual.key_images.join(',');
    const expectedJoined = expected.key_images.join(',');
    const match = actualJoined === expectedJoined;
    ok = match && ok;
    console.log(`Key Images: ${match ? 'MATCH' : 'MISMATCH'}`);
    console.log(`  WASM:       ${actual.key_images.join(' | ')}`);
    console.log(`  mobilecoind:${expected.key_images.join(' | ')}`);
  }

  console.log('');
  console.log(`RESULT: ${ok ? 'PASS' : 'FAIL'}`);
  return ok ? 0 : 2;
}

async function main() {
  const fixturePath = parseArgs(process.argv.slice(2));
  const wasmBytes = readFileSync(new URL('../pkg/wasm_bg.wasm', import.meta.url));
  await init({ module_or_path: wasmBytes });

  const { input, expected } = loadFixture(fixturePath);
  const actual = getWasmBuildTxData(input);
  const expectedNormalized = normalizeExpected(expected);
  process.exitCode = printComparison(actual, expectedNormalized);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});