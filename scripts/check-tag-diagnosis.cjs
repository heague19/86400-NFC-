// Run: node --unhandled-rejections=strict scripts/check-tag-diagnosis.cjs (no device/new dependencies).
// 5단계(③ 태그 상태 확인): 실제 nfcService.ts + 실제 Home/TagRead/LinkEdit/TagInfo 화면을 작은 hook host와
// 설치된 StackRouter 위에서 실행한다. 모의하는 것은 네이티브 NfcManager 경계(요청·상태·태그·쓰기)뿐이다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { StackRouter } = require('@react-navigation/routers');
const hardwareBack = require('./hardware-back-harness.cjs');
const Ndef = require('react-native-nfc-manager/ndef-lib');
const root = path.resolve(__dirname, '..');

// ---------- hook host (check-link-edit.cjs와 같은 방식) ----------
let currentHost;
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  createContext: () => ({ Provider: 'Provider' }),
  useContext: () => currentHost.harness.provider.tree.props.value,
  useState: (initial) => {
    const host = currentHost;
    const index = host.cursor++;
    if (!host.slots[index]) host.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
    const slot = host.slots[index];
    return [slot.value, (next) => {
      if (!host.alive) return;
      const value = typeof next === 'function' ? next(slot.value) : next;
      if (!Object.is(value, slot.value)) { slot.value = value; host.dirty = true; }
    }];
  },
  useRef: (initial) => {
    const host = currentHost;
    const index = host.cursor++;
    if (!host.slots[index]) host.slots[index] = { current: initial };
    return host.slots[index];
  },
  useMemo: (fn, deps) => {
    const host = currentHost;
    const index = host.cursor++;
    if (!sameDeps(host.slots[index]?.deps, deps)) host.slots[index] = { value: fn(), deps };
    return host.slots[index].value;
  },
  useCallback: (fn, deps) => React.useMemo(() => fn, deps),
  useEffect: (fn, deps) => {
    const host = currentHost;
    const index = host.cursor++;
    if (!sameDeps(host.slots[index]?.deps, deps)) {
      const previous = host.slots[index];
      const slot = host.slots[index] = { deps };
      host.effects.push(() => { previous?.cleanup?.(); slot.cleanup = fn(); });
    }
  },
};
class HookHost {
  constructor(harness, component, props) {
    Object.assign(this, { harness, component, props, slots: [], effects: [], alive: true, dirty: true });
  }
  render() {
    this.dirty = false; this.cursor = 0; currentHost = this;
    this.tree = this.component(this.props);
    for (const effect of this.effects.splice(0)) effect();
    currentHost = undefined;
  }
  dispose() { for (const slot of this.slots) slot?.cleanup?.(); this.alive = false; }
}
function load(file, imports) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}

// ---------- mocked native boundary (only this is fake) ----------
const Platform = { OS: 'android' };
const NdefStatus = { NotSupported: 1, ReadWrite: 2, ReadOnly: 3 };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const toNative = (records) => records.map((record) => ({
  ...record, type: Ndef.util.stringToBytes(record.type), id: Ndef.util.bytesToHexString(record.id),
}));
// Installed Android handler itself: native lookup errors become NotSupported/0.
const { NdefHandler } = load('node_modules/react-native-nfc-manager/src/NfcTech/NdefHandler.js', {
  'react-native': { Platform: { OS: 'android' } },
  '../NativeNfcManager': { callNative: async () => { throw new Error('tag lost'); } },
  '../NfcError': { handleNativeException: (promise) => promise },
});
const androidHandler = new NdefHandler();
const ANDROID_NDEF = 'android.nfc.tech.Ndef';

let cfg, events, sessionOpen, heldRequest, calls;
function native(config = {}) {
  cfg = { ...config }; events = []; sessionOpen = false; heldRequest = undefined; calls = { supported: 0 };
}
const manager = {
  isSupported: async () => { ++calls.supported; await cfg.supportGate?.promise; if (cfg.supportError) throw new Error('support query failed'); return cfg.supported !== false; },
  start: async () => {},
  isEnabled: async () => cfg.enabled !== false,
  requestTechnology: async () => {
    events.push('request');
    // Android answers ERR_MULTI_REQ while an earlier technology request is still registered.
    if (sessionOpen) throw new Error('You can only issue one request at a time');
    if (cfg.requestError) throw new Error(cfg.requestError);
    sessionOpen = true;
    if (cfg.holdRequest) await new Promise((resolve, reject) => { heldRequest = { resolve, reject }; });
    await cfg.requestGate?.promise;
    return Object.hasOwn(cfg, 'connected') ? cfg.connected : 'Ndef';
  },
  cancelTechnologyRequest: async () => {
    events.push('cancel');
    heldRequest?.reject(new Error('cancelled')); heldRequest = undefined;
    await cfg.cleanupGate?.promise;
    sessionOpen = false;
  },
  getTag: async () => {
    events.push('tag');
    const tag = cfg.tag ?? { ndefMessage: [] };
    await cfg.tagGate?.promise;
    if (cfg.tagError) throw new Error('tag lookup failed');
    if (cfg.tagNull) return null;
    return tag;
  },
  ndefHandler: {
    getNdefStatus: async () => {
      events.push('status');
      await cfg.statusGate?.promise;
      if (cfg.statusError) throw new Error('status query failed');
      if (cfg.nativeStatusError) return androidHandler.getNdefStatus();
      return Object.hasOwn(cfg, 'status') ? cfg.status : { status: 2, capacity: 137 };
    },
    writeNdefMessage: async (bytes) => {
      events.push('write'); cfg.written = bytes;
      if (cfg.writeError) throw new Error('tag lost');
    },
    getNdefMessage: async () => {
      events.push('fresh');
      return { ndefMessage: toNative(Ndef.decodeMessage(cfg.written)) };
    },
    makeReadOnly: async () => { events.push('lock'); },
  },
};
const normalizer = load('src/utils/urlNormalizer.ts', {});
const model = load('src/models/linkType.ts', {});
const aarModule = load('src/nfc/aar.ts', { 'react-native-nfc-manager': { Ndef }, '../models/linkType': model });
const size = load('src/utils/ndefSize.ts', { 'react-native-nfc-manager': { Ndef }, '../nfc/aar': aarModule });
const { NfcService: service } = load('src/nfc/nfcService.ts', {
  'react-native': { Platform },
  'react-native-nfc-manager': { __esModule: true, default: manager, Ndef, NdefStatus, NfcTech: { Ndef: 'Ndef' } },
  '../utils/urlNormalizer': normalizer, './aar': aarModule,
});

