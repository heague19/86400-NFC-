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
const model = load('src/models/linkType.ts', {});
const aar = load('src/nfc/aar.ts', { 'react-native-nfc-manager': { Ndef }, '../models/linkType': model });
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
  isSupported: async () => {
    if (options.supportError) throw new Error('support query failed');
    return options.supported !== false;
  },
  start: async () => {},
  isEnabled: async () => options.enabled !== false,
  requestTechnology: async () => {
    events.push('request');
    if (options.requestError) throw options.requestError instanceof Error ? options.requestError : new Error('cancelled');
    await options.requestGate?.promise;
  },
  cancelTechnologyRequest: async () => {
    events.push('cancel');
    options.onCancel?.();
    await options.cleanupGate?.promise;
    if (options.cancelError) throw new Error('cancel failed');
  },
  getTag: async () => {
    events.push('tag');
    if (options.tagNull) return null;
    return { ndefMessage: options.records ?? toNative([Ndef.uriRecord('https://example.com')]) };
  },
  ndefHandler: {
    getNdefStatus: async () => {
      events.push('status');
      await options.statusGate?.promise;
      if (options.statusError) throw new Error('status query failed');
      if (options.nativeStatusError) return androidHandler.getNdefStatus();
      return Object.hasOwn(options, 'status') ? options.status : { status: 2, capacity: 512 };
    },
    writeNdefMessage: async (bytes, config) => {
      events.push('write');
      assert.deepEqual(config, { reconnectAfterWrite: true });
      written = bytes;
      await options.writeGate?.promise;
      if (options.writeError) throw new Error('tag lost');
    },
    getNdefMessage: async () => {
      events.push('fresh');
      await options.freshGate?.promise;
      if (options.freshError) throw new Error('NDEF read failed');
      if (options.freshNull) return null;
      const records = toNative(Ndef.decodeMessage(written));
      return { ndefMessage: options.transform ? options.transform(records) : records };
    },
  },
};
const nfcErrors = load('node_modules/react-native-nfc-manager/src/NfcError.js', { 'react-native': { Platform: Platform } });
const { NfcService, encodeNativeRecords } = load('src/nfc/nfcService.ts', {
  'react-native': { Platform },
  'react-native-nfc-manager': { default: manager, Ndef, NdefStatus, NfcError: nfcErrors, NfcErrorIOS: nfcErrors.NfcErrorIOS, NfcTech: { Ndef: 'Ndef' } },
  '../utils/urlNormalizer': normalizer, './aar': aar,
}, '\nexport { encodeNativeRecords };');

async function run(settings = {}, read = false, urls = ['https://example.com'], writeOptions = {}) {
  options = settings;
  events = [];
  const result = await (read ? NfcService.readUrl() : NfcService.writeUrls(urls, writeOptions));
  assert.equal(events.at(-1), 'cancel', 'Every attempted session must close');
  assert.equal(events.filter((event) => event === 'request').length, 1, 'No automatic retry');
  assert.equal(events.filter((event) => event === 'cancel').length, 1);
  return result;
}

