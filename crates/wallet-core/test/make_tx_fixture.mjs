#!/usr/bin/env node

import { writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    host: process.env.MOBILECOIND_HOST || 'localhost',
    port: process.env.MOBILECOIND_PORT || '9090',
    senderSubaddress: 0,
    recipientSubaddress: 0,
    numSubaddresses: 10,
    firstBlock: 0,
    inputCount: 1,
    waitSeconds: Number(process.env.UTXO_WAIT_SECONDS || 0),
    pollSeconds: Number(process.env.UTXO_POLL_SECONDS || 5),
    keepMonitors: false,
    output: './test/mobilecoind_build_tx_fixture.json',
    paymentRequestId: 0,
    amount: '10000000000',
  };

  const pop = (name) => {
    if (args.length === 0) throw new Error(`Missing value for ${name}`);
    return args.shift();
  };

  while (args.length > 0) {
    const arg = args.shift();
    switch (arg) {
      case '--mnemonic':
        opts.mnemonic = pop('--mnemonic');
        break;
      case '--amount':
        opts.amount = pop('--amount');
        break;
      case '--fee':
        opts.fee = pop('--fee');
        break;
      case '--host':
        opts.host = pop('--host');
        break;
      case '--port':
        opts.port = pop('--port');
        break;
      case '--monitor-id':
        opts.monitorId = pop('--monitor-id');
        break;
      case '--recipient-monitor-id':
        opts.recipientMonitorId = pop('--recipient-monitor-id');
        break;
      case '--sender-subaddress':
        opts.senderSubaddress = Number(pop('--sender-subaddress'));
        break;
      case '--recipient-subaddress':
        opts.recipientSubaddress = Number(pop('--recipient-subaddress'));
        break;
      case '--num-subaddresses':
        opts.numSubaddresses = Number(pop('--num-subaddresses'));
        break;
      case '--first-block':
        opts.firstBlock = Number(pop('--first-block'));
        break;
      case '--input-count':
        opts.inputCount = Number(pop('--input-count'));
        break;
      case '--wait-seconds':
        opts.waitSeconds = Number(pop('--wait-seconds'));
        break;
      case '--poll-seconds':
        opts.pollSeconds = Number(pop('--poll-seconds'));
        break;
      case '--payment-request-id':
        opts.paymentRequestId = Number(pop('--payment-request-id'));
        break;
      case '--out':
      case '--output':
        opts.output = pop('--output');
        break;
      case '--keep-monitors':
        opts.keepMonitors = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.mnemonic || !opts.mnemonic.trim()) throw new Error('Missing required --mnemonic');
  if (opts.fee === undefined) throw new Error('Missing required --fee');

  return opts;
}