// ---------- screens ----------
const state = load('src/state/LinkWriterContext.tsx', {
  react: React, 'react-native': { Platform }, '@/models/linkType': model, '@/utils/ndefSize': size, '@/utils/urlNormalizer': normalizer,
});
const warnings = load('src/utils/linkWarnings.ts', { '@/utils/urlNormalizer': normalizer });
const tokens = load('src/theme/tokens.ts', {});
const placeholders = (...names) => Object.fromEntries(names.map((name) => [name, name]));
const openedUrls = [], copiedUrls = [];
const imports = {
  react: React,
  'react-native': { ...placeholders('Image', 'ScrollView', 'Text', 'View', 'Pressable', 'KeyboardAvoidingView', 'Switch', 'Modal'),
    StyleSheet: { create: (v) => v }, Alert: { alert: () => {} }, Linking: { openURL: async (url) => { openedUrls.push(url); } }, Platform },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  'expo-clipboard': { setStringAsync: async (url) => { copiedUrls.push(url); return true; } },
  '@/components/AppButton': placeholders('AppPrimaryButton', 'AppSecondaryButton'),
  '@/components/AppCards': placeholders('AppInfoCard', 'AppActionCard'),
  '@/components/DraggableLinkList': { DraggableLinkList: 'DraggableLinkList' },
  '@/components/AppCapacityGauge': placeholders('AppCapacityGauge'),
  '@/components/AppRingBadge': placeholders('AppRingBadge'),
  '@/components/AppTextField': placeholders('AppTextField'),
  '@/state/LinkWriterContext': state,
  '@/models/linkType': model,
  '@/utils/ndefSize': size,
  '@/utils/urlNormalizer': normalizer,
  '@/utils/linkWarnings': warnings,
  '@/nfc/nfcService': { NfcService: service },
  '@/nfc/aar': aarModule,
  '@/theme/icons': { APP_ICONS: { nfc: 'nfc', edit: 'edit', shield: 'shield' }, APP_LOGO: {}, linkTypeIcon: () => 1 },
  '@/theme/tokens': tokens,
};
for (const name of ['WriteWaiting', 'WriteFailure']) {
  imports[`@/screens/${name}Screen`] = load(`src/screens/${name}Screen.tsx`, imports);
}
const screens = {};
for (const name of ['Home', 'LinkEdit', 'TagRead', 'TagInfo']) {
  screens[name] = load(`src/screens/${name}Screen.tsx`, imports)[`${name}Screen`];
}
const RealGauge = load('src/components/AppCapacityGauge.tsx', imports).AppCapacityGauge;

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (tree.type === 'Modal' && !tree.props.visible) return [];
  if (tree.type === 'DraggableLinkList') return [tree, ...nodes(tree.props.header), ...tree.props.links.flatMap((l, i) => nodes(tree.props.renderRow(l, i))), ...nodes(tree.props.footer)];
  if (typeof tree.type === 'function' && tree.type.name.endsWith('Screen')) return [tree, ...nodes(tree.type(tree.props))];
  return [tree, ...nodes(tree.props?.children)];
}
const textOf = (tree) => nodes(tree).filter((n) => n.type === 'Text').flatMap((n) => n.props.children).join(' ').replace(/\s+/g, ' ');

function assertAarCards(h, labels) {
  const rendered = nodes(h.editor.tree);
  const cards = rendered.filter((n) => n.type === 'View' && n.props.children.some((child) =>
    child?.type === 'Text' && textOf(child) === '앱 바로 열기 레코드'));
  assert.deepEqual(cards.map(textOf), labels.map((label) => `앱 바로 열기 레코드 ${label} 태그에 저장됨`));
  for (const card of cards) {
    assert.ok(nodes(card).every((n) => n.type !== 'Pressable' && !n.props.onPress && !n.props.onLongPress), 'AAR card is read-only');
    const hint = rendered.findIndex((n) => n.type === 'Text' && textOf(n) === '탭하면 링크 열기 · 길게 누르면 주소 복사');
    assert.ok(hint > rendered.findLastIndex((n) => n.type === 'Pressable') && rendered.indexOf(card) > hint,
      'AAR cards follow the URL list and its open/copy hint');
    const linkStyle = h.find('Pressable').style({ pressed: false })[0];
    assert.equal(card.props.style[0], linkStyle, 'AAR reuses URL card border, padding and theme');
  }
}

class Harness {
  constructor() {
    this.hosts = new Map(); this.listeners = new Map(); this.focusListeners = new Map();
    this.router = StackRouter({ initialRouteName: 'Home' });
    this.options = { routeNames: ['Home', 'LinkEdit', 'TagRead', 'LinkTypeSelect', 'InstagramInput', 'CustomUrlInput', 'WriteComplete', 'TagInfo'],
      routeParamList: {}, routeGetIdList: {} };
    this.stack = this.router.getInitialState(this.options);
    this.hardwareBack = hardwareBack({
      canGoBack: () => this.router.getStateForAction(this.stack, { type: 'GO_BACK' }, this.options) !== null,
      goBack: () => this.dispatch({ type: 'GO_BACK' }),
    });
    this.provider = new HookHost(this, state.LinkWriterProvider, { children: null });
    this.sync(); this.flush();
  }
  get route() { return this.stack.routes[this.stack.index]; }
  get names() { return this.stack.routes.map((r) => r.name); }
  get editor() { return this.hosts.get(this.route.key); }
  get context() { return this.provider.tree.props.value; }
  nav(key) {
    return {
      isFocused: () => this.route.key === key,
      addListener: (event, fn) => {
        assert.ok(['blur', 'focus'].includes(event));
        const listeners = event === 'focus' ? this.focusListeners : this.listeners;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(fn);
        return () => listeners.get(key).delete(fn);
      },
      reset: (next) => this.dispatch({ type: 'RESET', payload: next }),
      navigate: (name, params) => this.dispatch({ type: 'NAVIGATE', payload: { name, params } }),
      replace: (name, params) => this.dispatch({ type: 'REPLACE', payload: { name, params } }),
    };
  }
  dispatch(action) {
    const previous = this.route;
    const next = this.router.getStateForAction(this.stack, action, this.options);
    assert.ok(next, `Rejected navigation: ${action.type}`);
    this.stack = this.router.getRehydratedState(next, this.options);
    if (previous.key !== this.route.key) for (const fn of this.listeners.get(previous.key) ?? []) fn();
    if (previous.key !== this.route.key) for (const fn of this.focusListeners.get(this.route.key) ?? []) fn();
    this.sync(); this.flush();
  }
  sync() {
    for (const [key, host] of this.hosts) {
      if (!this.stack.routes.some((r) => r.key === key)) { host.dispose(); this.hosts.delete(key); }
    }
    for (const route of this.stack.routes) {
      if (!screens[route.name]) continue;
      const host = this.hosts.get(route.key);
      if (!host) this.hosts.set(route.key, new HookHost(this, screens[route.name], { navigation: this.nav(route.key), route }));
      else if (host.props.route !== route) { host.props.route = route; host.dirty = true; }
    }
  }
  flush() {
    for (let i = 0; i < 30; ++i) {
      const dirty = [this.provider, ...this.hosts.values()].filter((h) => h.alive && h.dirty);
      if (!dirty.length) return;
      for (const host of dirty) {
        host.render();
        if (host === this.provider) for (const consumer of this.hosts.values()) consumer.dirty = true;
      }
    }
    assert.fail('Hooks failed to settle');
  }
  async settle() { for (let i = 0; i < 3; ++i) { await new Promise(setImmediate); this.flush(); } }
  find(type, predicate = () => true) {
    const node = nodes(this.editor.tree).find((n) => n.type === type && predicate(n.props));
    assert.ok(node, `Missing ${String(type)} on ${this.route.name}`);
    return node.props;
  }
  has(type, predicate = () => true) { return nodes(this.editor.tree).some((n) => n.type === type && predicate(n.props)); }
  labels() { return nodes(this.editor.tree).filter((n) => n.props?.label && n.props.onPress).map((n) => n.props.label); }
  items() { return Object.fromEntries(nodes(this.editor.tree).filter((n) => n.type?.name === 'InfoItem').map((n) => [n.props.label, n.props.value])); }
  text() { return textOf(this.editor.tree); }
  press(label) {
    const node = nodes(this.editor.tree).find((n) => n.props?.label === label && n.props.onPress);
    assert.ok(node, `Missing button "${label}" on ${this.route.name}; have: ${this.labels()}`);
    assert.ok(!node.props.disabled && !node.props.loading, `Inactive button: ${label}`);
    const result = node.props.onPress();
    this.flush();
    return result;
  }
  card(title) { return this.find('AppActionCard', (p) => p.title === title); }
  back() { assert.equal(this.hardwareBack.press(), true, 'Hardware back is consumed on a child screen'); }
  dispose() { this.hardwareBack.dispose(); for (const host of [this.provider, ...this.hosts.values()]) host.dispose(); }
}

