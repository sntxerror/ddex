#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import init, {
  mnemonic_to_account_key,
  derive_subaddress,
  get_b58_address,
} from '../pkg/wasm.js';

function parseArgs(argv) {
  return {
    mnemonic: argv.join(' ').trim(),
  };
}

const { mnemonic } = parseArgs(process.argv.slice(2));

if (!mnemonic) {
  console.error('Usage: node test/compare_wasm_vs_mobilecoind.mjs "<mnemonic phrase>"');
  console.error('For build_transaction comparisons, use: node test/compare_build_tx_wasm_vs_mobilecoind.mjs [fixture-path]');
  process.exit(1);
}

const host = process.env.MOBILECOIND_HOST || 'localhost';
const port = process.env.MOBILECOIND_PORT || '9090';
const baseUrl = `http://${host}:${port}`;

const fieldLabels = {
  view_private_key: 'View Private Key',
  spend_private_key: 'Spend Private Key',
  view_public_key: 'View Public Key',
  spend_public_key: 'Spend Public Key',
  b58_address: 'B58 Address',
};

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();

  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${path}: ${text}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${path}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function findMonitorIdByB58Address(expectedB58Address) {
  const monitors = await requestJson('/monitors');
  const monitorIds = Array.isArray(monitors.monitor_ids) ? monitors.monitor_ids : [];

  for (const monitorId of monitorIds) {
    try {
      const address = await requestJson(`/monitors/${monitorId}/subaddresses/0/public-address`);
      if (address.b58_address_code === expectedB58Address) {
        return monitorId;
      }
    } catch {
      // Ignore stale or incompatible monitor entries while scanning.
    }
  }

  return null;
}

async function getMobilecoindData(expectedB58Address) {
  const account = await requestJson('/account-key-from-mnemonic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mnemonic }),
  });

  if (!account.view_private_key || !account.spend_private_key) {
    throw new Error(`Missing private keys in account-key-from-mnemonic response: ${JSON.stringify(account)}`);
  }

  let monitorId = null;
  let createdMonitor = false;

  try {
    const monitor = await requestJson('/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_key: {
          view_private_key: account.view_private_key,
          spend_private_key: account.spend_private_key,
        },
        first_subaddress: 0,
        num_subaddresses: 1,
      }),
    });

    monitorId = monitor.monitor_id;
    createdMonitor = true;
  } catch (error) {
    if (!String(error.message).includes('SubaddressStore already exists')) {
      throw error;
    }

    monitorId = await findMonitorIdByB58Address(expectedB58Address);
  }

  if (!monitorId) {
    throw new Error('Unable to create or locate an existing mobilecoind monitor for this mnemonic');
  }

  try {
    const address = await requestJson(`/monitors/${monitorId}/subaddresses/0/public-address`);

    return {
      view_private_key: account.view_private_key,
      spend_private_key: account.spend_private_key,
      view_public_key: address.view_public_key || '',
      spend_public_key: address.spend_public_key || '',
      b58_address: address.b58_address_code || '',
    };
  } finally {
    if (createdMonitor) {
      try {
        await fetch(`${baseUrl}/monitors/${monitorId}`, { method: 'DELETE' });
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

function getWasmData() {
  const account = mnemonic_to_account_key(mnemonic, '', new Uint8Array());
  const sub0 = derive_subaddress(account, 0n);
  const b58 = get_b58_address(account);

  return {
    view_private_key: bytesToHex(account.view_private_key),
    spend_private_key: bytesToHex(account.spend_private_key),
    view_public_key: bytesToHex(sub0.view_public_key),
    spend_public_key: bytesToHex(sub0.spend_public_key),
    b58_address: b58,
  };
}

function printComparison(wasmData, mobileData) {
  const fields = Object.keys(fieldLabels);
  let allMatch = true;

  console.log('Comparing WASM vs mobilecoind /account-key-from-mnemonic');
  console.log('');

  for (const field of fields) {
    const wasmValue = wasmData[field] || '';
    const mobileValue = mobileData[field] || '';
    const match = wasmValue === mobileValue;
    if (!match) allMatch = false;

    console.log(`${fieldLabels[field]}: ${match ? 'MATCH' : 'MISMATCH'}`);
    console.log(`  WASM:       ${wasmValue}`);
    console.log(`  mobilecoind:${mobileValue}`);
  }

  console.log('');
  if (allMatch) {
    console.log('RESULT: PASS (all compared fields match)');
    return 0;
  }

  console.log('RESULT: FAIL (one or more fields differ)');
  return 2;
}

async function main() {
  const wasmBytes = readFileSync(new URL('../pkg/wasm_bg.wasm', import.meta.url));
  await init({ module_or_path: wasmBytes });

  const expectedWasmData = getWasmData();

  const [wasmData, mobileData] = await Promise.all([
    Promise.resolve(expectedWasmData),
    getMobilecoindData(expectedWasmData.b58_address),
  ]);

  process.exitCode = printComparison(wasmData, mobileData);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