function printHelp() {
  console.log('Generate a simple fixture for compare_build_tx_wasm_vs_mobilecoind.mjs');
  console.log('');
  console.log('Usage:');
  console.log('  node test/generate_mobilecoind_build_tx_fixture.mjs \\');
  console.log('    --mnemonic "<24 words>" \\');
  console.log('    [--amount <picoMOB>] \\');
  console.log('    --fee <picoMOB> \\');
  console.log('    [--monitor-id <id>] [--output ./test/mobilecoind_build_tx_fixture.json]');
  console.log('');
  console.log('Defaults: --amount 10000000000 (0.01 MOB)');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHex(value) {
  return String(value || '').trim().toLowerCase().replace(/^0x/, '');
}

function hexToBytes(hex) {
  const n = normalizeHex(hex);
  if (!n) return [];
  if (n.length % 2 !== 0) throw new Error(`Invalid hex length: ${hex}`);
  const out = [];
  for (let i = 0; i < n.length; i += 2) {
    out.push(parseInt(n.slice(i, i + 2), 16));
  }
  return out;
}

function pickFirst(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (Object.hasOwn(obj, k) && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function findHex(value) {
  if (!value) return '';
  if (typeof value === 'string') return normalizeHex(value);
  if (Array.isArray(value)) return value.map((b) => Number(b).toString(16).padStart(2, '0')).join('');
  if (typeof value === 'object') {
    const maybe = pickFirst(value, ['data', 'hex', 'value', 'bytes']);
    if (typeof maybe === 'string' || Array.isArray(maybe)) return findHex(maybe);
  }
  return '';
}

function extractUtxoList(body) {
  if (Array.isArray(body)) return body;
  const nested = pickFirst(body, ['utxos', 'output_list', 'outputs', 'input_list']);
  return Array.isArray(nested) ? nested : [];
}

function toReceiverFromPublicAddress(address) {
  return {
    view_public_key: findHex(pickFirst(address, ['view_public_key', 'viewPublicKey'])),
    spend_public_key: findHex(pickFirst(address, ['spend_public_key', 'spendPublicKey'])),
    fog_report_url: pickFirst(address, ['fog_report_url', 'fogUrl']) || '',
  };
}

function toWasmInputFromUtxo(utxo) {
  const txOut = pickFirst(utxo, ['tx_out', 'txOut', 'output']) || {};
  const masked = pickFirst(txOut, ['masked_amount', 'maskedAmount']) || {};

  const targetKey = findHex(pickFirst(txOut, ['target_key', 'targetKey']));
  const publicKey = findHex(pickFirst(txOut, ['public_key', 'publicKey']));
  const commitment = findHex(pickFirst(masked, ['commitment']));

  if (!targetKey || !publicKey || !commitment) {
    throw new Error('UTXO missing target/public/commitment keys');
  }

  const txOutBytes = findHex(
    pickFirst(utxo, ['tx_out_bytes', 'txOutBytes']) || pickFirst(txOut, ['tx_out_bytes', 'txOutBytes', 'bytes'])
  );
  const proofBytes = findHex(
    pickFirst(utxo, ['proof_bytes', 'membership_proof_bytes', 'proofBytes']) || pickFirst(utxo, ['proof', 'membership_proof'])
  );

  return {
    real_index: 0,
    ring: [{
      target_key: hexToBytes(targetKey),
      public_key: hexToBytes(publicKey),
      commitment: hexToBytes(commitment),
      tx_out_bytes: hexToBytes(txOutBytes),
      proof_bytes: hexToBytes(proofBytes),
    }],
    subaddress_index: Number(pickFirst(utxo, ['subaddress_index', 'subaddressIndex']) || 0),
    value: Number(pickFirst(utxo, ['value']) || 0),
    token_id: Number(pickFirst(utxo, ['token_id', 'tokenId']) || 0),
  };
}

function extractKeyImagesFromUtxos(utxos) {
  return utxos.map((u) => findHex(pickFirst(u, ['key_image', 'keyImage']))).filter(Boolean);
}

async function requestJson(baseUrl, path, options = {}) {
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

async function fetchUtxosWithWait(baseUrl, monitorId, subaddress, waitSeconds, pollSeconds) {
  const paths = [
    `/monitors/${monitorId}/subaddresses/${subaddress}/utxos`,
    `/monitors/${monitorId}/subaddresses/${subaddress}/unspent-tx-outs`,
  ];

  const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;
  const pollMs = Math.max(1, pollSeconds) * 1000;

  while (true) {
    let lastErr = null;

    for (const path of paths) {
      try {
        const body = await requestJson(baseUrl, path);
        const utxos = extractUtxoList(body);
        if (utxos.length > 0) return { utxos, path };
      } catch (err) {
        lastErr = err;
      }
    }

    if (Date.now() >= deadline) {
      if (lastErr) {
        throw new Error(`No UTXOs found. Last error: ${lastErr.message}`);
      }
      return { utxos: [], path: paths[0] };
    }

    await sleep(pollMs);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baseUrl = `http://${opts.host}:${opts.port}`;
  const createdMonitors = [];

  const account = await requestJson(baseUrl, '/account-key-from-mnemonic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mnemonic: opts.mnemonic }),
  });

  const viewPrivHex = findHex(pickFirst(account, ['view_private_key', 'viewPrivateKey']));
  const spendPrivHex = findHex(pickFirst(account, ['spend_private_key', 'spendPrivateKey']));
  if (!viewPrivHex || !spendPrivHex) {
    throw new Error(`Unexpected /account-key-from-mnemonic response: ${JSON.stringify(account)}`);
  }

  let senderMonitorId = opts.monitorId;

  if (!senderMonitorId) {
    try {
      const monitor = await requestJson(baseUrl, '/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_key: {
            view_private_key: viewPrivHex,
            spend_private_key: spendPrivHex,
          },
          first_subaddress: 0,
          num_subaddresses: opts.numSubaddresses,
          first_block: opts.firstBlock,
        }),
      });

      senderMonitorId = monitor.monitor_id;
      if (!senderMonitorId) {
        throw new Error(`Monitor creation missing monitor_id: ${JSON.stringify(monitor)}`);
      }
      createdMonitors.push(senderMonitorId);
    } catch (err) {
      if (String(err.message).toLowerCase().includes('already exists')) {
        throw new Error('Monitor already exists for this mnemonic. Re-run with --monitor-id <existing-id>.');
      }
      throw err;
    }
  } else {
    console.log(`Using existing monitor: ${senderMonitorId}`);
  }

  const recipientMonitorId = opts.recipientMonitorId || senderMonitorId;

  const recipientAddressBody = await requestJson(
    baseUrl,
    `/monitors/${recipientMonitorId}/subaddresses/${opts.recipientSubaddress}/public-address`
  );
  const recipient = toReceiverFromPublicAddress(recipientAddressBody);

  const senderAddressBody = await requestJson(
    baseUrl,
    `/monitors/${senderMonitorId}/subaddresses/${opts.senderSubaddress}/public-address`
  );
  const changeRecipient = toReceiverFromPublicAddress(senderAddressBody);

  const ledger = await requestJson(baseUrl, '/ledger/local').catch(() => ({}));
  const blockCount = Number(pickFirst(ledger, ['block_count', 'blockCount']) || 0);

  const { utxos, path: utxosPath } = await fetchUtxosWithWait(
    baseUrl,
    senderMonitorId,
    opts.senderSubaddress,
    opts.waitSeconds,
    opts.pollSeconds,
  );

  if (utxos.length === 0) {
    throw new Error(`No UTXOs found at ${utxosPath}. Account may be unfunded or wrong subaddress.`);
  }

  const selected = utxos.slice(0, Math.max(1, opts.inputCount));
  const keyImages = extractKeyImagesFromUtxos(selected);

  const fixture = {
    build_transaction_input: {
      account_key: {
        view_private_key: hexToBytes(viewPrivHex),
        spend_private_key: hexToBytes(spendPrivHex),
      },
      inputs: selected.map(toWasmInputFromUtxo),
      recipient: {
        view_public_key: hexToBytes(recipient.view_public_key),
        spend_public_key: hexToBytes(recipient.spend_public_key),
        fog_report_url: recipient.fog_report_url,
      },
      amount: String(opts.amount),
      fee: String(opts.fee),
      change_recipient: {
        view_public_key: hexToBytes(changeRecipient.view_public_key),
        spend_public_key: hexToBytes(changeRecipient.spend_public_key),
        fog_report_url: changeRecipient.fog_report_url,
      },
      tombstone_block: String(blockCount > 0 ? blockCount + 50 : 0),
      fog_ingest_pubkey: [],
      payment_request_id: String(opts.paymentRequestId),
    },
    mobilecoind_output: {
      tx_prefix_hash: '',
      key_images: keyImages,
      confirmation_number: '',
      tx_bytes_sha256: '',
    },
    _meta: {
      generated_at: new Date().toISOString(),
      mobilecoind_base_url: baseUrl,
      sender_monitor_id: senderMonitorId,
      recipient_monitor_id: recipientMonitorId,
      sender_subaddress: opts.senderSubaddress,
      recipient_subaddress: opts.recipientSubaddress,
      utxos_endpoint_used: utxosPath,
      key_image_count: keyImages.length,
      note: 'Simple fixture mode: compares deterministic key_images only; other fields intentionally blank.',
    },
  };

  writeFileSync(opts.output, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

  console.log(`Wrote fixture: ${opts.output}`);
  console.log(`Monitor: ${senderMonitorId}`);
  console.log(`Selected UTXOs: ${selected.length}`);
  console.log(`Extracted key images: ${keyImages.length}`);

  if (!opts.keepMonitors) {
    for (const monitorId of createdMonitors) {
      try {
        await fetch(`${baseUrl}/monitors/${monitorId}`, { method: 'DELETE' });
      } catch {
        // Best effort cleanup.
      }
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