// ---------- fixtures ----------
const U1 = 'https://example.com';
const U2 = 'https://www.instagram.com/Mixed_Name/';
const uri = (u) => Ndef.uriRecord(u);
const encoded = (records) => Ndef.encodeMessage(records).length;
const tagOf = (records, extra = {}) => ({ ndefMessage: toNative(records), ...extra });
const emptyRecord = { tnf: Ndef.TNF_EMPTY, type: [], id: '', payload: [] };
const aar = Ndef.androidApplicationRecord('com.instagram.android');
const mime = Ndef.mimeMediaRecord('application/vnd.example', [1, 2, 3]);
const rw = (capacity = 137) => ({ status: 2, capacity });
const ro = (capacity = 137) => ({ status: 3, capacity });
// Android evidence of a non-NDEF tag: tag detected, Ndef tech not matched.
const nonNdef = { connected: null, tag: { ndefMessage: [], techTypes: ['android.nfc.tech.NfcA', 'android.nfc.tech.NdefFormatable'] },
  nativeStatusError: true };
const unknownStatus = { nativeStatusError: true, tag: tagOf([uri(U1)]) };
const blockedEvents = ['write', 'fresh', 'lock'];
const noWrites = () => assert.ok(!events.some((e) => blockedEvents.includes(e)), `diagnosis must not write/lock: ${events}`);

async function inspect(config) {
  native(config);
  const result = await service.inspectTag();
  assert.equal(events.at(-1), 'cancel', 'Every attempted session must close');
  assert.equal(events.filter((e) => e === 'request').length, 1, 'No automatic retry');
  assert.equal(events.filter((e) => e === 'cancel').length, 1);
  noWrites();
  return result;
}

