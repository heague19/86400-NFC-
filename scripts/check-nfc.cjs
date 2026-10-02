// Run: node scripts/check-nfc.cjs (installed TypeScript/NDEF library, no device required).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Ndef = require('react-native-nfc-manager/ndef-lib');
const root = path.resolve(__dirname, '..');
const Platform = { OS: 'android' };
const NdefStatus = { NotSupported: 1, ReadWrite: 2, ReadOnly: 3 };

function load(file, imports, extra = '') {
  const source = fs.readFileSync(path.join(root, file), 'utf8') + extra;
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}

const normalizer = load('src/utils/urlNormalizer.ts', {});
// Execute the installed Android handler itself: native errors become NotSupported/0.
const { NdefHandler } = load('node_modules/react-native-nfc-manager/src/NfcTech/NdefHandler.js', {
  'react-native': { Platform },
  '../NativeNfcManager': { callNative: async () => { throw new Error('tag lost'); } },
  '../NfcError': { handleNativeException: (promise) => promise },
});
const androidHandler = new NdefHandler();
let options;
let events;
let written;
const toNative = (records) => records.map((record) => ({
  ...record,
  type: Ndef.util.stringToBytes(record.type),
  id: Ndef.util.bytesToHexString(record.id),
}));
const manager = {
  isSupported: async () => true,
  start: async () => {},
  isEnabled: async () => true,
  requestTechnology: async () => {
    events.push('request');
    if (options.requestError) throw new Error('cancelled');
  },
  cancelTechnologyRequest: async () => {
    events.push('cancel');
    if (options.cancelError) throw new Error('cancel failed');
  },
  getTag: async () => {
    events.push('tag');
    return { ndefMessage: options.records ?? toNative([Ndef.uriRecord('https://example.com')]) };
  },
  ndefHandler: {
    getNdefStatus: async () => {
      events.push('status');
      if (options.statusError) throw new Error('status query failed');
      if (options.nativeStatusError) return androidHandler.getNdefStatus();
      return Object.hasOwn(options, 'status') ? options.status : { status: 2, capacity: 512 };
    },
    writeNdefMessage: async (bytes, config) => {
      events.push('write');
      assert.deepEqual(config, { reconnectAfterWrite: true });
      written = bytes;
      if (options.writeError) throw new Error('tag lost');
    },
    getNdefMessage: async () => {
      events.push('fresh');
      if (options.freshError) throw new Error('NDEF read failed');
      if (options.freshNull) return null;
      const records = toNative(Ndef.decodeMessage(written));
      return { ndefMessage: options.transform ? options.transform(records) : records };
    },
  },
};
const { NfcService, encodeNativeRecords } = load('src/nfc/nfcService.ts', {
  'react-native': { Platform },
  'react-native-nfc-manager': { default: manager, Ndef, NdefStatus, NfcTech: { Ndef: 'Ndef' } },
  '../utils/urlNormalizer': normalizer,
}, '\nexport { encodeNativeRecords };');

async function run(settings = {}, read = false, urls = ['https://example.com']) {
  options = settings;
  events = [];
  const result = await (read ? NfcService.readUrl() : NfcService.writeUrls(urls));
  assert.equal(events.at(-1), 'cancel', 'Every attempted session must close');
  assert.equal(events.filter((event) => event === 'request').length, 1, 'No automatic retry');
  assert.equal(events.filter((event) => event === 'cancel').length, 1);
  return result;
}