(async () => {
  // Fake time exercises the production acquisition timer without real waits.
  {
    const { mock } = require('node:test');
    const gate = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
    const pause = () => new Promise(setImmediate);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      for (const call of [() => NfcService.readUrl(), () => NfcService.inspectTag(), () => NfcService.writeUrls(['https://example.com'])]) {
        const request = gate(); options = { requestGate: request }; events = [];
        let done = false; const attempt = call().then((r) => { done = true; return r; }); await pause();
        mock.timers.tick(29999); await pause(); assert.equal(done, false);
        mock.timers.tick(1); const result = await attempt;
        assert.equal(result.reason, 'timeout'); assert.ok(result.message.includes('다시 시도'));
        assert.deepEqual(events, ['request', 'cancel'], 'Deadline stops before status/read/write and closes exactly once');
        request.resolve(); await pause(); assert.deepEqual(events, ['request', 'cancel'], 'Late connection cannot perform old work');
        options = {}; assert.equal((await NfcService.readUrl()).ok, true, 'Explicit retry opens a clean session');
      }
      const request = gate(), cleanup = gate();
      options = { requestGate: request, cleanupGate: cleanup, onCancel: () => request.reject(new nfcErrors.UserCancel()) }; events = [];
      const expired = NfcService.readUrl(); await pause(); mock.timers.tick(30000); await pause();
      options.requestGate = undefined; options.onCancel = undefined;
      const next = NfcService.readUrl(); await pause();
      assert.equal(events.filter((e) => e === 'request').length, 1, 'Retry waits for timeout cleanup');
      cleanup.resolve(); assert.equal((await expired).reason, 'timeout'); assert.equal((await next).ok, true);
      assert.equal(events.filter((e) => e === 'cancel').length, 2, 'Native cancellation does not override timeout or double-close');
      for (const phase of ['writeGate', 'freshGate']) {
        const held = gate(); options = { [phase]: held }; events = [];
        const saving = NfcService.writeUrls(['https://example.com']); await pause();
        mock.timers.tick(60000); await pause(); assert.equal(events.includes('cancel'), false, 'Connected write/verification has no acquisition timer');
        held.resolve(); assert.equal((await saving).ok, true);
        const completed = [...events]; mock.timers.tick(60000); await pause(); assert.deepEqual(events, completed, 'Completed timer cannot close a later session');
      }
      const abortedRequest = gate(), abort = new AbortController();
      options = { requestGate: abortedRequest }; events = [];
      const stopped = NfcService.readUrl(abort.signal); await pause(); abort.abort(); abortedRequest.resolve();
      assert.equal((await stopped).reason, 'cancelled'); mock.timers.tick(30000); await pause();
      assert.equal(events.filter((e) => e === 'cancel').length, 1, 'User cancellation clears the timer');
      Platform.OS = 'ios'; manager.setAlertMessage = async () => {};
      for (const error of [nfcErrors.buildNfcExceptionIOS('NFCError:201'), new Error('NFCError:201')]) {
        for (const call of [() => NfcService.readUrl(), () => NfcService.inspectTag(), () => NfcService.writeUrls(['https://example.com'])]) {
          options = { requestError: error }; events = [];
          assert.equal((await call()).reason, 'timeout'); assert.equal(events.filter((e) => e === 'cancel').length, 1);
        }
      }
      options = { requestError: nfcErrors.buildNfcExceptionIOS('NFCError:200') }; events = [];
      assert.equal((await NfcService.readUrl()).reason, 'cancelled');
      const iosRequest = gate(); options = { requestGate: iosRequest }; events = [];
      const iosRead = NfcService.readUrl(); await pause(); mock.timers.tick(60000); await pause();
      assert.deepEqual(events, ['request'], 'iOS keeps its system-controlled deadline');
      iosRequest.reject(nfcErrors.buildNfcExceptionIOS('NFCError:201')); assert.equal((await iosRead).reason, 'timeout');
    } finally { mock.timers.reset(); Platform.OS = 'android'; }
    console.log('PASS: 30s acquisition boundary/read/inspect/write, no late work, cleanup-before-retry, one close, no timer during writes/verification, user cancel, actual iOS typed/raw timeout');
  }
  assert.deepEqual(await androidHandler.getNdefStatus(), { status: 1, capacity: 0 });
  // AAR tests run the actual service through native byte-array types/hex ids and the installed codec.
  const aarUrls = ['https://www.instagram.com/Mixed_Name/', 'https://example.com/A%2fb?flag#Keep', 'https://www.instagram.com/Mixed_Name/'];
  const packages = [
    ['instagram', 'com.instagram.android', 39], ['github', 'com.github.android', 36],
    ['linkedin', 'com.linkedin.android', 38], ['x', 'com.twitter.android', 37],
    ['tiktok', 'com.zhiliaoapp.musically', 42], ['youtube', 'com.google.android.youtube', 44],
  ];
  assert.equal(model.LINK_TYPES.filter((type) => type.androidPackage).length, 6);
  for (const [id, packageName, expectedBytes] of packages) {
    assert.equal(model.findLinkTypeById(id).androidPackage, packageName);
    const result = await run({}, false, aarUrls, { androidPackage: packageName });
    assert.equal(result.ok, true); assert.equal(result.androidPackage, packageName);
    const decoded = Ndef.decodeMessage(written);
    assert.equal(decoded.length, aarUrls.length + 1);
    assert.deepEqual(decoded.slice(0, -1).map((r) => Ndef.uri.decodePayload(r.payload)), aarUrls);
    assert.equal(decoded.at(-1).tnf, 4); assert.equal(decoded.at(-1).type, 'android.com:pkg');
    assert.equal(Buffer.from(decoded.at(-1).payload).toString('utf8'), packageName);
    const linkOnly = Ndef.encodeMessage(aarUrls.map((url) => Ndef.uriRecord(url)));
    assert.equal(result.usedBytes - linkOnly.length, expectedBytes);
    // Independent short-record size: three header bytes, actual ASCII type and package lengths.
    assert.equal(expectedBytes, 3 + Buffer.byteLength('android.com:pkg') + Buffer.byteLength(packageName));
    assert.equal(result.usedBytes, written.length);
    const loaded = await run({ records: toNative(decoded) }, true);
    assert.deepEqual(loaded.aarRecords, [{ packageName }]); assert.equal(loaded.usedBytes, result.usedBytes);
    assert.equal((await run({ status: { status: 2, capacity: result.usedBytes - 1 } }, false, aarUrls,
      { androidPackage: packageName })).reason, 'capacity');
    assert.equal(events.includes('write'), false);
    assert.equal((await run({ status: { status: 2, capacity: result.usedBytes } }, false, aarUrls,
      { androidPackage: packageName })).ok, true);
  }
  const aarOptions = { androidPackage: 'com.instagram.android' };
  for (const transform of [
    (r) => r.slice(0, -1), // URL-only verification must never call this success.
    (r) => [...r, r.at(-1)],
    (r) => [r.at(-1), ...r.slice(0, -1)],
    (r) => [...r.slice(0, -1), { ...r.at(-1), tnf: 2 }],
    (r) => [...r.slice(0, -1), { ...r.at(-1), type: Ndef.util.stringToBytes('android.com:bad') }],
    (r) => [...r.slice(0, -1), { ...r.at(-1), payload: Ndef.util.stringToBytes('com.github.android') }],
    (r) => [...r.slice(0, -1), { ...r.at(-1), payload: [255] }],
    (r) => [...r.slice(0, -1), { ...r.at(-1), id: '00' }],
    (r) => [...r.slice(0, -1), { ...r.at(-1), payload: [...r.at(-1).payload, NaN] }],
  ]) {
    assert.equal((await run({ transform }, false, aarUrls, aarOptions)).reason, 'verify_mismatch');
  }
  assert.equal((await run({ transform: (r) => [...r, ...toNative([Ndef.androidApplicationRecord('com.instagram.android')])] },
    false, aarUrls)).reason, 'verify_mismatch', 'Unexpected AAR when off must fail verification');
  assert.equal((await run({}, false, aarUrls)).ok, true);
  assert.equal(Ndef.decodeMessage(written).length, aarUrls.length, 'Off is a whole rewrite with no AAR');
  options = {}; events = [];
  assert.equal((await NfcService.writeUrls(aarUrls, { androidPackage: 'arbitrary.pkg' })).reason, 'invalid_records');
  assert.equal(events.includes('write'), false, 'Arbitrary package rejected before native write');
  const unknownRecord = Ndef.androidApplicationRecord('org.example.unknown');
  const unknown = await run({ records: toNative([Ndef.uriRecord(aarUrls[0]), unknownRecord]) }, true);
  assert.deepEqual(unknown.aarRecords, [{ packageName: 'org.example.unknown' }]);
  assert.equal(aar.aarLabel(unknown.aarRecords[0]), 'org.example.unknown');
  const brokenRead = await run({ records: [toNative([Ndef.uriRecord(aarUrls[0])])[0],
    { ...toNative([unknownRecord])[0], id: 'zz' }] }, true);
  assert.equal(brokenRead.reason, 'invalid_records');
  assert.deepEqual(brokenRead.urls, [aarUrls[0]], 'Read-only URL data remains available but reason blocks editing');
  const malformedAar = await run({ records: [toNative([Ndef.uriRecord(aarUrls[0])])[0],
    { ...toNative([unknownRecord])[0], payload: [255] }] }, true);
  assert.deepEqual(malformedAar.aarRecords, [{}]); assert.equal(aar.aarLabel(malformedAar.aarRecords[0]), '패키지 확인 불가');
  console.log('PASS: AAR native on/off, URI order/raw duplicates, max one last, six actual byte sizes 39/36/38/37/42/44, exact capacity boundaries, wrong native type/package/position/count/id/payload rejected, unknown package visible, unusable native message has unknown bytes');

  // A5: classify by consumed record index, then preserve every other original byte field.
  const preserved = [Ndef.textRecord('memo', 'en', [0, 255, 16]),
    Ndef.mimeMediaRecord('application/octet-stream', [0, 255, 128, 1]),
    Ndef.uriRecord('mailto:Mixed@Example.com'),
    Ndef.record(Ndef.TNF_EXTERNAL_TYPE, 'example.com:opaque', [16, 0, 255], [255, 0, 128]),
    Ndef.record(Ndef.TNF_UNKNOWN, '', [255], [0, 255]),
    Ndef.textRecord('https://text.example/Keep?flag'),
    Ndef.textRecord('memo', 'en', [0, 255, 16])];
  const mixedUrls = ['HTTPS://Example.COM/A%2fb?flag#Keep', 'https://dup.example', 'https://dup.example'];
  const nativeMixed = structuredClone(toNative([preserved[0], Ndef.uriRecord(mixedUrls[0]), preserved[1],
    Ndef.uriRecord(mixedUrls[1]), ...preserved.slice(2), Ndef.uriRecord(mixedUrls[2]),
    Ndef.androidApplicationRecord('org.old.one'), Ndef.androidApplicationRecord('org.old.two')]));
  const preservedMixed = [...preserved, Ndef.androidApplicationRecord('org.old.one'), Ndef.androidApplicationRecord('org.old.two')];
  const mixedRead = await run({ records: nativeMixed }, true);
  assert.deepEqual(mixedRead.urls, mixedUrls);
  assert.deepEqual(encodeNativeRecords(mixedRead.preservedRecords), Ndef.encodeMessage(preservedMixed));
  assert.equal(mixedRead.usedBytes, encodeNativeRecords(nativeMixed).length);
  // Mutating native fields after reading cannot corrupt the editor's copy.
  nativeMixed[0].type[0] = 0; nativeMixed[0].payload[0] = 255; nativeMixed[0].id = 'ffff';
  assert.deepEqual(encodeNativeRecords(mixedRead.preservedRecords), Ndef.encodeMessage(preservedMixed));
  for (const androidPackage of [undefined, 'com.instagram.android']) {
    const edited = [mixedUrls[2], 'https://edited.example'];
    const expectedRecords = [...edited.map((u) => Ndef.uriRecord(u)), ...preserved,
      ...(androidPackage ? [Ndef.androidApplicationRecord(androidPackage)] : preservedMixed.slice(preserved.length))];
    const expected = Ndef.encodeMessage(expectedRecords);
    for (const capacity of [expected.length - 1, expected.length, expected.length + 1]) {
      const result = await run({ status: { status: 2, capacity } }, false, edited,
        { androidPackage, preservedRecords: mixedRead.preservedRecords });
      assert.equal(result.ok, capacity >= expected.length, 'Capacity includes every preserved record and selected AAR');
      if (result.ok) { assert.deepEqual(written, expected); assert.equal(result.usedBytes, expected.length); }
      else { assert.equal(result.reason, 'capacity'); assert.equal(events.includes('write'), false); }
    }
  }
  const nonUrlOnly = await run({ records: toNative(preserved.filter((_, i) => i !== 5)) }, true);
  assert.equal(nonUrlOnly.reason, 'no_url'); assert.deepEqual(nonUrlOnly.urls, []);
  assert.equal(nonUrlOnly.writable, true); assert.equal(nonUrlOnly.capacity, 512);
  assert.deepEqual(encodeNativeRecords(nonUrlOnly.preservedRecords),
    Ndef.encodeMessage(preserved.filter((_, i) => i !== 5)));
  const fallbackUrls = ['https://fallback.example/Keep?flag', 'https://fallback.example/Keep?flag'];
  const fallback = await run({ records: toNative([Ndef.textRecord('memo'),
    ...fallbackUrls.map((u) => Ndef.textRecord(u)), Ndef.uriRecord('tel:+123')]) }, true);
  assert.deepEqual(fallback.urls, fallbackUrls);
  assert.deepEqual(encodeNativeRecords(fallback.preservedRecords),
    Ndef.encodeMessage([Ndef.textRecord('memo'), Ndef.uriRecord('tel:+123')]));
  assert.equal((await run({}, false, ['https://replacement.example'], { preservedRecords: fallback.preservedRecords })).ok, true);
  assert.deepEqual(Ndef.decodeMessage(written).map((r) => r.type), ['U', 'T', 'U']);
  assert.equal(Ndef.decodeMessage(written).some((r) => r.payload.includes('fallback'.charCodeAt(0)) &&
    r.type === 'T'), false, 'Deleted fallback URL text cannot return via preserved records');
  // Explicit replacement keeps only the selected AAR; an ordinary save preserves existing AAR bytes.
  assert.deepEqual(aar.encodeLinkMessage(['https://a.co'], 'com.instagram.android',
    [...preserved, ...toNative([Ndef.androidApplicationRecord('org.old.one'), Ndef.androidApplicationRecord('org.old.two')])]),
    Ndef.encodeMessage([Ndef.uriRecord('https://a.co'), ...preserved, Ndef.androidApplicationRecord('com.instagram.android')]));
  assert.deepEqual(aar.encodeLinkMessage(['https://a.co'], undefined, preservedMixed),
    Ndef.encodeMessage([Ndef.uriRecord('https://a.co'), ...preservedMixed]));
  const invalidRecords = [null, { tnf: 7, type: 'T', id: [], payload: [] },
    { tnf: 6, type: '', id: [], payload: [] }, { tnf: 0, type: 'T', id: [], payload: [] },
    { tnf: 5, type: 'T', id: [], payload: [] }, { tnf: 2, type: '', id: [], payload: [] },
    { ...preserved[0], id: '0' }, { ...preserved[0], id: 'zz' },
    { ...preserved[0], type: [255] }, { ...preserved[0], type: 'a'.repeat(256) },
    { ...preserved[0], id: Array(256).fill(0) }, { ...preserved[0], payload: [NaN] },
    { ...preserved[0], payload: [-1] }, { ...preserved[0], payload: [256] },
    { ...preserved[0], payload: Array(1) }, { ...preserved[0], payload: Array(65536).fill(0) }];
  for (const record of invalidRecords) {
    const read = await run({ records: [toNative([Ndef.uriRecord('https://a.co')])[0], record] }, true);
    assert.equal(read.reason, 'invalid_records'); assert.equal(read.preservedRecords, undefined);
    options = {}; events = [];
    assert.equal((await NfcService.writeUrls(['https://a.co'], { preservedRecords: [record] })).reason, 'invalid_records');
    assert.equal(events.includes('write'), false, 'Unsafe source data is never saved after dropping records');
  }
  for (const length of [254, 255, 256, 512, 65535]) {
    const record = { tnf: 2, type: 'application/octet-stream', id: [0, 255], payload: Array(length).fill(255) };
    assert.deepEqual(encodeNativeRecords(toNative([record])), Ndef.encodeMessage([record]));
  }
  for (const transform of [
    (r) => r.filter((_, i) => i !== mixedUrls.length),
    (r) => [...r, r[mixedUrls.length]],
    (r) => { [r[3], r[4]] = [r[4], r[3]]; return r; },
    (r) => r.map((v, i) => i === 3 ? { ...v, id: 'ff00' } : v),
    (r) => r.map((v, i) => i === 3 ? { ...v, payload: [...v.payload, 0] } : v),
    (r) => r.map((v, i) => i === 3 ? { ...v, type: [88] } : v),
    (r) => r.map((v, i) => i === 3 ? { ...v, tnf: 2 } : v),
  ]) assert.equal((await run({ transform }, false, mixedUrls, { preservedRecords: mixedRead.preservedRecords })).reason,
    'verify_mismatch', 'URL match alone cannot certify preserved bytes or their order');
  let releaseSnapshot;
  options = { requestGate: { promise: new Promise((r) => { releaseSnapshot = r; }) } }; events = [];
  const mutablePreserved = structuredClone(toNative(preserved));
  const mutableWriteOptions = { preservedRecords: mutablePreserved };
  const fullSnapshot = NfcService.writeUrls(mixedUrls, mutableWriteOptions);
  await new Promise(setImmediate);
  mutablePreserved.reverse(); mutablePreserved[0].payload.fill(0); mutablePreserved[0].type[0] = 0;
  mutableWriteOptions.preservedRecords = [];
  releaseSnapshot();
  assert.equal((await fullSnapshot).ok, true);
  assert.deepEqual(written, Ndef.encodeMessage([...mixedUrls.map((u) => Ndef.uriRecord(u)), ...preserved]));
  console.log('PASS: A5 native mixed/non-URL/fallback selection, raw fields/hex IDs/duplicates/AAR replacement, complete capacity boundaries, malformed rejection, payload 254..65535, full-field/order verification, pending deep snapshot');

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
  const originalUrls = [
    'HTTPS://Example.COM:443/A%2fb?token=A~B&utm_source=other&flag#Keep',
    'https://www.instagram.com/Mixed_Name/',
    'HTTPS://Example.COM:443/A%2fb?token=A~B&utm_source=other&flag#Keep',
    'https://example.com/한글',
  ];
  assert.deepEqual((await run({ records: toNative(originalUrls.map((url) => Ndef.uriRecord(url))) }, true)).urls,
    originalUrls, 'Read keeps original URL strings, record order and duplicate records');
  const textUrls = ['https://example.com/A?utm_source=other&token=A~B', 'https://example.com/A?utm_source=other&token=A~B'];
  assert.deepEqual((await run({ records: toNative(textUrls.map((url) => Ndef.textRecord(url))) }, true)).urls, textUrls);
  const emptyRecord = { tnf: Ndef.TNF_EMPTY, type: [], id: '', payload: [] };
  for (const records of [[], [emptyRecord], [emptyRecord, emptyRecord]]) {
    for (const writable of [true, false]) {
      const empty = await run({ records, status: { status: writable ? 2 : 3, capacity: 137 } }, true);
      assert.equal(empty.reason, 'no_url');
      assert.deepEqual(empty.urls, []);
      assert.equal(empty.capacity, 137);
      assert.equal(empty.writable, writable);
      assert.deepEqual(encodeNativeRecords(empty.preservedRecords), encodeNativeRecords(records), 'Valid EMPTY fields are also preserved');
    }
  }
  const missing = await run({ tagNull: true }, true);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'failed', 'A missing tag is not a blank tag');
  assert.equal(missing.urls, undefined);
  assert.equal(missing.capacity, undefined, 'Failed tag lookup must not supply blank-tag capacity');
  assert.equal(missing.writable, undefined);
  const invalid = await run({ records: [malformed] }, true);
  assert.equal(invalid.reason, 'no_url');
  assert.deepEqual(invalid.urls, []);
  assert.equal(invalid.preservedRecords.length, 1, 'Unextracted URI payload is preserved as bytes, not a blank tag');
  for (const [settings, reason] of [
    [{ supported: false }, 'unsupported'], [{ enabled: false }, 'disabled'], [{ supportError: true }, 'failed'],
  ]) {
    options = settings;
    events = [];
    assert.equal((await NfcService.readUrl()).reason, reason);
    assert.deepEqual(events, [], 'Unavailable NFC must not open a session');
  }
  // Native API boundaries, not timers, drive stage callbacks and reported bytes.
  const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
  const settle = () => new Promise(setImmediate);
  options = { requestGate: deferred(), writeGate: deferred(), freshGate: deferred() }; events = [];
  const stages = [];
  const input = ['https://example.com/한글', 'https://example.com/한글'];
  const original = [...input];
  const writing = NfcService.writeUrls(input, { onStage: (stage) => stages.push(stage) });
  await settle();
  assert.deepEqual(stages, ['waiting']); assert.equal(events.includes('write'), false);
  input[0] = 'https://changed.example';
  options.requestGate.resolve(); await settle();
  assert.deepEqual(stages, ['waiting', 'writing']); assert.equal(events.includes('fresh'), false);
  options.writeGate.resolve(); await settle();
  assert.deepEqual(stages, ['waiting', 'writing', 'verifying']);
  assert.equal(events.includes('cancel'), false, 'Session is open while verification waits');
  options.freshGate.resolve(); const verified = await writing;
  assert.equal(verified.ok, true);
  const expected = Ndef.encodeMessage(original.map((u) => Ndef.uriRecord(u)));
  assert.deepEqual(written, expected, 'Full message snapshot preserves duplicates and UTF-8');
  assert.equal(verified.usedBytes, expected.length, 'Final bytes come from actual encoded write');
  assert.equal(events.filter((e) => e === 'request').length, 1);

  for (const [gateName, expectedStages, laterEvent] of [
    ['requestGate', ['waiting'], 'status'], ['statusGate', ['waiting'], 'write'],
    ['writeGate', ['waiting', 'writing'], 'fresh'], ['freshGate', ['waiting', 'writing', 'verifying'], null],
  ]) {
    const gate = deferred(), abort = new AbortController(), phases = [];
    options = { [gateName]: gate }; events = [];
    const attempt = NfcService.writeUrls(original, { signal: abort.signal, onStage: (stage) => phases.push(stage) });
    await settle(); assert.deepEqual(phases, expectedStages);
    abort.abort(); gate.resolve();
    assert.equal((await attempt).reason, 'cancelled', `${gateName} abort cannot become verified success`);
    if (laterEvent) assert.equal(events.includes(laterEvent), false, `${gateName}: no native ${laterEvent} after abort`);
    assert.equal(events.filter((e) => e === 'cancel').length, 1, 'Abort and finally share cleanup');
  }
  // Options and URL snapshots are captured together before waiting for tag acquisition.
  options = { requestGate: deferred() }; events = [];
  const mutableUrls = ['https://www.instagram.com/snapshot/', 'https://example.com/한글'];
  const mutableOptions = { androidPackage: 'com.instagram.android' };
  const snapWrite = NfcService.writeUrls(mutableUrls, mutableOptions);
  await settle();
  mutableUrls.reverse(); mutableOptions.androidPackage = 'com.github.android';
  options.requestGate.resolve();
  const snapResult = await snapWrite;
  assert.equal(snapResult.ok, true); assert.equal(snapResult.androidPackage, 'com.instagram.android');
  assert.deepEqual(written, Ndef.encodeMessage([Ndef.uriRecord('https://www.instagram.com/snapshot/'),
    Ndef.uriRecord('https://example.com/한글'), Ndef.androidApplicationRecord('com.instagram.android')]));
  manager.setAlertMessage = async () => {};
  Platform.OS = 'ios';
  const iosResult = await run({}, false, ['https://example.com'], { androidPackage: 'com.instagram.android' });
  assert.equal(iosResult.ok, true); assert.equal(iosResult.androidPackage, undefined);
  assert.equal(Ndef.decodeMessage(written).length, 1, 'iOS retains its existing URL-only write');
  options = {}; events = [];
  assert.equal((await NfcService.writeUrls(['https://example.com'], { preservedRecords: [Ndef.textRecord('memo')] })).reason,
    'invalid_records', 'iOS URI-only scope cannot silently discard a preservation request');
  assert.equal(events.includes('write'), false);
  const iosMixed = await run({ records: toNative([Ndef.uriRecord('https://example.com'), Ndef.textRecord('memo')]) }, true);
  assert.equal(iosMixed.reason, 'invalid_records');
  assert.deepEqual(iosMixed.urls, ['https://example.com'], 'iOS keeps link viewing while mixed editing awaits separate approval');
  Platform.OS = 'android';
  options = { supportError: true }; events = [];
  assert.equal((await NfcService.writeUrls(original)).reason, 'failed', 'Readiness rejection returns a failure result');
  console.log('PASS: write snapshot/real UTF-8 byte length, native-gated waiting/write/verify stages, cancellation at request/status/write/fresh boundaries, one cleanup/no later write/no false success');
  console.log('PASS: native fields/ids, duplicate/order/byte comparison, fresh read/errors, status fail-closed, malformed UTF-8, session cleanup');
  console.log('PASS: read URL strings/order/duplicates, []/TNF_EMPTY writable/read-only metadata, null tag failure without capacity, missing/invalid tag distinction, unavailable NFC');
})().catch((error) => { console.error(error); process.exitCode = 1; });