(async () => {
  // ===== 5-2 service: exact serialized bytes and record counts, URL-less/mixed/empty tags =====
  assert.equal(encoded([uri(U1)]), 16); assert.equal(encoded([Ndef.textRecord('Hi')]), 9);
  for (const [name, records, count, urls, literal] of [
    ['single URL', [uri(U1)], 1, [U1], 16],
    ['multiple URLs incl. duplicate', [uri(U1), uri(U2), uri(U1)], 3, [U1, U2, U1]],
    ['text only (no URL)', [Ndef.textRecord('Hi')], 1, [], 9],
    ['text holding a URL', [Ndef.textRecord('https://t.example')], 1, ['https://t.example']],
    ['non-URL MIME only', [mime], 1, [], 29],
    ['mixed URI+text+MIME+URI', [uri(U1), Ndef.textRecord('Hi'), mime, uri(U2)], 4, [U1, U2]],
    ['URI + application record', [uri(U1), aar], 2, [U1]],
  ]) {
    for (const [status, stateName] of [[rw(504), 'read_write'], [ro(504), 'read_only']]) {
      const r = await inspect({ status, tag: tagOf(records) });
      assert.equal(r.ok, true, name);
      assert.equal(r.state, stateName, name);
      assert.equal(r.capacity, 504, `${name}: capacity is the tag's returned value`);
      assert.equal(r.usedBytes, encoded(records), `${name}: bytes of the whole original message`);
      if (literal) assert.equal(r.usedBytes, literal);
      assert.equal(r.recordCount, count, `${name}: record count is not the URL count`);
      assert.deepEqual(r.urls, urls, name);
    }
    if (count !== urls.length) {
      assert.notEqual(size.NdefSize.estimateMessageBytes(urls), encoded(records), `${name}: URL-only estimate must not stand in`);
    }
  }
  assert.equal((await inspect({ status: rw(42), tag: tagOf([uri(U1)]) })).capacity, 42, 'Capacity follows the tag, never a constant');
  // Diagnosis counts what is really recorded: only a real no-message [] is 0 B / 0; a TNF_EMPTY record is a record.
  assert.deepEqual([3, 6, 0], [1, 2, 0].map((n) => Ndef.encodeMessage(Array.from({ length: n }, () => Ndef.emptyRecord())).length));
  for (const [records, bytes, count] of [[[], 0, 0], [[emptyRecord], 3, 1], [[emptyRecord, emptyRecord], 6, 2]]) {
    for (const [status, stateName] of [[rw(), 'read_write'], [ro(), 'read_only']]) {
      const r = await inspect({ status, tag: { ndefMessage: records } });
      assert.deepEqual([r.ok, r.state, r.capacity, r.usedBytes, r.recordCount, r.urls], [true, stateName, 137, bytes, count, []]);
    }
  }
  // The editor still starts from a URL-less blank tag on the same TNF_EMPTY tag (readUrl rule is a different question).
  native({ status: rw(), tag: { ndefMessage: [emptyRecord] } });
  const blankRead = await service.readUrl();
  assert.deepEqual([blankRead.ok, blankRead.reason, blankRead.urls, blankRead.capacity], [false, 'no_url', [], 137]);
  // Native field missing/invalid: no-message and failed-lookup look the same (Util.messageToJSON(null) -> key dropped),
  // so usage and record count are unknown, never a guessed [] / 0.
  for (const [name, tag] of [['field missing', {}], ['null', { ndefMessage: null }], ['number', { ndefMessage: 42 }],
    ['string', { ndefMessage: 'x' }], ['object', { ndefMessage: {} }], ['null record', { ndefMessage: [null] }]]) {
    for (const status of [rw(), ro()]) {
      const r = await inspect({ status, tag });
      assert.deepEqual([r.ok, r.capacity, r.usedBytes, r.recordCount, r.urls], [true, 137, undefined, undefined, []], name);
    }
  }
  // Message that cannot be serialized: bytes unknown (not guessed from URLs); the rest is still diagnosed.
  const broken = await inspect({ status: rw(), tag: { ndefMessage: [{ tnf: 1, type: [0xff], id: '', payload: [] }, ...toNative([uri(U1)])] } });
  assert.deepEqual([broken.ok, broken.usedBytes, broken.recordCount, broken.capacity], [true, undefined, 2, 137]);

  // ===== 5-3 service: three states + lookup failure; Android fallback is not proof of "unsupported" =====
  for (const config of [
    { statusError: true }, { nativeStatusError: true }, { status: null }, { status: { status: 99, capacity: 137 } },
    ...[0, -1, NaN, Infinity, undefined, 1.5].map((capacity) => ({ status: { status: 2, capacity } })),
    // Native fallback shape without evidence: connected tech is Ndef, so NotSupported/0 is only an error.
    { status: { status: 1, capacity: 0 }, tag: { ndefMessage: [], techTypes: ['android.nfc.tech.NfcA'] } },
  ]) {
    const r = await inspect({ tag: tagOf([uri(U1)]), ...config });
    assert.equal(r.ok, false); assert.equal(r.reason, 'status_unknown');
    assert.ok(!('capacity' in r) && !('usedBytes' in r) && !('recordCount' in r), 'Unknown status invents no values');
    assert.ok(!events.includes('tag'), 'Unconfirmed status must not go on to read the message');
  }
  const proven = await inspect(nonNdef);
  assert.deepEqual([proven.ok, proven.state], [true, 'not_ndef'], 'Detected tag without Ndef tech = NDEF 아님');
  assert.ok(proven.capacity === undefined && proven.usedBytes === undefined && proven.recordCount === undefined);
  assert.deepEqual(proven.urls, []);
  for (const [name, config] of [
    ['Ndef tech present, connect failed, no status error (real: cached status still answers)',
      { ...nonNdef, nativeStatusError: false, status: rw(), tag: tagOf([uri(U1)], { techTypes: ['android.nfc.tech.NfcA', ANDROID_NDEF] }) }],
    ['tag lookup throws', { ...nonNdef, tagError: true }],
    ['tag lookup returns null', { ...nonNdef, tagNull: true }],
    ['techTypes missing', { ...nonNdef, tag: { ndefMessage: [] } }],
    ['techTypes empty', { ...nonNdef, tag: { ndefMessage: [], techTypes: [] } }],
    ['request returned undefined (no match signal)', { ...nonNdef, connected: undefined }],
    ['request connected Ndef, lookup error', { ...nonNdef, connected: 'Ndef' }],
  ]) {
    const r = await inspect(config);
    assert.deepEqual([r.ok, r.reason], [false, 'status_unknown'], name);
  }
  // A failed connect on a real NDEF tag (null request result + Ndef in techTypes) must stop all three paths even
  // though the native status lookup itself still answers ReadWrite/ReadOnly with a real capacity.
  for (const status of [rw(), ro()]) {
    const connectFailed = { connected: null, status, tag: tagOf([uri(U1)], { techTypes: ['android.nfc.tech.NfcA', ANDROID_NDEF] }) };
    assert.deepEqual([(await inspect(connectFailed)).ok, (await inspect(connectFailed)).reason], [false, 'status_unknown']);
    native(connectFailed);
    assert.equal((await service.readUrl()).reason, 'status_unknown');
    native(connectFailed);
    assert.equal((await service.writeUrls([U1])).reason, 'status_unknown'); noWrites();
  }
  // Existing read/write paths use the same lookup and stay fail-closed; evidence only changes the reason.
  native(nonNdef);
  assert.equal((await service.readUrl()).reason, 'not_ndef');
  native(nonNdef);
  assert.equal((await service.writeUrls([U1])).reason, 'not_ndef'); noWrites();
  native({ ...nonNdef, connected: 'Ndef' });
  assert.equal((await service.writeUrls([U1])).reason, 'status_unknown'); noWrites();
  native({ ...nonNdef, connected: 'Ndef' });
  assert.equal((await service.readUrl()).reason, 'status_unknown');
  native({ status: ro(), tag: tagOf([uri(U1)]) });
  assert.equal((await service.writeUrls([U1])).reason, 'read_only'); noWrites();
  native({ status: ro(), tag: tagOf([uri(U1)]) });
  const readOnlyRead = await service.readUrl();
  assert.deepEqual([readOnlyRead.ok, readOnlyRead.writable, readOnlyRead.capacity], [true, false, 137]);
  // iOS reports NotSupported itself (mocked boundary only, no device): that path is preserved.
  Platform.OS = 'ios';
  const ios = await inspect({ status: { status: 1, capacity: 0 } });
  Platform.OS = 'android';
  assert.deepEqual([ios.ok, ios.state], [true, 'not_ndef']);

  // ===== service: unavailable NFC, cancellation, cleanup ordering =====
  for (const [config, reason] of [[{ supported: false }, 'unsupported'], [{ enabled: false }, 'disabled'], [{ supportError: true }, 'failed']]) {
    native(config);
    assert.equal((await service.inspectTag()).reason, reason); assert.deepEqual(events, [], 'Unavailable NFC opens no session');
  }
  native({ tagNull: true, status: rw() });
  assert.deepEqual([(await service.inspectTag()).ok, (await service.inspectTag()).reason], [false, 'failed'], 'Missing tag message is a failure, not a blank tag');
  for (const [gate, laterEvent] of [['requestGate', 'status'], ['statusGate', 'tag'], ['tagGate', null]]) {
    const hold = deferred(), abort = new AbortController();
    native({ [gate]: hold, status: rw(), tag: tagOf([uri(U1)]) });
    const attempt = service.inspectTag(abort.signal);
    await new Promise(setImmediate);
    abort.abort(); hold.resolve();
    const r = await attempt;
    assert.deepEqual([r.ok, r.reason], [false, 'cancelled'], `${gate}: aborted diagnosis never becomes a result`);
    if (laterEvent) assert.ok(!events.includes(laterEvent), `${gate}: no native ${laterEvent} after abort`);
    assert.equal(events.filter((e) => e === 'cancel').length, 1, 'Abort and finally share one cleanup');
    noWrites();
  }
  // whenIdle waits for the aborted session's cleanup; a following session cannot open before it.
  {
    const cleanup = deferred(), abort = new AbortController();
    native({ holdRequest: true, cleanupGate: cleanup, tag: tagOf([uri(U1)]) });
    const aborted = service.inspectTag(abort.signal);
    await new Promise(setImmediate);
    abort.abort(); cfg.holdRequest = false;
    let idle = false;
    const waiting = service.whenIdle().then(() => { idle = true; });
    const next = service.inspectTag();
    await new Promise(setImmediate);
    assert.equal(idle, false, 'whenIdle waits for native cleanup');
    assert.equal(events.filter((e) => e === 'request').length, 1, 'Next session waits for cleanup');
    cleanup.resolve(); await waiting;
    assert.equal(idle, true);
    assert.equal((await aborted).reason, 'cancelled');
    assert.equal((await next).ok, true, 'Next session opens after cleanup, no ERR_MULTI_REQ');
    assert.equal(events.filter((e) => e === 'request').length, 2);
  }

  // ===== 5-1 Home: third same-size button, navigation only =====
  const mixed = [uri(U1), Ndef.textRecord('Hi'), mime, uri(U2)];
  assert.equal(encoded(mixed), 84, '16 + 9 + 29 + 30 B');
  native({ status: rw(), tag: tagOf(mixed) });
  let h = new Harness();
  assert.deepEqual(nodes(h.editor.tree).filter((n) => n.type === 'AppActionCard').map((n) => n.props.title),
    ['링크 보기', '링크 편집', '태그 상태 확인']);
  assert.deepEqual([events.length, calls.supported], [0, 0], 'Rendering Home opens no NFC session');
  h.card('태그 상태 확인').onPress(); h.flush();
  assert.deepEqual(h.names, ['Home', 'TagInfo'], 'One tap from Home reaches ③');
  await h.settle();
  assert.deepEqual(events.slice(0, 2), ['request', 'status'], 'The read is started by ③ itself');
  // ===== 5-1/5-2/5-3 TagInfo screen over the real service =====
  assert.equal(events.filter((e) => e === 'request').length, 1, 'One tag contact for ③');
  noWrites();
  assert.ok(h.text().includes('정상'));
  assert.deepEqual(h.items(), {
    '전체 용량': '137 B', 사용량: '84 B', '남은 용량': '53 B', '기록된 레코드': '4개',
    'NDEF 포맷': '포맷됨', '쓰기 가능 여부': '가능',
  });
  const gauge = h.find('AppCapacityGauge');
  assert.deepEqual([gauge.used, gauge.total, gauge.linkCount], [84, 137, undefined]);
  // The shared gauge, fed the screen's real props, shows whole-message usage / measured total / remaining with no link wording.
  const shown = textOf(RealGauge(gauge));
  assert.ok(shown.includes('84') && shown.includes('/ 137 B') && shown.includes('여유 53 B') && !shown.includes('링크'), shown);
  assert.deepEqual(h.labels(), ['홈으로', '다시 확인'], '③ offers only Home and a user-initiated re-check');
  assert.ok(!h.labels().some((l) => /저장|쓰기|잠금|포맷|수정|추가|OPEN|COPY|열기|복사/.test(l)));
  assert.ok(!h.has('Pressable'), 'No open/copy rows on ③');
  h.press('홈으로');
  assert.deepEqual(h.names, ['Home']); noWrites();
  h.dispose();

  const open = async (config) => {
    native(config);
    const harness = new Harness();
    harness.card('태그 상태 확인').onPress(); harness.flush(); await harness.settle();
    return harness;
  };
  // 6-5: the native AAR (not the first URI's service) determines ①/③ status.
  for (const [packageName, label] of [
    ['com.instagram.android', 'Instagram'], ['com.github.android', 'GitHub'],
    ['com.linkedin.android', 'LinkedIn'], ['com.twitter.android', 'X'],
    ['com.zhiliaoapp.musically', 'TikTok'], ['com.google.android.youtube', 'YouTube'],
    ['org.example.unknown', 'org.example.unknown'],
  ]) {
    const records = [uri(U1), Ndef.androidApplicationRecord(packageName)];
    h = await open({ status: rw(504), tag: tagOf(records) });
    assert.equal(h.items()['앱 바로 열기'], `켜짐 · ${label}`);
    assert.equal(h.items()['사용량'], `${encoded(records)} B`);
    assert.equal(h.items()['기록된 레코드'], '2개'); noWrites(); h.dispose();
    native({ status: rw(504), tag: tagOf(records) }); h = new Harness();
    h.card('링크 보기').onPress(); h.flush(); await h.settle();
    assertAarCards(h, [label]);
    const readGauge = h.find('AppCapacityGauge');
    assert.deepEqual([readGauge.used, readGauge.total, readGauge.linkCount], [encoded(records), 504, 1]);
    const link = h.find('Pressable', (p) => p.onPress && p.onLongPress);
    await link.onPress(); await link.onLongPress();
    assert.equal(openedUrls.at(-1), U1); assert.equal(copiedUrls.at(-1), U1);
    h.press('수정하기'); await h.settle();
    assert.equal(h.context.aarEnabled, false, 'Read native AAR is display-only until new consent'); h.dispose();
  }
  h = await open({ status: rw(), tag: tagOf([uri(U1)]) });
  assert.equal(h.items()['앱 바로 열기'], undefined, 'No status row without AAR'); h.dispose();
  h = await open({ status: rw(), tag: tagOf([Ndef.androidApplicationRecord('org.example.unknown')]) });
  assert.equal(h.items()['앱 바로 열기'], '켜짐 · org.example.unknown', 'URL-less AAR remains diagnosable');
  assert.equal(h.items()['기록된 레코드'], '1개'); noWrites(); h.dispose();
  const badIdTag = tagOf([uri(U1), aar]); badIdTag.ndefMessage[1].id = 'bad-hex';
  const badPayloadTag = tagOf([uri(U1), aar]); badPayloadTag.ndefMessage[1].payload = [NaN];
  for (const [tag, expectedLabel] of [[badIdTag, 'Instagram'], [badPayloadTag, '패키지 확인 불가']]) {
    h = await open({ status: rw(), tag });
    assert.equal(h.items()['사용량'], '확인 불가'); assert.equal(h.items()['남은 용량'], '확인 불가');
    assert.equal(h.items()['기록된 레코드'], '2개'); assert.equal(h.items()['앱 바로 열기'], `켜짐 · ${expectedLabel}`);
    assert.equal(h.has('AppCapacityGauge'), false); h.dispose();
    native({ status: rw(), tag }); h = new Harness(); h.card('링크 보기').onPress(); h.flush();
    await h.settle();
    assert.equal(h.has('AppCapacityGauge'), false, 'Unreadable native whole-message never falls back to URL bytes');
    assert.ok(h.text().includes('사용량 확인 불가')); assert.ok(h.text().includes(U1));
    assertAarCards(h, [expectedLabel]);
    assert.ok(h.has('Pressable', (p) => p.onPress && p.onLongPress), 'Original URL open/copy remains available'); h.dispose();
  }
  for (const [extraRecords, labels] of [
    [[], []],
    [[aar, Ndef.androidApplicationRecord('org.example.unknown')], ['Instagram', 'org.example.unknown']],
    [[{ ...aar, payload: [] }, { ...aar, payload: [0xff] }], ['패키지 확인 불가', '패키지 확인 불가']],
  ]) {
    const records = [uri(U1), uri(U2), ...extraRecords];
    native({ status: rw(504), tag: tagOf(records) }); h = new Harness();
    h.card('링크 보기').onPress(); h.flush(); await h.settle();
    assertAarCards(h, labels);
    const gauge = h.find('AppCapacityGauge');
    assert.deepEqual([gauge.used, gauge.total, gauge.linkCount], [encoded(records), 504, 2], 'AAR is included exactly once in native usage, never in link count');
    const links = nodes(h.editor.tree).filter((n) => n.type === 'Pressable');
    assert.equal(links.length, 2, 'Only URI records are interactive');
    const openStart = openedUrls.length, copyStart = copiedUrls.length;
    for (const link of links) { await link.props.onPress(); await link.props.onLongPress(); }
    assert.deepEqual(openedUrls.slice(openStart), [U1, U2]); assert.deepEqual(copiedUrls.slice(copyStart), [U1, U2]);
    noWrites(); h.dispose();
  }
  console.log('PASS: read-only AAR cards after URI links/hint; native service/unknown/empty/malformed/multiple/absent; whole usage/capacity/link count unchanged; link open/copy intact');
  console.log('PASS: native AAR ①/③ six services + unknown + malformed payload, absence hidden, exact whole bytes/count, URL-less AAR diagnosis, unserializable AAR reports unknown usage with URL open/copy preserved');
  // Text-only, blank, unserializable tags show exact values or "확인 불가", no URL-derived stand-ins.
  h = await open({ status: rw(), tag: tagOf([Ndef.textRecord('Hi')]) });
  assert.deepEqual([h.items()['사용량'], h.items()['기록된 레코드'], h.items()['남은 용량']], ['9 B', '1개', '128 B']); h.dispose();
  // Real no-message [] = 0 B / 0개; one real TNF_EMPTY record = 3 B / 1개 — the gauge gets exactly these measured values.
  for (const [records, used, count, remain] of [[[], 0, '0개', '137 B'], [[emptyRecord], 3, '1개', '134 B'], [[emptyRecord, emptyRecord], 6, '2개', '131 B']]) {
    h = await open({ status: rw(), tag: { ndefMessage: records } });
    assert.deepEqual([h.items()['사용량'], h.items()['기록된 레코드'], h.items()['남은 용량'], h.items()['전체 용량']], [`${used} B`, count, remain, '137 B']);
    const emptyGauge = h.find('AppCapacityGauge');
    assert.deepEqual([emptyGauge.used, emptyGauge.total, emptyGauge.linkCount], [used, 137, undefined]);
    h.dispose();
  }
  h = await open({ status: rw(), tag: { ndefMessage: [{ tnf: 1, type: [0xff], id: '', payload: [] }] } });
  assert.deepEqual([h.items()['사용량'], h.items()['남은 용량'], h.items()['기록된 레코드']], ['확인 불가', '확인 불가', '1개']);
  assert.ok(!h.has('AppCapacityGauge'), 'No gauge without a measured used value'); h.dispose();
  // Native message field missing/invalid: state and capacity are real, usage/remaining/records are 확인 불가, no gauge (no guessed denominator or []).
  for (const tag of [{}, { ndefMessage: null }, { ndefMessage: 42 }]) {
    h = await open({ status: rw(), tag });
    assert.ok(h.text().includes('정상'));
    assert.deepEqual([h.items()['전체 용량'], h.items()['사용량'], h.items()['남은 용량'], h.items()['기록된 레코드']], ['137 B', '확인 불가', '확인 불가', '확인 불가']);
    assert.ok(!h.has('AppCapacityGauge'), 'No gauge when the used bytes are unknown'); assert.ok(!h.has('AppInfoCard'));
    h.dispose();
  }
  // Three states + lookup failure are distinct screens.
  h = await open({ status: ro(), tag: tagOf([uri(U1)]) });
  assert.ok(h.text().includes('이 태그는 잠겨 있습니다')); assert.equal(h.items()['쓰기 가능 여부'], '불가');
  assert.ok(!h.text().includes('NDEF 태그가 아닙니다'));
  assert.deepEqual([h.find('AppCapacityGauge').used, h.find('AppCapacityGauge').total], [encoded([uri(U1)]), 137], 'ReadOnly also shows the gauge'); h.dispose();
  h = await open(nonNdef);
  assert.ok(h.text().includes('NDEF 태그가 아닙니다')); assert.ok(!h.text().includes('이 태그는 잠겨 있습니다'));
  assert.deepEqual(h.items(), { 'NDEF 포맷': '아님' }, 'No capacity/records are invented for a non-NDEF tag');
  assert.ok(!h.has('AppCapacityGauge')); h.dispose();
  h = await open(unknownStatus);
  const unknownCard = h.find('AppInfoCard');
  assert.equal(unknownCard.title, '태그 상태를 확인할 수 없습니다');
  assert.ok(unknownCard.message.includes('다시 대고'), 'Lookup failure asks to touch again');
  assert.deepEqual(h.items(), {}); assert.ok(!['정상', '잠겨 있습니다', 'NDEF 태그가 아닙니다'].some((t) => h.text().includes(t)));
  assert.deepEqual(h.labels(), ['홈으로', '다시 확인']);
  // Re-check is user-initiated only; a fresh contact replaces the previous diagnosis.
  const requestsBefore = events.filter((e) => e === 'request').length;
  await h.settle(); assert.equal(events.filter((e) => e === 'request').length, requestsBefore, 'No automatic retry');
  Object.assign(cfg, { nativeStatusError: false, status: rw(504), tag: tagOf([uri(U1)]) });
  await h.press('다시 확인'); await h.settle();
  assert.equal(h.items()['전체 용량'], '504 B'); assert.ok(!h.has('AppInfoCard'));
  assert.equal(events.filter((e) => e === 'request').length, requestsBefore + 1);
  h.back(); assert.deepEqual(h.names, ['Home'], 'Header/hardware back from ③ lands on Home');
  noWrites(); h.dispose();

  // ===== 5-1 cancel / late result / re-entry =====
  {
    native({ status: rw(), tag: tagOf([uri(U1)]), tagGate: deferred() });
    const oldGate = cfg.tagGate;
    h = new Harness(); h.card('태그 상태 확인').onPress(); h.flush(); await h.settle();
    assert.equal(h.has('AppCapacityGauge'), false, 'Waiting for the tag shows no data');
    h.dispatch({ type: 'NAVIGATE', payload: { name: 'LinkTypeSelect' } });   // blur while the read waits
    assert.equal(events.filter((e) => e === 'cancel').length, 1, 'Blur cancels the pending diagnosis once');
    oldGate.resolve(); await h.settle();
    h.back();
    assert.ok(h.find('AppInfoCard').message.includes('태그 확인이 중단되었습니다'), 'Late result of the cancelled read is dropped');
    assert.deepEqual(h.items(), {});
    cfg.tagGate = undefined; cfg.tag = tagOf([uri(U2), uri(U2)]); cfg.status = rw(504);
    await h.press('다시 확인'); await h.settle();
    assert.deepEqual([h.items()['전체 용량'], h.items()['기록된 레코드']], ['504 B', '2개'], 'Re-check shows the new tag only');
    h.dispose();

    // All existing exits abort; re-entry waits for cleanup, then ignores the old result.
    for (const departure of ['home', 'header', 'hardware']) {
      native({ status: rw(42), tag: tagOf([uri(U1)]), tagGate: deferred(), cleanupGate: deferred() });
      const staleGate = cfg.tagGate, cleanup = cfg.cleanupGate;
      h = new Harness(); h.card('태그 상태 확인').onPress(); h.flush(); await h.settle();
      if (departure === 'home') h.press('홈으로');
      else if (departure === 'header') h.dispatch({ type: 'POP', payload: { count: 1 }, source: h.route.key, target: h.stack.key });
      else h.back();
      assert.deepEqual(h.names, ['Home'], `${departure}: leaves a pending diagnosis`);
      assert.equal(events.filter((e) => e === 'cancel').length, 1);
      Object.assign(cfg, { status: rw(504), tag: tagOf([uri(U2)]), tagGate: undefined });
      h.card('태그 상태 확인').onPress(); h.flush(); await h.settle();
      assert.equal(events.filter((e) => e === 'request').length, 1, 'Re-entry waits for the previous session cleanup');
      cleanup.resolve(); cfg.cleanupGate = undefined; staleGate.resolve(); await h.settle();
      assert.equal(events.filter((e) => e === 'request').length, 2);
      assert.deepEqual([h.items()['전체 용량'], h.items()['사용량']], ['504 B', `${encoded([uri(U2)])} B`], 'Only the re-entered read is shown');
      noWrites(); h.dispose();
    }
  }

  // ===== 5-4 ① TagRead: anomaly guidance → ③ =====
  const readTag = async (config) => {
    native(config);
    const harness = new Harness();
    harness.card('링크 보기').onPress(); harness.flush(); await harness.settle();
    return harness;
  };

  // First focus owns one automatic read; later focus and failures require an explicit retry.
  const requests = () => events.filter((e) => e === 'request').length;
  native({ holdRequest: true, status: rw(504), tag: tagOf([uri(U1), uri(U2), uri(U1), aar]) });
  h = new Harness(); await h.settle();
  assert.equal(calls.supported, 0); assert.equal(requests(), 0, 'Home opens no NFC request');
  const view = h.card('링크 보기'); view.onPress(); h.flush(); view.onPress(); h.flush();
  const waiting = h.find('AppPrimaryButton');
  assert.equal(waiting.label, '태그를 대세요…'); assert.equal(waiting.loading, true);
  assert.equal(h.find('AppRingBadge').active, true);
  waiting.onPress(); waiting.onPress(); await h.settle();
  assert.equal(requests(), 1, 'Entry and duplicate taps open exactly one native read');
  heldRequest.resolve(); cfg.holdRequest = false; await h.settle();
  const resultTree = h.editor.tree;
  assertAarCards(h, ['Instagram']);
  const gaugeBefore = h.find('AppCapacityGauge');
  assert.deepEqual([gaugeBefore.used, gaugeBefore.total, gaugeBefore.linkCount],
    [encoded([uri(U1), uri(U2), uri(U1), aar]), 504, 3]);
  const links = nodes(resultTree).filter((n) => n.type === 'Pressable');
  assert.deepEqual(links.map((n) => textOf(n).includes('탭하면 이 링크가 열립니다')), [true, false, false]);
  const beforeOpen = openedUrls.length, beforeCopy = copiedUrls.length;
  for (const link of links) { await link.props.onPress(); await link.props.onLongPress(); }
  assert.deepEqual(openedUrls.slice(beforeOpen), [U1, U2, U1]);
  assert.deepEqual(copiedUrls.slice(beforeCopy), [U1, U2, U1]);
  for (const fn of h.listeners.get(h.route.key) ?? []) fn();
  for (const fn of h.focusListeners.get(h.route.key) ?? []) fn();
  await h.settle(); assert.equal(requests(), 1, 'External app return does not reread');
  h.press('수정하기'); await h.settle();
  assert.deepEqual(h.route.params, { urls: [U1, U2, U1], capacity: 504, writable: true });
  assert.equal(requests(), 1, 'Transfer opens zero reads');
  h.back(); await h.settle();
  assert.equal(h.text(), textOf(resultTree), 'Editor return retains result text');
  assert.deepEqual(h.find('AppCapacityGauge'), gaugeBefore, 'Editor return retains measured usage/capacity/count');
  assertAarCards(h, ['Instagram']);
  assert.equal(requests(), 1); noWrites(); h.back();
  h.card('링크 보기').onPress(); h.flush(); await h.settle();
  assert.equal(requests(), 2, 'Fresh entry from Home automatically reads again'); h.dispose();

  native({ status: rw(), tag: tagOf([uri(U1)]) }); h = new Harness();
  h.dispatch({ type: 'RESET', payload: { index: 2, routes: [{ name: 'Home' }, { name: 'TagRead' }, { name: 'LinkTypeSelect' }] } });
  await h.settle(); assert.equal(calls.supported, 0); assert.equal(requests(), 0, 'Unfocused mount cannot start');
  h.back(); await h.settle(); assert.equal(requests(), 1, 'First actual focus starts once');
  for (const fn of h.focusListeners.get(h.route.key) ?? []) fn();
  await h.settle(); assert.equal(requests(), 1); noWrites(); h.dispose();

  for (const config of [{ supported: false }, { supportError: true }]) {
    h = await readTag(config);
    assert.equal(h.find('AppInfoCard').title, 'NFC 미지원');
    assert.equal(h.find('AppPrimaryButton').disabled, true);
    assert.equal(requests(), 0, 'Unsupported or failed support query never opens NFC'); noWrites(); h.dispose();
  }
  for (const requestError of ['failed', 'cancelled', 'timeout']) {
    h = await readTag({ requestError });
    assert.equal(h.find('AppInfoCard').title, '읽기 실패');
    for (const fn of h.focusListeners.get(h.route.key) ?? []) fn();
    await h.settle(); assert.equal(requests(), 1, 'Failure/cancel/timeout does not repeat automatically');
    cfg.requestError = undefined; cfg.tag = tagOf([uri(U1)]);
    await h.press('태그 읽기'); await h.settle(); assert.equal(requests(), 2, 'Explicit retry opens one read');
    noWrites(); h.dispose();
  }
  for (const exit of ['header', 'hardware', 'blur', 'unmount']) {
    const supportGate = deferred(); native({ supportGate }); h = new Harness();
    h.card('링크 보기').onPress(); h.flush();
    const abandoned = h.editor;
    if (exit === 'header') h.dispatch({ type: 'POP', payload: { count: 1 } });
    else if (exit === 'hardware') h.back();
    else if (exit === 'blur') h.dispatch({ type: 'NAVIGATE', payload: { name: 'LinkTypeSelect' } });
    else h.dispose();
    if (exit === 'blur') { h.back(); await h.settle(); assert.equal(requests(), 0); }
    supportGate.resolve(); await h.settle();
    assert.equal(requests(), 0, `${exit} during support lookup cannot start a late session`);
    assert.ok(exit === 'blur' || !abandoned.alive); noWrites(); h.dispose();
  }
  for (const exit of ['header', 'hardware', 'blur', 'unmount']) {
    const staleGate = deferred(), cleanupGate = deferred();
    native({ tagGate: staleGate, cleanupGate, status: rw(), tag: tagOf([uri(U1)]) }); h = new Harness();
    h.card('링크 보기').onPress(); h.flush(); await h.settle();
    assert.equal(requests(), 1);
    const abandoned = h.editor;
    if (exit === 'header') h.dispatch({ type: 'POP', payload: { count: 1 } });
    else if (exit === 'hardware') h.back();
    else if (exit === 'blur') h.dispatch({ type: 'NAVIGATE', payload: { name: 'LinkTypeSelect' } });
    else h.dispose();
    await h.settle(); assert.equal(events.filter((e) => e === 'cancel').length, 1, `${exit} aborts own native request`);
    if (exit === 'unmount') {
      cleanupGate.resolve(); staleGate.resolve(); await h.settle(); noWrites(); continue;
    }
    if (exit === 'blur') { h.back(); await h.settle(); assert.equal(requests(), 1); }
    Object.assign(cfg, { tagGate: undefined, cleanupGate: undefined, tag: tagOf([uri(U2)]), status: rw(504) });
    if (exit === 'blur') h.press('태그 읽기');
    else { h.card('링크 보기').onPress(); h.flush(); }
    await h.settle(); assert.equal(requests(), 1, 'New read waits for cancelled native cleanup');
    cleanupGate.resolve(); await h.settle(); assert.equal(requests(), 2);
    staleGate.resolve(); await h.settle();
    assert.ok(h.text().includes(U2) && !h.text().includes(U1), 'Late response cannot overwrite new result');
    assert.equal(h.find('AppCapacityGauge').total, 504);
    assert.ok(exit === 'blur' || !abandoned.alive); noWrites(); h.dispose();
  }
  console.log('PASS: TagRead first-focus auto read once; Home/unsupported/support failure read0; initial waiting ring; duplicate taps; editor/external return retention; explicit retries only; delayed support/native results; header/hardware/blur/unmount abort; cleanup before fresh entry');

  h = await readTag({ status: ro(), tag: tagOf([uri(U1)]) });
  assert.equal(h.find('AppInfoCard').title, '읽기 전용 태그');
  assert.deepEqual(h.labels(), ['수정하기', '태그 상태 확인', '다시 읽기']);
  assert.ok(!h.labels().includes('상세 정보 보기'), 'Old URL-detail route is gone');
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '수정하기').disabled, true);
  h.dispose();
  h = await readTag({ status: rw(), tag: tagOf([uri(U1)]) });
  assert.deepEqual(h.labels(), ['수정하기', '다시 읽기'], 'Healthy tag: no diagnosis nag'); assert.ok(!h.has('AppInfoCard'));
  h.dispose();
  for (const [name, config] of [['not NDEF', nonNdef], ['lookup failed', unknownStatus]]) {
    h = await readTag(config);
    assert.equal(h.find('AppInfoCard').title, '읽기 실패', name);
    assert.deepEqual(h.labels(), ['태그 읽기', '태그 상태 확인'], name);
    h.dispose();
  }
  for (const [name, config] of [['text-only (no_url)', { status: rw(), tag: tagOf([Ndef.textRecord('Hi')]) }],
    ['tag missing', { status: rw(), tagNull: true }], ['NFC off', { enabled: false }], ['no NFC', { supported: false }]]) {
    h = await readTag(config);
    assert.ok(!h.labels().includes('태그 상태 확인'), `${name}: not a tag-state anomaly`);
    h.dispose();
  }
  // Opening ③ waits for an aborted earlier session's cleanup, then lands on [홈, ③] and reads once.
  native({ status: ro(), tag: tagOf([uri(U1)]) });
  h = new Harness(); h.card('링크 보기').onPress(); h.flush(); await h.settle();
  await h.settle();
  const cleanup = deferred(), abort = new AbortController();
  Object.assign(cfg, { holdRequest: true, cleanupGate: cleanup });
  const earlier = service.readUrl(abort.signal); await h.settle(); abort.abort();      // another session still closing
  cfg.holdRequest = false;
  const opening = h.press('태그 상태 확인'); await h.settle();
  assert.deepEqual(h.names, ['Home', 'TagRead'], 'Not opened while the previous session is still closing');
  h.press('태그 상태 확인');                                                          // double tap is ignored
  const requestsDuring = events.filter((e) => e === 'request').length;
  cleanup.resolve(); cfg.cleanupGate = undefined; await opening; await earlier; await h.settle();
  assert.deepEqual(h.names, ['Home', 'TagInfo']);
  assert.equal(events.filter((e) => e === 'request').length, requestsDuring + 1, 'Exactly one ③ session, after cleanup');
  assert.ok(h.text().includes('이 태그는 잠겨 있습니다'), '③ is not blocked by ERR_MULTI_REQ');
  h.back(); assert.deepEqual(h.names, ['Home']); noWrites(); h.dispose();
  // Leaving ① while waiting for the cleanup cancels the jump.
  native({ status: ro(), tag: tagOf([uri(U1)]) });
  h = new Harness(); h.card('링크 보기').onPress(); h.flush(); await h.settle();
  await h.settle();
  {
    const gate = deferred(), stop = new AbortController();
    Object.assign(cfg, { holdRequest: true, cleanupGate: gate });
    const other = service.readUrl(stop.signal); await h.settle(); stop.abort(); cfg.holdRequest = false;
    const jumping = h.press('태그 상태 확인'); await h.settle();
    h.back(); assert.deepEqual(h.names, ['Home']);
    gate.resolve(); cfg.cleanupGate = undefined; await jumping; await other; await h.settle();
    assert.deepEqual(h.names, ['Home'], 'No late jump to ③ after leaving ①');
  }
  h.dispose();
  // Leaving ① while its own read is waiting cancels that native request, so ③ can open right away.
  native({ holdRequest: true, status: rw(), tag: tagOf([uri(U1)]) });
  h = new Harness(); h.card('링크 보기').onPress(); h.flush(); await h.settle();
  await h.settle();
  assert.ok(sessionOpen, '① is waiting in a native request');
  h.back(); await h.settle();
  assert.equal(sessionOpen, false, 'Leaving ① closes its native request'); assert.equal(events.filter((e) => e === 'cancel').length, 1);
  cfg.holdRequest = false;
  h.card('태그 상태 확인').onPress(); h.flush(); await h.settle();
  assert.ok(h.text().includes('정상'), '③ right after leaving a waiting ① is diagnosed, not "태그를 찾지 못했습니다"');
  h.dispose();

  // ===== 5-4 ② LinkEdit: entry anomaly + write failure → ③ =====
  const editEntry = async (config) => {
    native(config);
    const harness = new Harness();
    harness.card('링크 편집').onPress(); harness.flush(); await harness.settle();
    return harness;
  };
  h = await editEntry({ status: ro(), tag: tagOf([uri(U1)]) });
  assert.ok(h.find('AppInfoCard').message.includes('읽기 전용')); assert.ok(h.labels().includes('태그 상태 확인'));
  await h.press('태그 상태 확인'); await h.settle();
  assert.deepEqual(h.names, ['Home', 'TagInfo']); assert.ok(h.text().includes('이 태그는 잠겨 있습니다')); noWrites(); h.dispose();
  for (const config of [nonNdef, unknownStatus]) {
    h = await editEntry(config);
    assert.ok(h.labels().includes('태그 상태 확인')); h.dispose();
  }
  for (const config of [{ tagNull: true }, { enabled: false }, { supported: false }]) {
    h = await editEntry({ status: rw(), tag: tagOf([uri(U1)]), ...config });
    assert.ok(!h.labels().includes('태그 상태 확인')); h.dispose();
  }
  // Write failure through the real service: links survive, ③ is one step away and writes nothing.
  native({ status: rw(), tag: tagOf([uri(U1), uri(U2)]), writeError: true });
  h = new Harness(); h.card('링크 편집').onPress(); h.flush(); await h.settle();
  const rowIds = h.context.links.map((l) => l.rowId), capacityBefore = h.context.capacity;
  await h.press('저장'); await h.settle();
  const failure = h.find(imports['@/screens/WriteFailureScreen'].WriteFailureScreen);
  assert.ok(failure.message.length > 0);
  assert.deepEqual(h.labels(), ['전체 재쓰기', '편집으로 돌아가기', '태그 상태 확인']);
  assert.equal(events.filter((e) => e === 'write').length, 1);
  cfg.writeError = false; cfg.status = ro(); // the tag turns out to be locked when diagnosed
  const afterFailure = events.length;
  await h.press('태그 상태 확인'); await h.settle();
  assert.deepEqual(h.names, ['Home', 'TagInfo']);
  assert.deepEqual(h.context.links.map((l) => l.rowId), rowIds, 'Opening ③ does not delete the edited links');
  assert.equal(h.context.capacity, capacityBefore);
  assert.deepEqual(events.slice(afterFailure).filter((e) => blockedEvents.includes(e)), [], 'No write/lock from the failure → ③ path');
  assert.equal(events.filter((e) => e === 'write').length, 1, 'No automatic rewrite');
  assert.ok(h.text().includes('이 태그는 잠겨 있습니다'));
  assert.deepEqual(h.labels(), ['홈으로', '다시 확인'], '③ → ② direct route does not exist');
  h.back(); assert.deepEqual(h.names, ['Home']); h.dispose();
  // Back to edit from the failure screen is untouched.
  native({ status: rw(), tag: tagOf([uri(U1)]), writeError: true });
  h = new Harness(); h.card('링크 편집').onPress(); h.flush(); await h.settle();
  await h.press('저장'); await h.settle(); h.press('편집으로 돌아가기');
  assert.ok(h.has('DraggableLinkList')); assert.equal(h.names.at(-1), 'LinkEdit'); h.dispose();
  // Failure screen waits for unfinished cleanup, and leaving the editor cancels the jump.
  native({ status: rw(), tag: tagOf([uri(U1)]), writeError: true });
  h = new Harness(); h.card('링크 편집').onPress(); h.flush(); await h.settle();
  await h.press('저장'); await h.settle();
  {
    const gate = deferred(), stop = new AbortController();
    Object.assign(cfg, { holdRequest: true, cleanupGate: gate, writeError: false });
    const other = service.readUrl(stop.signal); await h.settle(); stop.abort(); cfg.holdRequest = false;
    const jumping = h.press('태그 상태 확인'); await h.settle();
    assert.deepEqual(h.names, ['Home', 'LinkEdit'], 'Failure screen waits for session cleanup');
    h.back(); gate.resolve(); cfg.cleanupGate = undefined; await jumping; await other; await h.settle();
    assert.deepEqual(h.names, ['Home'], 'No late jump after leaving ②');
  }
  h.dispose();

  // ===== shared gauge: link wording only when links are being counted =====
  const gaugeText = (props) => textOf(RealGauge(props));
  assert.ok(gaugeText({ used: 70, total: 137 }).includes('여유 67 B') && !gaugeText({ used: 70, total: 137 }).includes('링크'));
  assert.ok(gaugeText({ used: 70, total: 137, linkCount: 4 }).includes('링크 4개 · 여유 67 B'));
  assert.ok(gaugeText({ used: 70, total: undefined }).includes('용량 확인 불가') && !gaugeText({ used: 70, total: undefined }).includes('링크'));
  assert.ok(gaugeText({ used: 14, total: undefined, linkCount: 1 }).includes('링크 1개 · 용량 확인 불가'));

  console.log('PASS: inspectTag exact whole-message bytes/recordCount/urls for multi-URL, duplicate, text-only, text-URL, MIME, mixed, AAR-like tags; real [] = 0/0 but TNF_EMPTY x1 = 3 B/1, x2 = 6 B/2 (readUrl still treats it as an editable blank); missing/invalid native message -> 확인 불가 (no guessed []); capacity from tag; unserializable -> 확인 불가');
  console.log('PASS: read_write/read_only/not_ndef + lookup failure; Android NotSupported/0 fallback stays status_unknown; requestTechnology===null is never ready: only techTypes without Ndef proves 미지원, Ndef present (connect failed, cached status still answering) = status_unknown for inspect/read/write with no write/lock');
  console.log('PASS: Home third button navigates only; ③ self-read once, 3 states/failure/values on screen, only 홈으로/다시 확인, no auto retry, blur/홈으로/header/hardware cancel + late result dropped + re-entry after cleanup');
  console.log('PASS: ①/② anomaly -> ③ ([홈, ③], after cleanup, leave cancels jump, no clear, no write), ② write failure -> ③, ① leaving cancels its native request; shared gauge wording');
})().catch((error) => { console.error(error); process.exitCode = 1; });