(async () => {
  assert.deepEqual(await androidHandler.getNdefStatus(), { status: 1, capacity: 0 });
  const records = [Ndef.uriRecord('https://example.com', [0, 255, 16]), Ndef.uriRecord('https://example.com')];
  assert.deepEqual(encodeNativeRecords(toNative(records)), Ndef.encodeMessage(records));
  assert.deepEqual(encodeNativeRecords(records.map((r) => ({ ...r, type: Ndef.util.stringToBytes(r.type) }))),
    Ndef.encodeMessage(records), 'iOS byte-array ids');
  assert.throws(() => encodeNativeRecords([{ ...toNative(records)[0], id: 'z1' }]));
  assert.throws(() => encodeNativeRecords([{ ...toNative(records)[0], type: [0xff] }]));

  assert.equal((await run({}, false, ['https://example.com', 'https://example.com'])).ok, true);
  assert.deepEqual(events, ['request', 'status', 'write', 'fresh', 'cancel'], 'Fresh read before session close');
  for (const transform of [
    (r) => r.slice(1),
    (r) => [...r, r[0]],
    (r) => r.reverse(),
    (r) => [{ ...r[0], tnf: 2 }, ...r.slice(1)],
    (r) => [{ ...r[0], type: [84] }, ...r.slice(1)],
    (r) => [{ ...r[0], id: '00ff' }, ...r.slice(1)],
    (r) => [{ ...r[0], payload: [...r[0].payload, 47] }, ...r.slice(1)],
    // Same URL, different bytes: uncompressed URI must fail verification too.
    (r) => [{ ...r[0], payload: [0, ...Ndef.util.stringToBytes('https://example.com')] }, ...r.slice(1)],
  ]) {
    assert.equal((await run({ transform }, false, ['https://example.com', 'https://other.com'])).reason,
      'verify_mismatch');
    assert.equal(events.includes('tag'), false, 'Cached getTag must not verify a write');
  }
  assert.equal((await run({ transform: (r) => r.slice(1) }, false,
    ['https://example.com', 'https://example.com'])).reason, 'verify_mismatch', 'Duplicate count preserved');
  assert.equal((await run({ freshError: true })).reason, 'verify_mismatch');
  assert.equal((await run({ freshNull: true })).reason, 'verify_mismatch');
  assert.equal((await run({ cancelError: true })).ok, true, 'Cleanup error must not overwrite verified success');
  assert.equal((await run({ writeError: true })).ok, false);
  assert.equal(events.includes('fresh'), false);
  assert.equal((await run({ requestError: true })).reason, 'cancelled');

  for (const settings of [
    { statusError: true }, { nativeStatusError: true }, { status: null },
    ...[0, -1, NaN, Infinity, undefined, 1.5].map((capacity) => ({ status: { status: 2, capacity } })),
    { status: { status: 99, capacity: 512 } },
  ]) {
    for (const read of [false, true]) {
      assert.equal((await run(settings, read)).reason, 'status_unknown');
      assert.deepEqual(events, ['request', 'status', 'cancel'], 'Unverified status stops reads and writes');
    }
  }
  assert.equal((await run({ status: { status: 3, capacity: 512 } })).reason, 'read_only');
  assert.equal(events.includes('write'), false);
  assert.equal((await run({ status: { status: 2, capacity: 5 } })).reason, 'capacity');
  assert.equal(events.includes('write'), false);
  const read = await run({ status: { status: 3, capacity: 42 } }, true);
  assert.equal(read.ok, true);
  assert.equal(read.capacity, 42);
  assert.equal(read.writable, false);

  const malformed = { tnf: 1, type: [85], id: '', payload: [4, 0xff] };
  assert.equal(Ndef.uri.decodePayload(malformed.payload), 'https://null', 'Reproduce installed library bug');
  assert.equal(normalizer.isValidHttpUrl('https://null'), true, 'URL validation alone cannot fix malformed UTF-8');
  for (const payload of [[4, 0xff], [4, 0xc3], [4, 0xc0, 0xaf], [4, 0xed, 0xa0, 0x80]]) {
    assert.equal((await run({ records: [{ ...malformed, payload }] }, true)).reason, 'no_url');
  }
  const valid = toNative([Ndef.uriRecord('https://example.com/한글')])[0];
  const safe = await run({ records: [malformed, ...toNative([
    Ndef.uriRecord('javascript:alert(1)'), Ndef.uriRecord('ftp://example.com'),
  ]), valid] }, true);
  assert.deepEqual(safe.urls, ['https://example.com/한글']);
  assert.equal((await run({ records: toNative([Ndef.textRecord('https://example.com')]) }, true)).ok, true);
  console.log('PASS: native fields/ids, duplicate/order/byte comparison, fresh read/errors, status fail-closed, malformed UTF-8, session cleanup');
})().catch((error) => { console.error(error); process.exitCode = 1; });
