// Run: node --unhandled-rejections=strict scripts/check-link-edit.cjs (no device/new dependencies).
// Transpile and execute the actual provider/screens with a small hook host and installed StackRouter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { StackRouter, StackActions } = require('@react-navigation/routers');
const hardwareBack = require('./hardware-back-harness.cjs');
const root = path.resolve(__dirname, '..');
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
    this.dirty = false;
    this.cursor = 0;
    currentHost = this;
    this.tree = this.component(this.props);
    for (const effect of this.effects.splice(0)) effect();
    currentHost = undefined;
  }
  dispose() {
    for (const slot of this.slots) slot?.cleanup?.();
    this.alive = false;
  }
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

const model = load('src/models/linkType.ts', {});
const aar = load('src/nfc/aar.ts', { 'react-native-nfc-manager': { Ndef: require('react-native-nfc-manager/ndef-lib') }, '../models/linkType': model });
const size = load('src/utils/ndefSize.ts', { 'react-native-nfc-manager': { Ndef: require('react-native-nfc-manager/ndef-lib') }, '../nfc/aar': aar });
const normalizer = load('src/utils/urlNormalizer.ts', {});
const state = load('src/state/LinkWriterContext.tsx', {
  react: React, 'react-native': { Platform: { OS: 'android' } }, '@/models/linkType': model, '@/utils/ndefSize': size, '@/utils/urlNormalizer': normalizer, '@/nfc/aar': aar,
});
const warnings = load('src/utils/linkWarnings.ts', { '@/utils/urlNormalizer': normalizer });
const tokens = load('src/theme/tokens.ts', {});
let reads = 0;
let writes = [];
let readResult;
let writeResult;
const service = { NfcService: {
  isSupported: async () => true,
  readUrl: async (signal) => { ++reads; return typeof readResult === 'function' ? readResult(signal) : readResult; },
  writeUrls: async (urls, options) => { writes.push(urls); return writeResult ? writeResult(urls, options) : { ok: true, message: 'saved', usedBytes: require('react-native-nfc-manager/ndef-lib').encodeMessage(urls.map((u) => require('react-native-nfc-manager/ndef-lib').uriRecord(u))).length }; },
} };
const accessibilityFocus = [];
const placeholders = (...names) => Object.fromEntries(names.map((name) => [name, name]));
const imports = {
  react: React,
  'react-native': { ...placeholders('Image', 'ScrollView', 'Text', 'View', 'Pressable', 'KeyboardAvoidingView', 'Switch', 'Modal'),
    AccessibilityInfo: { setAccessibilityFocus: (handle) => accessibilityFocus.push(handle) }, findNodeHandle: (ref) => ref?.node ?? null,
    StyleSheet: { create: (v) => v }, Alert: { alert: () => {} }, Linking: {}, Platform: { OS: 'android' } },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  'expo-clipboard': {},
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
  '@/nfc/nfcService': service,
  '@/nfc/aar': aar,
  '@/theme/icons': { APP_ICONS: {}, APP_LOGO: {}, linkTypeIcon: () => 1 },
  '@/theme/tokens': tokens,
};
for (const name of ['WriteWaiting', 'WriteFailure']) {
  imports[`@/screens/${name}Screen`] = load(`src/screens/${name}Screen.tsx`, imports);
}
const screens = {};
for (const name of ['Home', 'LinkEdit', 'TagRead', 'LinkTypeSelect', 'InstagramInput', 'CustomUrlInput', 'WriteComplete']) {
  screens[name] = load(`src/screens/${name}Screen.tsx`, imports)[`${name}Screen`];
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (tree.type === 'Modal' && !tree.props.visible) return [];
  if (tree.type === 'DraggableLinkList') return [tree, ...nodes(tree.props.header), ...tree.props.links.flatMap((l, i) => nodes(tree.props.renderRow(l, i))), ...nodes(tree.props.footer)];
  if (typeof tree.type === 'function' && tree.type.name.endsWith('Screen')) return [tree, ...nodes(tree.type(tree.props))];
  return [tree, ...nodes(tree.props?.children)];
}

class Harness {
  constructor() {
    reads = 0;
    writes = [];
    this.hosts = new Map();
    this.listeners = new Map();
    this.focusListeners = new Map();
    this.router = StackRouter({ initialRouteName: 'Home' });
    this.options = { routeNames: ['Home', 'LinkEdit', 'TagRead', 'LinkTypeSelect', 'InstagramInput', 'CustomUrlInput', 'WriteComplete', 'TagInfo'],
      routeParamList: {}, routeGetIdList: {} };
    this.stack = this.router.getInitialState(this.options);
    this.hardwareBack = hardwareBack({
      canGoBack: () => this.router.getStateForAction(this.stack, { type: 'GO_BACK' }, this.options) !== null,
      goBack: () => this.dispatch({ type: 'GO_BACK' }),
    });
    this.provider = new HookHost(this, state.LinkWriterProvider, { children: null });
    this.sync();
    this.flush();
  }
  get route() { return this.stack.routes[this.stack.index]; }
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
      reset: (state) => this.dispatch({ type: 'RESET', payload: state }),
      navigate: (name, params) => this.dispatch({ type: 'NAVIGATE', payload: { name, params } }),
      popTo: (...args) => this.dispatch(StackActions.popTo(...args)),
      replace: (name, params) => this.dispatch(StackActions.replace(name, params)),
    };
  }
  dispatch(action) {
    const previous = this.route;
    const next = this.router.getStateForAction(this.stack, action, this.options);
    assert.ok(next, `Rejected navigation: ${action.type}`);
    this.stack = this.router.getRehydratedState(next, this.options);
    if (previous.key !== this.route.key) for (const fn of this.listeners.get(previous.key) ?? []) fn();
    if (previous.key !== this.route.key) for (const fn of this.focusListeners.get(this.route.key) ?? []) fn();
    this.sync();
    this.flush();
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
        // A provider update also schedules every mounted context consumer.
        if (host === this.provider) for (const consumer of this.hosts.values()) consumer.dirty = true;
      }
    }
    assert.fail('Hooks failed to settle');
  }
  async settle() { await new Promise(setImmediate); this.flush(); }
  find(type, predicate = () => true) {
    const node = nodes(this.editor.tree).find((n) => n.type === type && predicate(n.props));
    assert.ok(node, `Missing ${type} on ${this.route.name}`);
    return node.props;
  }
  press(label) {
    const node = nodes(this.editor.tree).find((n) => n.props?.label === label && n.props.onPress);
    assert.ok(node, `Missing button: ${label}`);
    assert.ok(!node.props.disabled && !node.props.loading, `Inactive button: ${label}`);
    const result = node.props.onPress();
    this.flush();
    return result;
  }
  enterEdit() { this.find('AppActionCard', (p) => p.title === '링크 편집').onPress(); this.flush(); }
  back() { assert.equal(this.hardwareBack.press(), true, 'Hardware back is consumed on a child screen'); }
  dispose() { this.hardwareBack.dispose(); for (const host of [this.provider, ...this.hosts.values()]) host.dispose(); }
}

const urls = [
  'https://example.com/A%2fb?token=A~B&utm_source=other&flag#Keep',
  'https://www.instagram.com/Mixed_Name/',
  'https://example.com/A%2fb?token=A~B&utm_source=other&flag#Keep',
];
const success = (list = urls, capacity = 512) => ({ ok: true, url: list[0], urls: list, capacity, writable: true, usedBytes: require('react-native-nfc-manager/ndef-lib').encodeMessage(list.map((url) => require('react-native-nfc-manager/ndef-lib').uriRecord(url))).length, message: 'read' });
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const contextUrls = (h) => h.context.links.map((l) => l.normalizedUrl);
const NdefCodec = require('react-native-nfc-manager/ndef-lib');
const encodedBytes = (list) => NdefCodec.encodeMessage(list.map((url) => NdefCodec.uriRecord(url))).length;
const boundaryUrl = `https://example.com/${'a'.repeat(123)}`;
const invalidCapacities = [undefined, null, 0, -1, NaN, Infinity, 1.5, '144', Number.MAX_SAFE_INTEGER + 1];

(async () => {
  const rootBack = new Harness();
  assert.equal(rootBack.hardwareBack.press(), false, 'Home delegates back to Android');
  assert.equal(rootBack.hardwareBack.defaults, 1);
  assert.equal(rootBack.route.name, 'Home');
  rootBack.dispose();
  assert.equal(rootBack.hardwareBack.press(), false, 'Unmount removes the navigation back subscription');
  console.log('PASS: installed RN BackHandler + React Navigation back hook: Home default fallback and subscription cleanup');
  for (const screen of ['LinkEdit', 'TagRead', 'LinkTypeSelect', 'InstagramInput', 'CustomUrlInput']) {
    const destinations = [];
    for (const method of ['header', 'hardware']) {
      readResult = success();
      const harness = new Harness(); harness.enterEdit(); await harness.settle();
      const retained = harness.context.links;
      if (screen !== 'LinkEdit') harness.dispatch({ type: 'NAVIGATE', payload: { name: screen, params: { editIndex: 0 } } });
      if (screen.endsWith('Input')) { harness.find('AppTextField').onChangeText('unsaved draft'); harness.flush(); }
      // NativeStackView's header callback dispatches POP with the current route and stack keys.
      if (method === 'header') harness.dispatch({ ...StackActions.pop(), source: harness.route.key, target: harness.stack.key });
      else harness.back();
      destinations.push(harness.stack.routes.map((route) => route.name));
      assert.strictEqual(harness.context.links, retained, `${screen}/${method}: retained edits and row identities`);
      assert.equal(harness.context.capacity, 512);
      assert.equal(reads, 1, `${screen}/${method}: no tag reread on return`);
      harness.dispose();
    }
    assert.deepEqual(destinations[0], destinations[1], `${screen}: header and hardware reach the same previous screen`);
  }
  readResult = success();
  const completed = new Harness(); completed.enterEdit(); await completed.settle();
  const savedLinks = completed.context.links, editorKey = completed.route.key;
  completed.dispatch({ type: 'NAVIGATE', payload: { name: 'WriteComplete', params: { urls, usedBytes: encodedBytes(urls) } } });
  completed.back();
  assert.equal(completed.route.key, editorKey, 'Hidden header arrow does not disable the existing system-back POP');
  assert.strictEqual(completed.context.links, savedLinks);
  assert.equal(reads, 1, 'WriteComplete back retains the editor without rereading'); completed.dispose();
  console.log('PASS: header POP/hardware GO_BACK equivalence; input drafts leave retained edits intact; WriteComplete existing system-back policy');
  // 4-1/4-2: execute actual utilities, gauge, screens, provider and save handlers.
  assert.equal(encodedBytes([boundaryUrl]), 140, 'Same valid URL lies between 137 B and 144 B');
  for (const list of [[], [boundaryUrl], ['HTTPS://example.com/Mixed'], ['https://example.com/홍길동'],
    ['https://example.com/' + 'a'.repeat(254)], ['https://example.com/' + 'a'.repeat(300)],
    ['https://a.co', 'https://a.co', 'http://www.example.com/😀']]) {
    assert.equal(size.NdefSize.estimateMessageBytes(list), list.length ? encodedBytes(list) : 0);
    for (const url of list) assert.equal(size.NdefSize.estimateUrlRecordBytes(url), encodedBytes([url]));
  }
  const Gauge = load('src/components/AppCapacityGauge.tsx', imports).AppCapacityGauge;
  const textOf = (tree) => nodes(tree).filter((n) => n.type === 'Text').flatMap((n) => n.props.children).join(' ').replace(/\s+/g, ' ');
  for (const capacity of invalidCapacities) {
    assert.equal(size.NdefSize.canStoreAll(['https://a.co'], capacity), false);
    const gauge = Gauge({ used: 14, total: capacity, linkCount: 1 });
    assert.ok(textOf(gauge).includes('용량 확인 불가'));
    assert.ok(!textOf(gauge).includes('여유') && !textOf(gauge).includes('/'));
    assert.ok(!JSON.stringify(gauge).includes('width'), 'Unknown capacity has no percentage bar');

    for (const entry of ['read', 'params']) {
      readResult = { ...success(['https://a.co']), capacity };
      const unknown = new Harness();
      if (entry === 'read') unknown.enterEdit();
      else unknown.dispatch({ type: 'NAVIGATE', payload: { name: 'LinkEdit', params: { urls: ['https://a.co'], capacity, writable: true } } });
      await unknown.settle();
      assert.equal(unknown.context.capacity, undefined);
      assert.ok(!nodes(unknown.editor.tree).some((n) => n.props?.label === '저장'), `${entry}: bad capacity never opens editing`);
      assert.equal(writes.length, 0); unknown.dispose();
    }
    // Reader still shows measured usage without substituting a denominator.
    readResult = { ...success(['https://a.co']), capacity };
    const reader = new Harness();
    reader.dispatch({ type: 'NAVIGATE', payload: { name: 'TagRead' } }); await reader.settle();
    const readerGauge = reader.find('AppCapacityGauge');
    assert.ok(textOf(Gauge(readerGauge)).includes('용량 확인 불가'));
    assert.equal(readerGauge.used, encodedBytes(['https://a.co'])); reader.dispose();
  }
  for (const capacity of [137, 139, 140, 144, 512]) {
    assert.equal(size.NdefSize.canStoreAll([boundaryUrl], capacity), capacity >= 140);
    readResult = success([boundaryUrl], capacity);
    const boundary = new Harness(); boundary.enterEdit(); await boundary.settle();
    const gauge = boundary.find('AppCapacityGauge');
    assert.equal(gauge.total, capacity); assert.equal(gauge.used, 140);
    assert.ok(textOf(Gauge(gauge)).includes(`여유 ${Math.max(capacity - 140, 0)} B`));
    const save = boundary.find('AppPrimaryButton', (p) => p.label === '저장');
    assert.equal(save.disabled, capacity < 140);
    await save.onPress(); await boundary.settle();
    assert.equal(writes.length, capacity < 140 ? 0 : 1, 'Actual save handler enforces measured boundary');
    if (capacity >= 140) assert.equal(boundary.route.params.usedBytes, 140);
    boundary.dispose();
  }
  // Defensive guard also blocks a stale handler after context capacity becomes unavailable.
  readResult = success(['https://a.co'], 137);
  const staleCapacity = new Harness(); staleCapacity.enterEdit(); await staleCapacity.settle();
  for (const capacity of invalidCapacities) {
    staleCapacity.context.replaceFromTag(['https://a.co'], capacity); staleCapacity.flush();
    const save = staleCapacity.find('AppPrimaryButton', (p) => p.label === '저장');
    assert.equal(save.disabled, true); await save.onPress(); await staleCapacity.settle();
    assert.equal(writes.length, 0);
  }
  staleCapacity.dispose();
  console.log('PASS: actual serialized bytes (UTF-8, uppercase prefix, long payload, duplicates); 140 B URL blocked at 137/139 and saved at 140/144/512; unknown/zero/invalid capacity has no denominator and cannot save');

  readResult = success();
  let h = new Harness();
  h.context.replaceFromTag(['https://previous.example'], 42);
  h.flush();
  h.enterEdit();
  assert.equal(reads, 1, 'Home entry starts exactly one read');
  assert.deepEqual(contextUrls(h), [], 'Previous tag cleared before read completion');
  assert.equal(h.context.capacity, undefined);
  assert.ok(!nodes(h.editor.tree).some((n) => n.props?.label === '저장' || n.props?.label === '링크 추가'));
  await h.find('AppPrimaryButton').onPress();
  assert.equal(reads, 1, 'Rapid duplicate read actions do not open another session');
  await h.settle();
  assert.deepEqual(contextUrls(h), urls, 'Whole replacement preserves URL order, duplicates and strings');
  assert.deepEqual(h.context.links.map((l) => l.originalInput), urls);
  assert.equal(h.context.capacity, 512);
  assert.equal(h.find('AppCapacityGauge').total, 512, 'Gauge uses the read tag capacity');
  const editKey = h.route.key;
  h.press('링크 추가');
  h.find('AppActionCard', (p) => p.title === 'Instagram').onPress(); h.flush();
  h.find('AppTextField').onChangeText('new_account'); h.flush();
  h.press('다음');
  assert.equal(h.route.key, editKey, 'Add returns to the same mounted editor');
  assert.equal(reads, 1, 'Add return does not re-read');
  assert.deepEqual(contextUrls(h), [...urls, 'https://www.instagram.com/new_account/']);
  assert.equal(h.context.capacity, 512);
  assert.equal(h.find('AppCapacityGauge').total, 512, 'Input return retains measured gauge denominator');
  h.find('Pressable', (p) => nodes(p.children).some((n) => n.type === 'Text' && n.props.children.includes(urls[0]))).onPress();
  h.flush();
  assert.deepEqual(h.route.params, { editIndex: 0 });
  h.find('AppTextField').onChangeText('https://edited.example/updated'); h.flush();
  h.press('다음');
  assert.equal(h.route.key, editKey, 'Edit returns to the same editor');
  assert.equal(reads, 1);
  assert.deepEqual(contextUrls(h), ['https://edited.example/updated', ...urls.slice(1), 'https://www.instagram.com/new_account/']);
  assert.equal(h.find('AppCapacityGauge').total, h.context.capacity);
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, false, 'The retained list fits the read 512 B capacity');
  h.context.removeLink(2); h.flush(); // Delete one row before saving the retained list.
  await h.press('저장'); await h.settle();
  assert.deepEqual(writes, [contextUrls(h)], 'Save uses the retained/edited full list');
  const retained = [...contextUrls(h)];
  h.dispatch({ type: 'NAVIGATE', payload: { name: 'LinkEdit', params: { urls: retained, capacity: h.context.capacity } } });
  assert.equal(reads, 1, 'A future completion can supply written URLs/capacity without a read');
  assert.deepEqual(contextUrls(h), retained);
  h.dispose();

  // 3-5 (F2/K12/K7): 고른 프리셋의 입력 화면과 §5.2 URL 패턴. Instagram으로 되돌아가지 않는다.
  const addPreset = (host, label, input) => {
    host.press('링크 추가');
    host.find('AppActionCard', (p) => p.title === label).onPress(); host.flush();
    host.find('AppTextField').onChangeText(input); host.flush();
  };
  readResult = success(['https://example.com/seed'], 512); h = new Harness(); h.enterEdit(); await h.settle();
  const seedKey = h.route.key;
  for (const [id, label, input, expected] of [
    ['x', 'X', 'hong', 'https://x.com/hong'],
    ['github', 'GitHub', 'octocat', 'https://github.com/octocat'],
    ['tiktok', 'TikTok', '@Hong.Gil', 'https://www.tiktok.com/@Hong.Gil'],
    ['youtube', 'YouTube', 'hong_yt', 'https://youtube.com/@hong_yt'],
    ['instagram', 'Instagram', 'Hong_Gil', 'https://www.instagram.com/Hong_Gil/'],
    ['linkedin', 'LinkedIn', 'hong.gil', 'https://linkedin.com/in/hong.gil'],
  ]) {
    addPreset(h, label, input);
    assert.equal(h.route.name, 'InstagramInput', `${label} uses the shared account screen`);
    assert.equal(h.find('AppInfoCard', (p) => p.title === '생성될 링크').message, expected, `${label} preview`);
    h.press('다음');
    assert.equal(h.route.key, seedKey, 'Preset add returns to the same editor');
    const added = h.context.links.at(-1);
    assert.equal(added.normalizedUrl, expected); assert.equal(added.linkType.id, id, `${label} must not become Instagram`);
    assert.equal(added.originalInput, input);
  }
  assert.equal(reads, 1, 'Preset adds never re-read the tag');
  // 기타는 URL 전체 입력. 허용 문자 검증이 없고 추적 파라미터는 현행대로 제거한다 (STATUS 판정 2).
  h.press('링크 추가'); h.find('AppActionCard', (p) => p.title === '직접 입력').onPress(); h.flush();
  assert.equal(h.route.name, 'CustomUrlInput');
  h.find('AppTextField').onChangeText('Example.com/a/b:c?utm_source=x&keep=1'); h.flush(); h.press('다음');
  assert.deepEqual([h.context.links.at(-1).linkType.id, h.context.links.at(-1).normalizedUrl], ['custom', 'https://example.com/a/b:c?keep=1']);
  // 다른 서비스 주소를 붙여넣으면 만들지 않고 기타로 넘긴다 — 라벨이 붙여넣은 서비스가 되지 않는다.
  const beforePaste = h.context.links.length;
  addPreset(h, 'X', 'https://github.com/foo/bar');
  assert.ok(!nodes(h.editor.tree).some((n) => n.props?.title === '생성될 링크'), 'No preset URL for another domain');
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '다음').disabled, true);
  h.press('기타로 추가');
  assert.equal(h.route.name, 'CustomUrlInput'); assert.equal(h.route.params.initialText, 'https://github.com/foo/bar');
  assert.equal(h.find('AppTextField').value, 'https://github.com/foo/bar'); h.press('다음');
  assert.equal(h.route.key, seedKey);
  assert.deepEqual([h.context.links.length, h.context.links.at(-1).linkType.id, h.context.links.at(-1).normalizedUrl],
    [beforePaste + 1, 'custom', 'https://github.com/foo/bar']);
  // 같은 서비스 전체 URL 붙여넣기는 계정명만 꺼내 그 프리셋 패턴으로 조립한다.
  addPreset(h, 'X', 'https://twitter.com/hong?s=21'); assert.equal(h.find('AppInfoCard', (p) => p.title === '생성될 링크').message, 'https://x.com/hong');
  h.back(); h.back(); h.dispose();
  // 태그에서 읽은 URL은 계정 페이지일 때만 프리셋으로 분류한다 — 나머지는 기타(문자열·순서는 그대로).
  const tagUrls = ['https://github.com/org/repo', 'https://www.youtube.com/watch?v=abc', 'https://www.instagram.com/Mixed_Name/', 'https://example.com/seed'];
  readResult = success(tagUrls, 512); h = new Harness(); h.enterEdit(); await h.settle();
  assert.deepEqual(contextUrls(h), tagUrls);
  assert.deepEqual(h.context.links.map((l) => l.linkType.id), ['custom', 'custom', 'instagram', 'custom']);
  assert.ok(h.context.links.every((l) => l.fromTag));
  h.find('Pressable', (p) => nodes(p.children).some((n) => n.type === 'Text' && n.props.children.includes(tagUrls[2]))).onPress(); h.flush();
  assert.equal(h.route.name, 'InstagramInput'); assert.deepEqual(h.route.params, { editIndex: 2 });
  assert.equal(h.find('AppTextField').value, tagUrls[2]);
  assert.equal(h.find('AppInfoCard', (p) => p.title === '생성될 링크').message, tagUrls[2], 'Editing keeps the account');
  h.find('AppTextField').onChangeText('new_name'); h.flush(); h.press('다음');
  assert.equal(contextUrls(h)[2], 'https://www.instagram.com/new_name/'); assert.equal(h.context.links[2].fromTag, undefined);
  h.find('Pressable', (p) => nodes(p.children).some((n) => n.type === 'Text' && n.props.children.includes(tagUrls[0]))).onPress(); h.flush();
  assert.equal(h.route.name, 'CustomUrlInput', 'A github.com/org/repo row edits as 기타, not as a GitHub handle');
  h.dispose();

  // 3-7a (E5/K8/F7): 경고 배지. 중복은 추가·저장을 막지 않고, 허용 문자·형식 경고는 아직 배지만 먼저 만든 상태다.
  const cardOf = (host, kind) => nodes(host.editor.tree).filter((n) => n.type === 'AppInfoCard' && n.props.variant === 'warning' && n.props.title?.includes(kind));
  const tagRows = ['https://www.instagram.com/Mixed_Name/', 'https://www.instagram.com/Second_Tag_Row/', 'https://example.com/a'];
  readResult = success(tagRows, 512); h = new Harness(); h.enterEdit(); await h.settle();
  assert.equal(nodes(h.editor.tree).filter((n) => n.type === 'AppInfoCard' && n.props.variant === 'warning').length, 0,
    'Rows read from the tag load without warnings (T3), even two Instagram rows');
  const dupKey = h.route.key;
  addPreset(h, 'Instagram', 'new_account');
  assert.equal(cardOf(h, '중복').length, 1, 'Same-service duplicate shows a badge while typing');
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '다음').disabled, false, 'Duplicates never block adding');
  h.press('다음');
  assert.equal(h.route.key, dupKey); assert.equal(cardOf(h, '중복').length, 1, 'Only the new row carries the duplicate badge, and it stays visible');
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, false, 'A duplicate badge never blocks saving (K17: only over-capacity does)');
  // 기존 행을 고칠 때 자기 자신은 중복으로 세지 않는다
  h.context.removeLink(1); h.context.removeLink(0); h.flush(); // 남은 행: example.com/a(기타) + 새 Instagram(대표 아님)
  assert.equal(cardOf(h, '중복').length, 0, 'Removing the other same-service rows clears the badge');
  h.find('Pressable', (p) => nodes(p.children).some((n) => n.type === 'Text' && n.props.children.includes('https://www.instagram.com/new_account/'))).onPress(); h.flush();
  assert.deepEqual(h.route.params, { editIndex: 1 }); assert.equal(cardOf(h, '중복').length, 0, 'Editing the only Instagram row is not its own duplicate');
  h.back();
  addPreset(h, 'Instagram', 'second'); h.press('다음');
  assert.equal(cardOf(h, '중복').length, 2, 'Both rows of a user-made same-service pair carry the badge');
  h.find('Pressable', (p) => nodes(p.children).some((n) => n.type === 'Text' && n.props.children.includes('https://www.instagram.com/new_account/'))).onPress(); h.flush();
  assert.equal(cardOf(h, '중복').length, 1, 'Editing one of a pair sees the other as a duplicate');
  h.find('AppTextField').onChangeText('edited_name'); h.flush(); assert.equal(cardOf(h, '중복').length, 1); h.press('다음');
  // 기타는 저장 URL이 완전히 같을 때만
  addPreset(h, '직접 입력', 'https://example.com/a'); assert.equal(h.route.name, 'CustomUrlInput');
  assert.equal(cardOf(h, '중복').length, 1, '기타 identical to the tag row is a duplicate'); h.press('다음');
  h.press('링크 추가'); h.find('AppActionCard', (p) => p.title === '직접 입력').onPress(); h.flush();
  h.find('AppTextField').onChangeText('https://example.com/a/'); h.flush();
  assert.equal(cardOf(h, '중복').length, 0, '기타 with the same domain but another URL is not a duplicate');
  h.find('AppTextField').onChangeText('https://example.com/A'); h.flush(); assert.equal(cardOf(h, '중복').length, 0, 'Exact match is case-sensitive');
  h.back(); h.back();
  // 허용 문자·형식 경고도 같은 카드로 보인다
  addPreset(h, 'X', 'hong$');
  assert.equal(cardOf(h, '허용 문자').length, 1);
  h.back(); h.back();
  addPreset(h, 'YouTube', 'ab'); assert.equal(cardOf(h, '형식 이상').length, 1);
  h.dispose();

  // 3-7b (0-6): 경고는 추가·저장을 막지 않는다. 막는 것은 URL을 만들 수 없는 입력(빈 값·공백·다른 도메인·http(s) 아님)과 용량 초과뿐.
  const next = (host) => host.find('AppPrimaryButton', (p) => p.label === '다음').disabled;
  readResult = success(['https://example.com/seed'], 137); h = new Harness(); h.enterEdit(); await h.settle();
  const releaseKey = h.route.key;
  for (const [label, input, kind, expected] of [
    ['X', 'hong$', '허용 문자', 'https://x.com/hong$'],
    ['GitHub', '홍길동', '허용 문자', 'https://github.com/홍길동'],
    ['YouTube', 'ab', '형식 이상', 'https://youtube.com/@ab'],
    ['YouTube', 'a'.repeat(31), '형식 이상', `https://youtube.com/@${'a'.repeat(31)}`],
    ['Instagram', 'ok_name', '중복', 'https://www.instagram.com/ok_name/'],
  ]) {
    if (kind === '중복') { // 같은 서비스를 한 번 더 넣으면 중복이 된다
      addPreset(h, label, 'first'); h.press('다음');
    }
    addPreset(h, label, input);
    assert.equal(cardOf(h, kind).length, 1, `${label} ${input}: ${kind} badge`);
    assert.equal(next(h), false, `${label} ${input}: a warning must not block adding`);
    h.press('다음');
    assert.equal(h.route.key, releaseKey);
    assert.equal(h.context.links.at(-1).normalizedUrl, expected); assert.equal(h.context.links.at(-1).linkType.label, label);
    assert.ok(cardOf(h, kind).length >= 1, `${label} ${input}: the badge stays visible in the list`);
  }
  assert.ok(size.NdefSize.estimateMessageBytes(contextUrls(h)) > h.context.capacity);
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, true, 'Over-capacity (not the warnings) blocks saving');
  assert.equal(reads, 1);
  // 경고가 붙은 행을 다시 열면 같은 경고가 입력 화면에도 보인다
  h.find('Pressable', (p) => nodes(p.children).some((n) => n.type === 'Text' && n.props.children.includes('https://x.com/hong$'))).onPress(); h.flush();
  assert.equal(h.route.name, 'InstagramInput'); assert.equal(cardOf(h, '허용 문자').length, 1); h.back();
  // 저장은 경고 행을 포함한 전체 목록을 그대로 쓴다
  while (h.context.links.length > 2) { h.context.removeLink(h.context.links.length - 1); h.flush(); } // seed + hong$ 만 남겨 용량 이내로
  assert.ok(size.NdefSize.estimateMessageBytes(contextUrls(h)) <= h.context.capacity);
  assert.equal(cardOf(h, '허용 문자').length, 1);
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, false, 'Warnings never block saving');
  await h.press('저장'); await h.settle();
  assert.deepEqual(writes.at(-1), ['https://example.com/seed', 'https://x.com/hong$'], 'The warned URL is written as typed');
  // 형식 이상(공백이 든 계정명, 깨진 URL)도 경고와 함께 실제로 추가된다 — disabled만 푼 게 아니라 onNext도 추가한다 (§5.6).
  h.dispose(); readResult = success(['https://example.com/seed'], 512); h = new Harness(); h.enterEdit(); await h.settle();
  const releaseKey2 = h.route.key;
  for (const [label, input, expected, kind] of [
    ['X', 'bad name', 'https://x.com/bad%20name', '허용 문자'],
    ['X', 'ho ng', 'https://x.com/ho%20ng', '허용 문자'],
    ['Instagram', '@ hong', 'https://www.instagram.com/%20hong/', '허용 문자'],
    ['X', 'https://', 'https://x.com/https:', '허용 문자'],
    ['직접 입력', 'bad name', 'https://bad name', '형식 이상'],
    ['직접 입력', 'https://exa mple.com', 'https://exa mple.com', '형식 이상'],
    ['직접 입력', 'https://', 'https://', '형식 이상'],
  ]) {
    const before = h.context.links.length;
    addPreset(h, label, input);
    assert.equal(cardOf(h, kind).length, 1, `${label} ${JSON.stringify(input)}: ${kind} badge`);
    assert.equal(next(h), false, `${label} ${JSON.stringify(input)}: a format anomaly must not block adding`);
    h.press('다음');
    assert.equal(h.route.key, releaseKey2); assert.equal(h.context.links.length, before + 1, 'onNext really adds it');
    assert.equal(h.context.links.at(-1).normalizedUrl, expected);
    assert.equal(h.context.links.at(-1).originalInput, input.trim());
    assert.ok(cardOf(h, kind).length >= 1, 'The badge stays on the row');
  }
  h.context.removeLink(0); h.flush();
  while (h.context.links.length > 2) { h.context.removeLink(h.context.links.length - 1); h.flush(); }
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, false, 'Format warnings never block saving');
  await h.press('저장'); await h.settle();
  assert.deepEqual(writes.at(-1), ['https://x.com/bad%20name', 'https://x.com/ho%20ng'], 'Saved as built, whitespace encoded');
  h.dispose();
  // 그래도 추가할 것이 없는 입력은 막는다: 빈 값, `@`·`/`만 있는 값, 다른 도메인(기타 제안으로 대신), http(s)가 아닌 스킴(K9)
  readResult = success(['https://example.com/seed'], 512); h = new Harness(); h.enterEdit(); await h.settle();
  for (const [label, input] of [['X', ''], ['X', '   '], ['X', '@/'], ['X', ' @ / '],
      ['Instagram', 'https://github.com/foo'], ['Instagram', 'https://instagram.com/p/xyz/'], ['X', 'ftp://example.com/x'], ['X', 'ftp://a b']]) {
    addPreset(h, label, input);
    assert.equal(next(h), true, `${label} ${JSON.stringify(input)} has nothing to add`);
    h.back(); h.back();
  }
  for (const bad of ['', '   ', 'ftp://example.com/x', 'javascript:alert(1)', 'file:///etc/passwd', 'mailto:a@b.c']) {
    h.press('링크 추가'); h.find('AppActionCard', (p) => p.title === '직접 입력').onPress(); h.flush();
    h.find('AppTextField').onChangeText(bad); h.flush();
    assert.equal(next(h), true, `기타 ${JSON.stringify(bad)} stays blocked`); h.back(); h.back();
  }
  h.dispose();


  // 3-8 (F6): ②의 기타 행은 모두 "직접 입력"이 아니라 실제 도메인으로 보인다. ①도 같은 hostOf를 쓴다.
  const labels = (host) => nodes(host.editor.tree).filter((n) => n.type === 'Text').flatMap((n) => n.props.children).filter((c) => typeof c === 'string');
  const mixed = ['https://www.notion.so/page', 'https://velog.io/@someone', 'https://www.instagram.com/Mixed_Name/'];
  readResult = success(mixed, 512); h = new Harness();
  h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagRead' } }); await h.settle();
  assert.deepEqual(labels(h).filter((t) => ['notion.so', 'velog.io', 'Instagram', '직접 입력'].includes(t)), ['notion.so', 'velog.io', 'Instagram'], '① labels');
  h.press('수정하기'); await h.settle();
  assert.equal(h.route.name, 'LinkEdit');
  assert.deepEqual(labels(h).filter((t) => ['notion.so', 'velog.io', 'Instagram', '직접 입력'].includes(t)), ['notion.so', 'velog.io', 'Instagram'], '② labels match ①');
  addPreset(h, 'X', 'hong'); h.press('다음');
  h.press('링크 추가'); h.find('AppActionCard', (p) => p.title === '직접 입력').onPress(); h.flush();
  h.find('AppTextField').onChangeText('https://www.example.org/a?utm_source=x'); h.flush(); h.press('다음');
  const rows = labels(h).filter((t) => ['notion.so', 'velog.io', 'Instagram', 'X', 'example.org', '직접 입력'].includes(t));
  assert.deepEqual(rows, ['notion.so', 'velog.io', 'Instagram', 'X', 'example.org'], 'Three 기타 rows are told apart by domain; presets keep the service name');
  h.dispose();

  readResult = success(); h = new Harness();
  h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagRead' } });
  await h.settle();
  const beforeTransfer = reads;
  h.press('수정하기'); await h.settle();
  assert.equal(reads - beforeTransfer, 0, 'TagRead transfer starts zero reads');
  assert.deepEqual(h.route.params, { urls, preservedRecords: [], capacity: 512, writable: true });
  assert.deepEqual(contextUrls(h), urls);
  const suppliedParams = h.route.params;
  h.find('Pressable', (p) => nodes(p.children).some((n) => n.type === 'Text' && n.props.children.includes(urls[0]))).onPress(); h.flush();
  h.find('AppTextField').onChangeText('https://updated.example/path'); h.flush(); h.press('다음');
  assert.equal(h.route.params, suppliedParams, 'Input popTo merge preserves supplied entry params');
  assert.equal(reads, beforeTransfer);
  assert.equal(contextUrls(h)[0], 'https://updated.example/path', 'Return must not reload original supplied URLs');
  assert.equal(h.context.capacity, 512);
  h.dispose();

  readResult = success(); h = new Harness(); h.enterEdit(); await h.settle(); h.back();
  readResult = success(['https://new-tag.example'], 137); h.enterEdit(); await h.settle();
  assert.deepEqual(contextUrls(h), ['https://new-tag.example']); assert.equal(h.context.capacity, 137); h.back();
  readResult = { ok: false, reason: 'no_url', urls: [], capacity: 137, writable: true, message: 'no URLs' };
  h.enterEdit(); await h.settle();
  assert.deepEqual(contextUrls(h), []); assert.equal(h.context.capacity, 137);
  assert.equal(h.find('AppCapacityGauge').total, h.context.capacity);
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, true);
  h.press('링크 추가'); // A confirmed empty tag can start editing.
  h.dispose();

  for (const result of [
    ...['failed', 'cancelled', 'unsupported', 'disabled', 'not_ndef', 'status_unknown', 'unknown', 'no_url']
      .map((reason) => ({ ok: false, reason, message: reason })),
    { ok: false, reason: 'no_url', urls: [], capacity: 137, writable: false, message: 'read only' },
    { ok: false, reason: 'no_url', urls: [], writable: true, message: 'unknown capacity' },
    { ...success(), capacity: 0 }, { ...success(), writable: false },
    () => Promise.reject(new Error('unexpected read failure')),
  ]) {
    readResult = result; h = new Harness(); h.context.replaceFromTag(urls, 512); h.flush();
    h.enterEdit(); await h.settle();
    assert.deepEqual(contextUrls(h), []); assert.equal(h.context.capacity, undefined);
    assert.ok(!nodes(h.editor.tree).some((n) => n.props?.label === '저장' || n.props?.label === '링크 추가'));
    assert.equal(reads, 1, 'Read failure waits for a manual retry');
    assert.equal(writes.length, 0); h.dispose();
  }

  const old = deferred(); readResult = () => old.promise; h = new Harness(); h.enterEdit();
  const abandoned = h.editor;
  h.back(); readResult = success(['https://latest.example'], 256); h.enterEdit(); await h.settle();
  old.resolve(success(['https://stale.example'], 42)); await h.settle();
  assert.equal(abandoned.alive, false); assert.deepEqual(contextUrls(h), ['https://latest.example']);
  assert.equal(h.context.capacity, 256); h.dispose();

  const blurred = deferred(); readResult = () => blurred.promise; h = new Harness(); h.enterEdit();
  h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagInfo' } }); h.back();
  readResult = success(['https://retry.example'], 137);
  await h.press('다시 읽기'); await h.settle();
  blurred.resolve(success(['https://late-blurred.example'], 42)); await h.settle();
  assert.deepEqual(contextUrls(h), ['https://retry.example']); assert.equal(h.context.capacity, 137);
  h.dispose();

  readResult = success(); h = new Harness(); h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagRead' } });
  await h.settle();
  const pending = deferred(); readResult = () => pending.promise;
  const oldEdit = h.find('AppPrimaryButton', (p) => p.label === '수정하기').onPress;
  const first = h.press('다시 읽기');
  oldEdit(); // Even an already captured button must not open editing during a new read.
  assert.equal(h.route.name, 'TagRead');
  await h.settle(); // Let the retry reach readUrl before blurring; its late result must still be ignored.
  h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagInfo' } }); h.back();
  readResult = success(['https://latest-read.example'], 137);
  await h.press('태그 읽기'); await h.settle();
  pending.resolve(success(['https://stale-read.example'])); await first; await h.settle();
  h.press('수정하기'); assert.deepEqual(contextUrls(h), ['https://latest-read.example']);
  h.dispose();

  for (const reason of ['cancelled', 'failed', 'status_unknown']) {
    readResult = success(); h = new Harness(); h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagRead' } });
    await h.settle();
    readResult = { ok: false, reason, message: reason };
    await h.press('다시 읽기'); await h.settle();
    assert.ok(!nodes(h.editor.tree).some((n) => n.props?.label === '수정하기'));
    h.dispose();
  }
  for (const result of [{ ...success(), writable: false }, { ...success(), capacity: undefined }]) {
    readResult = result; h = new Harness(); h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagRead' } });
    await h.settle();
    const edit = h.find('AppPrimaryButton', (p) => p.label === '수정하기');
    assert.equal(edit.disabled, true); edit.onPress(); assert.equal(h.route.name, 'TagRead'); h.dispose();
  }

  // 3-9: 실제 provider의 행 ID/순서/대표 불변식 + 실제 터치 responder/레이아웃 핸들러.
  readResult = success(['https://a.co', 'https://dup.co', 'https://dup.co', 'https://d.co'], 137);
  h = new Harness(); h.enterEdit(); await h.settle();
  const ids = h.context.links.map((l) => l.rowId);
  assert.equal(new Set(ids).size, 4, 'Duplicate URLs have distinct row IDs');
  h.context.reorder(0, 3); h.context.reorder(3, 0);
  h.context.reorder(NaN, 2); h.context.reorder(1.5, 2); h.context.reorder(1, Infinity); h.flush();
  assert.deepEqual(h.context.links.map((l) => l.rowId), ids, 'Drag cannot move or replace the primary');
  h.context.reorder(1, 2); h.flush();
  assert.deepEqual(h.context.links.map((l) => l.rowId), [ids[0], ids[2], ids[1], ids[3]], 'Duplicate rows can reorder independently');
  h.context.updateLink(2, { ...h.context.links[2], normalizedUrl: 'https://edit.co' }); h.flush();
  assert.equal(h.context.links[2].rowId, ids[1], 'Editing keeps identity');
  h.context.setPrimary(2); h.flush();
  assert.equal(h.context.links[0].rowId, ids[1], 'Explicit selection changes primary');
  h.context.removeLink(0); h.flush();
  assert.equal(h.context.links[0].rowId, ids[0], 'Deleting primary promotes the next row');
  h.context.addLink({ ...h.context.links[1] }); h.flush();
  assert.equal(new Set(h.context.links.map((l) => l.rowId)).size, 4, 'Add always allocates a new identity');

  const dragImports = { react: React, 'react-native': { ...imports['react-native'],
    PanResponder: { create: (handlers) => ({ panHandlers: handlers }) } }, '@/theme/tokens': tokens };
  const { DraggableLinkList } = load('src/components/DraggableLinkList.tsx', dragImports);
  const drops = [], scrolling = [], draggingStates = [];
  const dragHost = new HookHost(h, DraggableLinkList, { links: h.context.links, cancelToken: 0,
    header: null, footer: null, renderRow: () => null,
    onReorder: (...args) => { drops.push(args); h.context.reorder(...args); h.flush(); },
    onDragging: (value) => draggingStates.push(value) });
  dragHost.render();
  dragHost.tree.props.ref.current = { measureInWindow: (fn) => fn(0, 100, 300, 300) };
  const scrollNode = nodes(dragHost.tree).find((n) => n.type === 'ScrollView');
  scrollNode.props.ref.current = { scrollTo: (v) => scrolling.push(v.y) };
  scrollNode.props.onLayout({ nativeEvent: { layout: { height: 300 } } });
  scrollNode.props.onContentSizeChange(300, 1000);
  const rowNodes = nodes(dragHost.tree).filter((n) => n.type === 'View' && n.props.key);
  const heights = [50, 70, 90, 110]; let y = 0;
  rowNodes.forEach((row, i) => { row.props.onLayout({ nativeEvent: { layout: { y, height: heights[i] } } }); y += heights[i]; });
  const listNode = nodes(dragHost.tree).find((n) => n.type === 'View' && n.props.onLayout && !n.props.key);
  listNode.props.onLayout({ nativeEvent: { layout: { y: 0 } } });
  const handles = nodes(dragHost.tree).filter((n) => typeof n.type === 'function');
  const handleHost = (i) => { const host = new HookHost(h, handles[i].type, handles[i].props); host.render(); return host; };
  const primaryHandle = handleHost(0);
  assert.equal(primaryHandle.tree.props.onStartShouldSetPanResponder(), false, 'Primary handle cannot start dragging');
  const handle = handleHost(1).tree.props;
  const event = (pageY) => ({ nativeEvent: { pageY } });
  assert.equal(handle.onStartShouldSetPanResponder(), true);
  handle.onPanResponderGrant(event(185)); handle.onPanResponderMove(event(365)); handle.onPanResponderRelease(event(365));
  assert.deepEqual(drops, [[1, 3]], 'Actual touch handle resolves unequal-height row drop');
  assert.equal(h.context.links[0].rowId, ids[0]);
  handle.onPanResponderGrant(event(185)); handle.onPanResponderMove(event(365)); handle.onPanResponderTerminate();
  assert.equal(drops.length, 1, 'Responder termination cancels drop');
  handle.onPanResponderGrant(event(185)); handle.onPanResponderMove(event(399));
  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.ok(scrolling.length >= 2 && scrolling.at(-1) > scrolling[0], 'Dragging near edge scrolls repeatedly');
  handle.onPanResponderTerminate();
  handle.onPanResponderGrant(event(185));
  rowNodes[2].props.onLayout({ nativeEvent: { layout: { y: 120, height: 130 } } });
  handle.onPanResponderRelease(event(365));
  assert.equal(drops.length, 1, 'Height changes safely cancel drop');
  handle.onPanResponderGrant(event(185)); handle.onPanResponderRelease(event(900));
  assert.equal(drops.length, 1, 'Dropping outside viewport cancels');
  handle.onPanResponderGrant(event(185)); dragHost.props = { ...dragHost.props, cancelToken: 1 }; dragHost.render();
  handle.onPanResponderRelease(event(365)); assert.equal(drops.length, 1, 'Screen departure cancels drag');
  dragHost.dispose(); primaryHandle.dispose();
  assert.equal(draggingStates.at(-1), false); h.dispose();

  // 3-10~12: 실제 저장 핸들러의 즉시 대기/중복 탭/후행 결과/실패 보존/이어쓰기.
  readResult = success(['https://a.co', 'https://b.co'], 137);
  h = new Harness(); h.enterEdit(); await h.settle();
  const originalKey = h.route.key, savedIds = h.context.links.map((l) => l.rowId);
  let pendingWrite = deferred(), writeOptions;
  writeResult = (_urls, opts) => { writeOptions = opts; return pendingWrite.promise; };
  const saveHandler = h.find('AppPrimaryButton', (p) => p.label === '저장').onPress;
  const firstSave = saveHandler(); saveHandler(); h.flush();
  assert.equal(writes.length, 1, 'Synchronous duplicate save starts only one session');
  assert.equal(h.find(imports['@/screens/WriteWaitingScreen'].WriteWaitingScreen).stage, 'waiting');
  writeOptions.onStage('writing'); h.flush();
  assert.equal(h.find(imports['@/screens/WriteWaitingScreen'].WriteWaitingScreen).stage, 'writing');
  writeOptions.onStage('verifying'); h.flush();
  assert.equal(h.find(imports['@/screens/WriteWaitingScreen'].WriteWaitingScreen).stage, 'verifying');
  assert.equal(h.route.name, 'LinkEdit', 'Verifying is never success');
  pendingWrite.resolve({ ok: false, reason: 'verify_mismatch', message: '일부만 기록되었을 수 있습니다.' });
  await firstSave; await h.settle();
  const failure = h.find(imports['@/screens/WriteFailureScreen'].WriteFailureScreen);
  assert.equal(failure.capacity, 137); assert.equal(failure.links[0].rowId, savedIds[0]);
  assert.ok(failure.message.includes('일부만'));
  assert.ok(!JSON.stringify(h.editor.tree).includes('verify_mismatch'), 'No raw error code in UI');
  assert.equal(writes.length, 1, 'Failure does not auto-retry');
  pendingWrite = deferred(); const rewrite = h.press('전체 재쓰기');
  assert.deepEqual(writes[1], writes[0], 'Whole rewrite keeps full ordered message');
  const continuationUrls = [...contextUrls(h)];
  pendingWrite.resolve({ ok: true, message: 'saved', usedBytes: 47 });
  await rewrite; await h.settle();
  assert.equal(h.route.name, 'WriteComplete'); assert.equal(h.route.params.usedBytes, 47);
  assert.ok(nodes(h.editor.tree).some((n) => n.type === 'Text' && n.props.children.includes(47)), 'Completion displays service bytes');
  assert.ok(!nodes(h.editor.tree).some((n) => n.props.label === '확인'));
  h.press('링크 더 추가하기');
  assert.equal(h.route.name, 'LinkTypeSelect'); assert.equal(reads, 1);
  assert.deepEqual(contextUrls(h), continuationUrls); assert.equal(h.context.capacity, 137);
  assert.deepEqual(h.context.links.map((l) => l.rowId), savedIds, 'Continuation preserves exact primary and row identities');
  h.find('AppActionCard', (p) => p.title === 'X').onPress(); h.flush();
  h.find('AppTextField').onChangeText('next'); h.flush(); h.press('다음');
  assert.equal(h.route.key, originalKey); assert.equal(reads, 1);
  assert.deepEqual(contextUrls(h), [...continuationUrls, 'https://x.com/next']); assert.equal(h.context.capacity, 137);
  assert.equal(h.find('AppCapacityGauge').total, 137, 'Completion then input return retains measured denominator');
  assert.equal(h.find('AppCapacityGauge').used, encodedBytes(contextUrls(h)), 'Continuation updates serialized usage');
  pendingWrite = deferred(); const continuation = h.press('저장');
  assert.equal(writes.length, 3, 'Continuation starts a new NFC write (requires tag contact)');
  pendingWrite.resolve({ ok: true, message: 'saved', usedBytes: 70 }); await continuation; await h.settle();
  h.press('완료'); assert.equal(h.route.name, 'Home');
  readResult = success(['https://new.co'], 512); h.enterEdit(); await h.settle();
  assert.equal(reads, 2); assert.deepEqual(contextUrls(h), ['https://new.co']); assert.equal(h.context.capacity, 512);
  h.dispose();

  for (const departure of ['cancel', 'blur', 'unmount', 'reject']) {
    h = new Harness(); h.enterEdit(); await h.settle(); pendingWrite = deferred();
    const saving = h.press('저장'); const oldOptions = writeOptions;
    if (departure === 'cancel') h.press('취소');
    else if (departure === 'blur') { h.dispatch({ type: 'NAVIGATE', payload: { name: 'LinkTypeSelect' } }); h.back(); }
    else if (departure === 'unmount') h.back();
    if (departure !== 'reject') assert.equal(oldOptions.signal.aborted, true, `${departure}: request aborts`);
    oldOptions.onStage('verifying');
    if (departure === 'reject') pendingWrite.reject(new Error('boundary failed'));
    else pendingWrite.resolve({ ok: true, message: 'late', usedBytes: 10 });
    await saving; await h.settle();
    assert.notEqual(h.route.name, 'WriteComplete', `${departure}: no late success navigation`);
    if (departure === 'reject') assert.ok(h.find(imports['@/screens/WriteFailureScreen'].WriteFailureScreen));
    h.dispose();
  }
  writeResult = undefined;

  // Run the actual service with the actual editor; only the native NFC boundary is mocked.
  const Ndef = require('react-native-nfc-manager/ndef-lib');
  let nativeTag, nativeCapacity = 137, holdRequest = false, pendingNativeRequest, cleanupGate;
  let nativeRequests = 0, nativeCancels = 0;
  let nativeWritten, nativeWriteGate, nativeVerifyGate, nativeMismatch = false;
  const nativeWriteMessages = [];
  const nativeManager = {
    isSupported: async () => true, start: async () => {}, isEnabled: async () => true,
    requestTechnology: async () => {
      assert.equal(pendingNativeRequest, undefined, 'Previous native request must close before the next read (ERR_MULTI_REQ)');
      ++nativeRequests;
      if (holdRequest) { pendingNativeRequest = deferred(); return pendingNativeRequest.promise; }
    },
    cancelTechnologyRequest: async () => {
      ++nativeCancels;
      const pending = pendingNativeRequest;
      pendingNativeRequest = undefined;
      pending?.reject(new Error('cancelled'));
      await cleanupGate?.promise;
    },
    getTag: async () => nativeTag,
    ndefHandler: {
      getNdefStatus: async () => ({ status: 2, capacity: nativeCapacity }),
      writeNdefMessage: async (bytes, config) => {
        assert.deepEqual(config, { reconnectAfterWrite: true });
        nativeWritten = bytes; nativeWriteMessages.push([...bytes]);
        await nativeWriteGate?.promise;
      },
      getNdefMessage: async () => {
        await nativeVerifyGate?.promise;
        const records = Ndef.decodeMessage(nativeWritten);
        return { ndefMessage: (nativeMismatch ? records.slice(1) : records).map((record) => ({
          ...record, type: Ndef.util.stringToBytes(record.type), id: Ndef.util.bytesToHexString(record.id),
        })) };
      },
    },
  };
  const actualService = load('src/nfc/nfcService.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'react-native-nfc-manager': { __esModule: true, default: nativeManager, Ndef,
      NdefStatus: { NotSupported: 1, ReadWrite: 2, ReadOnly: 3 }, NfcTech: { Ndef: 'Ndef' } },
    '../utils/urlNormalizer': normalizer,
    './aar': aar,
  }).NfcService;
  readResult = (signal) => actualService.readUrl(signal);
  writeResult = (urls, opts) => actualService.writeUrls(urls, opts);
  // A5: actual native service -> both entry routes -> provider/input -> failed whole rewrite/continuation.
  const a5Url = 'https://source.example/Keep?flag#Case';
  const a5Memo = Ndef.textRecord('memo', 'en', [0, 255]);
  const a5Mime = Ndef.mimeMediaRecord('application/octet-stream', [0, 255, 128]);
  const a5OtherUri = Ndef.uriRecord('mailto:Mixed@Example.com');
  const a5OldAars = [Ndef.androidApplicationRecord('org.old.one'), Ndef.androidApplicationRecord('org.old.two')];
  for (const pathName of ['direct', 'view']) {
    for (const [kind, originalRecords, originalUrls, preserved] of [
      ['mixed', [a5Memo, Ndef.uriRecord(a5Url), a5Mime, Ndef.textRecord(a5Url), a5OtherUri,
        Ndef.uriRecord(a5Url), ...a5OldAars], [a5Url, a5Url], [a5Memo, a5Mime, Ndef.textRecord(a5Url), a5OtherUri, ...a5OldAars]],
      ['non-URL', [a5Memo, a5Mime, a5OtherUri, ...a5OldAars], [], [a5Memo, a5Mime, a5OtherUri, ...a5OldAars]],
      ['fallback', [a5Memo, Ndef.textRecord(a5Url), a5Mime, Ndef.textRecord(a5Url), a5OtherUri, ...a5OldAars],
        [a5Url, a5Url], [a5Memo, a5Mime, a5OtherUri, ...a5OldAars]],
    ]) {
      nativeCapacity = 512;
      nativeTag = { ndefMessage: structuredClone(originalRecords.map((r) => ({ ...r,
        type: Ndef.util.stringToBytes(r.type), id: Ndef.util.bytesToHexString(r.id) }))) };
      h = new Harness();
      if (pathName === 'direct') h.enterEdit();
      else h.find('AppActionCard', (p) => p.title === '링크 보기').onPress();
      h.flush(); await h.settle();
      if (pathName === 'view') {
        if (!originalUrls.length) assert.ok(h.find('AppInfoCard', (p) => p.message?.includes('URL을 찾지 못')),
          'Link view retains no_url guidance for non-URL-only tags');
        const before = reads; h.press('수정하기'); await h.settle(); assert.equal(reads, before);
      }
      const retainedKey = h.route.key, entryReads = reads;
      assert.deepEqual(contextUrls(h), originalUrls, `${pathName}/${kind}: URL order/duplicates`);
      assert.equal(h.context.aarEnabled, true);
      assert.equal(h.find('Switch').value, true);
      const preservedBytes = Ndef.encodeMessage(preserved);
      assert.deepEqual(aar.encodeNativeRecords(h.context.preservedRecords), preservedBytes);
      assert.equal(h.find('AppCapacityGauge').used, aar.encodeLinkMessage(originalUrls, undefined, preserved).length);
      assert.equal(h.find('AppCapacityGauge').linkCount, originalUrls.length);
      // Native and route arrays remain external to provider-owned bytes.
      nativeTag.ndefMessage[0].payload[0] ^= 1;
      if (h.route.params) h.route.params.preservedRecords[0].payload[0] ^= 1;
      assert.deepEqual(aar.encodeNativeRecords(h.context.preservedRecords), preservedBytes);
      if (!originalUrls.length) assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, true);
      addPreset(h, '직접 입력', 'https://added.example/Keep'); h.press('다음');
      assert.equal(h.route.key, retainedKey); assert.equal(reads, entryReads);
      assert.deepEqual(aar.encodeNativeRecords(h.context.preservedRecords), preservedBytes);
      h.find('Pressable', (p) => nodes(p.children).some((n) => n.type === 'Text' &&
        n.props.children.includes('https://added.example/Keep'))).onPress(); h.flush();
      h.find('AppTextField').onChangeText('https://updated.example/Keep'); h.flush(); h.press('다음');
      if (originalUrls.length) { h.context.removeLink(0); h.flush(); }
      const editedUrls = [...contextUrls(h)];
      const expectedWrite = aar.encodeLinkMessage(editedUrls, undefined, preserved);
      assert.equal(h.find('AppCapacityGauge').used, expectedWrite.length);
      assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, false);
      nativeWriteGate = deferred(); nativeMismatch = true;
      const pending = h.press('저장'); await h.settle();
      h.context.preservedRecords[0].payload[0] ^= 1;
      nativeWriteGate.resolve(); nativeWriteGate = undefined;
      await pending; await h.settle();
      assert.deepEqual(nativeWriteMessages.at(-1), expectedWrite, 'Pending native write owns a complete deep snapshot');
      assert.ok(h.find(imports['@/screens/WriteFailureScreen'].WriteFailureScreen));
      nativeMismatch = false;
      await h.press('전체 재쓰기'); await h.settle();
      assert.equal(h.route.name, 'WriteComplete');
      assert.deepEqual(nativeWriteMessages.at(-1), expectedWrite, 'Whole rewrite retains failed non-URL bytes despite external changes');
      assert.equal(h.route.params.usedBytes, expectedWrite.length);
      assert.equal(h.route.params.urls.length, editedUrls.length, 'Non-URLs never inflate completed link count');
      // Restore intentionally mutated public state, then exercise ordinary continuation.
      h.context.preservedRecords[0].payload[0] ^= 1;
      h.press('링크 더 추가하기');
      h.find('AppActionCard', (p) => p.title === '직접 입력').onPress(); h.flush();
      h.find('AppTextField').onChangeText('https://continued.example/Keep'); h.flush(); h.press('다음');
      assert.equal(h.route.key, retainedKey); assert.equal(reads, entryReads);
      assert.deepEqual(aar.encodeNativeRecords(h.context.preservedRecords), preservedBytes);
      await h.press('저장'); await h.settle();
      assert.deepEqual(nativeWriteMessages.at(-1), aar.encodeLinkMessage([...editedUrls, 'https://continued.example/Keep'], undefined, preserved));
      h.press('완료'); nativeTag = { ndefMessage: [] }; h.enterEdit(); await h.settle();
      assert.deepEqual(h.context.preservedRecords, []); assert.deepEqual(contextUrls(h), []);
      h.context.replaceFromTag(['https://a.co'], 512, structuredClone(preserved)); h.flush();
      h.context.clear(); h.flush(); assert.deepEqual(h.context.preservedRecords, []);
      h.dispose();
    }
  }
  // Entire-message overflow reaches the actual save handler before opening any native write session.
  nativeTag = { ndefMessage: [Ndef.uriRecord('https://a.co'), a5Memo, a5Mime] };
  nativeCapacity = aar.encodeLinkMessage(['https://a.co'], undefined, [a5Memo, a5Mime]).length - 1;
  h = new Harness(); h.enterEdit(); await h.settle();
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, true);
  const a5Requests = nativeRequests, a5WriteCount = nativeWriteMessages.length;
  await h.find('AppPrimaryButton', (p) => p.label === '저장').onPress(); await h.settle();
  assert.equal(nativeRequests, a5Requests); assert.equal(nativeWriteMessages.length, a5WriteCount); h.dispose();
  // Bad source records and bad route params block editing instead of defaulting to an empty preserve list.
  nativeCapacity = 512;
  nativeTag = { ndefMessage: [Ndef.uriRecord('https://a.co'), { ...a5Memo, id: 'bad-hex' }] };
  h = new Harness(); h.enterEdit(); await h.settle();
  assert.ok(h.find('AppSecondaryButton', (p) => p.label === '태그 상태 확인'));
  assert.equal(nodes(h.editor.tree).some((n) => n.props?.label === '저장'), false); h.dispose();
  h = new Harness(); h.dispatch({ type: 'NAVIGATE', payload: { name: 'LinkEdit', params:
    { urls: ['https://a.co'], capacity: 512, writable: true, preservedRecords: [{ ...a5Memo, payload: [NaN] }] } } });
  await h.settle(); assert.equal(nodes(h.editor.tree).some((n) => n.props?.label === '저장'), false);
  assert.deepEqual(h.context.preservedRecords, []); h.dispose();
  console.log('PASS: A5 actual native service/provider/screens: both routes x mixed/non-URL/fallback, deep source/route copies, input retention, URL edit/delete, original record gauge/capacity/link count, failed full rewrite snapshot, completed bytes/continuation, new tag/clear reset, unsafe data/save blocking');

  // Android 6-1..7: actual screen handlers/provider/service, only native NFC and view mounting mocked.
  const screenText = (host) => nodes(host.editor.tree).filter((n) => n.type === 'Text').flatMap((n) => n.props.children).join(' ');
  const openNotice = (host) => { host.find('Switch').onValueChange(true); host.flush(); return host.find('Modal'); };
  const acceptNotice = (host) => { openNotice(host); host.press('켜기'); assert.equal(host.context.aarEnabled, true); };
  const aarSeed = ['https://www.instagram.com/hong/', 'https://github.com/hong', 'https://x.com/hong'];
  nativeCapacity = 512; nativeTag = { ndefMessage: aarSeed.map((u) => Ndef.uriRecord(u)) };
  h = new Harness(); h.enterEdit(); await h.settle();
  const seedPrimary = h.context.links[0];
  assert.equal(h.context.aarEnabled, false, 'New session starts off');
  assert.equal(h.find('Switch').value, false);
  let notice = openNotice(h);
  assert.equal(h.find('Switch').value, false, 'Opening notice never enables immediately');
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, true);
  const noticeText = screenText(h);
  assert.ok(noticeText.indexOf('프로필 대신 앱 설치 화면') < noticeText.indexOf('브라우저를'));
  assert.ok(noticeText.includes('링크는 열리지 않습니다.'));
  assert.ok(noticeText.includes('39'));
  const decline = h.find('Pressable', (p) => p.accessibilityLabel === '켜지 않음');
  let focused = false;
  decline.ref.current = { node: 17, focus: () => { focused = true; } };
  notice.onShow(); assert.equal(focused, true); assert.equal(accessibilityFocus.at(-1), 17);
  let lateAccept = h.find('AppSecondaryButton', (p) => p.label === '켜기').onPress;
  decline.onPress(); h.flush(); lateAccept(); h.flush(); assert.equal(h.context.aarEnabled, false);
  notice = openNotice(h); lateAccept = h.find('AppSecondaryButton', (p) => p.label === '켜기').onPress;
  notice.onRequestClose(); h.flush(); lateAccept(); h.flush(); assert.equal(h.context.aarEnabled, false, 'Android modal back cancels consent');
  openNotice(h); lateAccept = h.find('AppSecondaryButton', (p) => p.label === '켜기').onPress;
  h.context.setPrimary(1); h.context.setPrimary(1); // A -> B -> A before rendering.
  lateAccept(); h.flush(); assert.equal(h.context.aarEnabled, false, 'Returning to the original row cannot revive stale consent');
  assert.equal(h.context.links[0], seedPrimary);
  acceptNotice(h);
  const expectedTotal = Ndef.encodeMessage([...aarSeed.map((u) => Ndef.uriRecord(u)), Ndef.androidApplicationRecord('com.instagram.android')]).length;
  assert.equal(h.find('AppCapacityGauge').used, expectedTotal);
  assert.equal(h.find('AppCapacityGauge').total, 512);
  assert.ok(screenText(h).includes('39'));
  h.find('Switch').onValueChange(false); h.flush(); assert.equal(h.context.aarEnabled, false);
  assert.equal(h.find('AppCapacityGauge').used, expectedTotal - 39);
  openNotice(h); assert.equal(h.find('Switch').value, false, 'Manual off -> on requires a fresh notice'); h.press('켜기');
  h.context.reorder(1, 2); h.flush(); assert.equal(h.context.aarEnabled, true, 'Non-primary reorder retains approval');
  h.context.updateLink(1, { ...h.context.links[1], normalizedUrl: 'https://x.com/updated' }); h.flush();
  assert.equal(h.context.aarEnabled, true, 'Non-primary edit retains approval');
  h.press('링크 추가'); h.back(); assert.equal(h.context.aarEnabled, true, 'Input back keeps the same session');
  h.context.updateLink(0, { ...h.context.links[0] }); h.flush(); assert.equal(h.context.aarEnabled, false, 'Primary edit resets even for the same URL');
  acceptNotice(h); h.context.removeLink(0); h.flush(); assert.equal(h.context.aarEnabled, false, 'Primary deletion/succession resets');
  acceptNotice(h); h.back(); assert.equal(h.route.name, 'Home'); assert.equal(h.context.aarEnabled, false, 'Home focus ends session immediately');
  h.enterEdit(); await h.settle(); openNotice(h); lateAccept = h.find('AppSecondaryButton', (p) => p.label === '켜기').onPress;
  h.back(); h.enterEdit(); await h.settle(); lateAccept(); h.flush();
  assert.equal(h.context.aarEnabled, false, 'Old consent cannot enable a new Home session'); h.dispose();
  // Every service has one independent panel switch, starts off, and uses its actual encoded cost.
  for (const type of model.LINK_TYPES.filter((t) => t.androidPackage)) {
    nativeTag = { ndefMessage: [Ndef.uriRecord(type.urlPattern.replace('{handle}', 'hong'))] };
    h = new Harness(); h.enterEdit(); await h.settle();
    assert.equal(nodes(h.editor.tree).filter((node) => node.type === 'Switch').length, 1);
    assert.equal(h.context.aarEnabled, false); acceptNotice(h);
    const expected = Ndef.encodeMessage([Ndef.uriRecord(contextUrls(h)[0]), Ndef.androidApplicationRecord(type.androidPackage)]);
    assert.equal(h.find('AppCapacityGauge').used, expected.length);
    await h.press('저장'); await h.settle();
    assert.equal(h.route.name, 'WriteComplete'); assert.deepEqual(nativeWriteMessages.at(-1), expected);
    assert.equal(h.route.params.androidPackage, type.androidPackage);
    assert.ok(screenText(h).includes(type.label));
    h.press('링크 더 추가하기'); h.back();
    assert.equal(h.context.aarEnabled, true, 'Continuation returns without resetting or another notice');
    assert.equal(h.find('Switch').value, true); await h.press('저장'); await h.settle();
    assert.deepEqual(nativeWriteMessages.at(-1), expected, 'Repeat writes exactly one AAR');
    h.press('완료'); assert.equal(h.context.aarEnabled, false); h.dispose();
  }
  nativeTag = { ndefMessage: [Ndef.uriRecord('https://example.com/custom')] };
  h = new Harness(); h.enterEdit(); await h.settle();
  assert.equal(nodes(h.editor.tree).some((node) => node.type === 'Switch'), false, 'Custom representative has no toggle'); h.dispose();
  nativeTag = { ndefMessage: [Ndef.uriRecord(aarSeed[0])] };
  nativeCapacity = Ndef.encodeMessage(nativeTag.ndefMessage).length;
  h = new Harness(); h.enterEdit(); await h.settle(); acceptNotice(h);
  assert.equal(h.find('AppCapacityGauge').total, nativeCapacity, 'AAR cost never shrinks measured denominator');
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, true);
  assert.ok(h.find('AppInfoCard', (p) => p.title === '용량 초과').message.includes('끄면 39 B'));
  const beforeOverflow = nativeWriteMessages.length;
  await h.find('AppPrimaryButton', (p) => p.label === '저장').onPress(); await h.settle();
  assert.equal(nativeWriteMessages.length, beforeOverflow, 'Overflow handler blocks even direct invocation');
  h.find('Switch').onValueChange(false); h.flush(); assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, false);
  await h.press('저장'); await h.settle(); assert.equal(h.route.params.androidPackage, undefined); h.dispose();
  // Failure recovery retains the saved URL+option snapshot even if context is changed externally.
  nativeCapacity = 512; nativeTag = { ndefMessage: aarSeed.map((u) => Ndef.uriRecord(u)) };
  h = new Harness(); h.enterEdit(); await h.settle(); acceptNotice(h); nativeMismatch = true;
  await h.press('저장'); await h.settle();
  const failedBytes = [...nativeWriteMessages.at(-1)];
  assert.ok(h.find(imports['@/screens/WriteFailureScreen'].WriteFailureScreen));
  h.context.disableAar(); h.context.setPrimary(1); h.flush();
  nativeMismatch = false; await h.press('전체 재쓰기'); await h.settle();
  assert.deepEqual(nativeWriteMessages.at(-1), failedBytes);
  assert.equal(h.route.params.androidPackage, 'com.instagram.android'); h.dispose();
  // Existing AAR survives both entry routes, representative edits, failure/retry, and continuation.
  for (const pathName of ['direct', 'view']) {
    const existingAar = { ...Ndef.androidApplicationRecord('com.instagram.android'), id: [0, 255] };
    nativeTag = { ndefMessage: [...aarSeed.map((u) => Ndef.uriRecord(u)), a5Memo, existingAar] };
    h = new Harness();
    if (pathName === 'direct') h.enterEdit();
    else { h.find('AppActionCard', (p) => p.title === '링크 보기').onPress(); h.flush(); await h.settle(); h.press('수정하기'); }
    await h.settle();
    assert.equal(h.context.aarEnabled, true); assert.equal(h.find('Switch').value, true);
    assert.equal(h.context.androidPackage, undefined, 'Existing AAR retains its raw ID/payload rather than being recreated');
    assert.ok(screenText(h).includes('기존 앱 설정 유지: Instagram'));
    h.context.updateLink(0, { ...h.context.links[0], normalizedUrl: 'https://www.instagram.com/edited/' }); h.flush();
    h.context.setPrimary(1); h.flush();
    assert.equal(h.context.aarEnabled, true, 'Existing AAR is not silently removed by representative changes');
    const expected = Ndef.encodeMessage([...contextUrls(h).map((u) => Ndef.uriRecord(u)), a5Memo, existingAar]);
    assert.equal(h.find('AppCapacityGauge').used, expected.length);
    nativeMismatch = true; await h.press('저장'); await h.settle();
    nativeMismatch = false; await h.press('전체 재쓰기'); await h.settle();
    assert.deepEqual(nativeWriteMessages.at(-1), expected);
    assert.equal(h.route.params.androidPackage, 'com.instagram.android');
    h.press('링크 더 추가하기'); h.find('AppActionCard', (p) => p.title === '직접 입력').onPress(); h.flush();
    h.find('AppTextField').onChangeText('https://continued.example/'); h.flush(); h.press('다음');
    await h.press('저장'); await h.settle();
    assert.deepEqual(nativeWriteMessages.at(-1), Ndef.encodeMessage([...contextUrls(h).map((u) => Ndef.uriRecord(u)), a5Memo, existingAar]));
    h.press('링크 더 추가하기'); h.find('AppActionCard', (p) => p.title === '직접 입력').onPress(); h.flush();
    h.find('AppTextField').onChangeText('https://another.example/'); h.flush(); h.press('다음');
    h.find('Switch').onValueChange(false); h.flush();
    assert.equal(h.context.aarEnabled, false);
    assert.deepEqual(aar.encodeNativeRecords(h.context.preservedRecords), Ndef.encodeMessage([a5Memo]));
    await h.press('저장'); await h.settle();
    assert.equal(Ndef.decodeMessage(nativeWriteMessages.at(-1)).some(aar.isAarRecord), false);
    h.dispose();
  }
  // Replacement uses the existing consent sheet and changes only the AAR.
  nativeTag = { ndefMessage: [Ndef.uriRecord(aarSeed[1]), a5Memo, Ndef.androidApplicationRecord('com.instagram.android')] };
  h = new Harness(); h.enterEdit(); await h.settle();
  h.press('대표 앱으로 변경'); assert.ok(h.find('Modal')); h.find('Modal').onRequestClose(); h.flush();
  assert.equal(h.context.aarEnabled, true); assert.equal(h.context.preservedRecords.some(aar.isAarRecord), true);
  h.press('대표 앱으로 변경'); h.press('켜기');
  assert.equal(h.context.preservedRecords.some(aar.isAarRecord), false);
  await h.press('저장'); await h.settle();
  assert.deepEqual(nativeWriteMessages.at(-1), Ndef.encodeMessage([Ndef.uriRecord(aarSeed[1]), a5Memo, Ndef.androidApplicationRecord('com.github.android')]));
  h.dispose();
  imports['react-native'].Platform.OS = 'ios';
  h = new Harness(); h.enterEdit(); await h.settle();
  assert.equal(nodes(h.editor.tree).some((node) => node.type === 'Switch' || node.type === 'Modal' && node.props.visible), false);
  assert.equal(screenText(h).includes('안드로이드에서 앱 바로 열기'), false, 'No iOS AAR option in this scope');
  h.dispose(); imports['react-native'].Platform.OS = 'android';
  console.log('PASS: AAR actual UI notice loss-first/cancel-focus/back/stale consent; A->B->A/edit/delete/Home reset; non-primary/input/continuation retention; six defaults/package bytes/native writes; overflow toggle; failed snapshot rewrite; custom/iOS absent; existing tag AAR stays on until explicit removal/replacement');
  for (const capacity of [137, 140, 144]) {
    nativeCapacity = capacity;
    nativeTag = { ndefMessage: [Ndef.uriRecord(boundaryUrl)] };
    h = new Harness(); h.enterEdit(); await h.settle();
    assert.equal(h.find('AppCapacityGauge').total, capacity);
    const beforeWrite = nativeWriteMessages.length, beforeSession = nativeRequests;
    await h.find('AppPrimaryButton', (p) => p.label === '저장').onPress(); await h.settle();
    assert.equal(nativeWriteMessages.length - beforeWrite, capacity < 140 ? 0 : 1);
    assert.equal(nativeRequests - beforeSession, capacity < 140 ? 0 : 1);
    if (capacity >= 140) assert.equal(h.route.params.usedBytes, 140);
    h.dispose();
  }
  nativeCapacity = 137;
  // Native byte verification accepts duplicate/character/format warnings; screen handlers never block them.
  for (const [label, input, kind] of [['X', 'bad$name', '허용 문자'], ['직접 입력', 'https://bad name', '형식 이상'], ['X', 'duplicate', '중복']]) {
    nativeTag = { ndefMessage: [] };
    h = new Harness(); h.enterEdit(); await h.settle();
    addPreset(h, label, input); h.press('다음');
    if (kind === '중복') { addPreset(h, label, input); h.press('다음'); }
    assert.ok(cardOf(h, kind).length > 0, `${kind}: warning is visible`);
    assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, false);
    const warnedUrls = contextUrls(h), before = nativeWriteMessages.length;
    await h.press('저장'); await h.settle();
    assert.equal(h.route.name, 'WriteComplete', `${kind}: actual service byte verification succeeds`);
    assert.equal(nativeWriteMessages.length, before + 1);
    assert.equal(h.route.params.usedBytes, encodedBytes(warnedUrls));
    assert.deepEqual(Ndef.decodeMessage(nativeWriteMessages.at(-1)).map((r) => Ndef.uri.decodePayload(r.payload)), warnedUrls);
    h.dispose();
  }
  writeResult = undefined;
  console.log('PASS: actual editor + NFC service: 140 B boundary at 137/140/144; duplicate/character/format warnings reach native write and verified completion');
  const emptyRecord = { tnf: Ndef.TNF_EMPTY, type: [], id: [], payload: [] };
  for (const records of [[], [emptyRecord], [emptyRecord, emptyRecord]]) {
    nativeTag = { ndefMessage: records };
    h = new Harness(); h.context.replaceFromTag(urls, 512); h.flush(); h.enterEdit(); await h.settle();
    assert.deepEqual(contextUrls(h), [], 'Confirmed empty tag replaces previous links');
    assert.deepEqual(aar.encodeNativeRecords(h.context.preservedRecords), aar.encodeNativeRecords(records), 'EMPTY records retain their actual fields without previous-tag data');
    assert.equal(h.context.capacity, 137);
    assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, true);
    const closed = nativeCancels;
    h.press('링크 추가'); h.dispose();
    assert.equal(nativeCancels, closed, 'Leaving after the read finished must not cancel again');
  }
  nativeTag = null;
  h = new Harness(); h.context.replaceFromTag(urls, 512); h.flush(); h.enterEdit(); await h.settle();
  assert.deepEqual(contextUrls(h), []); assert.equal(h.context.capacity, undefined);
  assert.ok(!nodes(h.editor.tree).some((n) => n.props?.label === '저장' || n.props?.label === '링크 추가'),
    'Failed null tag lookup must not open editing or saving');
  h.dispose();

  nativeTag = { ndefMessage: [Ndef.uriRecord('https://retry.example')] };
  for (const departure of ['back', 'blur', 'unmount']) {
    holdRequest = true; h = new Harness(); h.enterEdit(); await h.settle();
    assert.ok(pendingNativeRequest, 'First read is waiting in the native request');
    const requested = nativeRequests, cancelled = nativeCancels;
    cleanupGate = deferred();
    if (departure === 'back') h.back();
    else if (departure === 'blur') { h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagInfo' } }); h.back(); }
    else h.dispose();
    assert.equal(nativeCancels, cancelled + 1, `${departure} must cancel the pending native read once`);
    holdRequest = false;
    if (departure === 'back') h.enterEdit();
    else if (departure === 'blur') h.press('다시 읽기');
    else { h = new Harness(); h.enterEdit(); }
    await h.settle();
    assert.equal(nativeRequests, requested, 'New read waits for previous native cleanup');
    cleanupGate.resolve(); cleanupGate = undefined; await h.settle();
    assert.equal(nativeRequests, requested + 1);
    assert.deepEqual(contextUrls(h), ['https://retry.example']); assert.equal(h.context.capacity, 137);

    // A completed editor's blur/unmount must leave another owner's live read alone.
    holdRequest = true;
    const otherRead = actualService.readUrl(); await h.settle();
    const otherPending = pendingNativeRequest, beforeLeaving = nativeCancels;
    h.back(); h.dispose();
    assert.equal(nativeCancels, beforeLeaving);
    assert.equal(pendingNativeRequest, otherPending);
    otherPending.resolve(); assert.equal((await otherRead).ok, true);
  }
  // Actual editor + actual service: only native transport is stubbed.
  holdRequest = false;
  nativeTag = { ndefMessage: [Ndef.uriRecord('https://a.co'), Ndef.uriRecord('https://a.co')] };
  writeResult = (urls, opts) => actualService.writeUrls(urls, opts);
  h = new Harness(); h.enterEdit(); await h.settle();
  const integratedKey = h.route.key, integratedIds = h.context.links.map((l) => l.rowId);
  const requestedBeforeSave = nativeRequests;
  nativeWriteGate = deferred(); nativeVerifyGate = deferred(); nativeMismatch = true;
  const integratedSave = h.find('AppPrimaryButton', (p) => p.label === '저장').onPress;
  const integratedPending = integratedSave(); integratedSave(); h.flush(); await h.settle();
  assert.equal(nativeRequests, requestedBeforeSave + 1, 'Actual service opens one write session for duplicate taps');
  assert.equal(h.find(imports['@/screens/WriteWaitingScreen'].WriteWaitingScreen).stage, 'writing');
  nativeWriteGate.resolve(); nativeWriteGate = undefined; await h.settle();
  assert.equal(h.find(imports['@/screens/WriteWaitingScreen'].WriteWaitingScreen).stage, 'verifying');
  assert.equal(h.route.name, 'LinkEdit');
  nativeVerifyGate.resolve(); nativeVerifyGate = undefined; await integratedPending; await h.settle();
  assert.ok(h.find(imports['@/screens/WriteFailureScreen'].WriteFailureScreen).message.includes('일부만'));
  assert.equal(h.context.capacity, 137); assert.deepEqual(h.context.links.map((l) => l.rowId), integratedIds);
  const mismatchWriteCount = nativeWriteMessages.length;
  await h.settle(); assert.equal(nativeWriteMessages.length, mismatchWriteCount, 'Mismatch never auto-retries');
  nativeMismatch = false;
  await h.press('전체 재쓰기'); await h.settle();
  assert.equal(h.route.name, 'WriteComplete');
  assert.deepEqual(nativeWriteMessages.at(-1), nativeWriteMessages.at(-2), 'Native recovery rewrites all original records');
  assert.equal(h.route.params.usedBytes, nativeWriteMessages.at(-1).length);
  const readCountBeforeContinue = reads;
  h.press('링크 더 추가하기');
  h.find('AppActionCard', (p) => p.title === 'GitHub').onPress(); h.flush();
  h.find('AppTextField').onChangeText('more'); h.flush(); h.press('다음');
  assert.equal(h.route.key, integratedKey); assert.equal(reads, readCountBeforeContinue);
  assert.equal(h.context.capacity, 137); assert.equal(h.context.links[0].rowId, integratedIds[0]);
  const requestsBeforeContinue = nativeRequests;
  await h.press('저장'); await h.settle();
  assert.equal(nativeRequests, requestsBeforeContinue + 1, 'Continuation requires a fresh native tag session');
  assert.deepEqual(Ndef.decodeMessage(nativeWriteMessages.at(-1)).map((r) => Ndef.uri.decodePayload(r.payload)),
    ['https://a.co', 'https://a.co', 'https://github.com/more']);
  h.press('완료'); nativeTag = { ndefMessage: [] }; h.enterEdit(); await h.settle();
  assert.deepEqual(contextUrls(h), [], 'Home then blank tag replaces prior continuation list');
  assert.equal(h.context.capacity, 137); h.dispose(); writeResult = undefined;
  // Cancelled native write may finish after a newer save; it must not close/move that save.
  nativeTag = { ndefMessage: [Ndef.uriRecord('https://new.co')] };
  writeResult = (urls, opts) => actualService.writeUrls(urls, opts);
  h = new Harness(); h.enterEdit(); await h.settle();
  const oldWriteGate = nativeWriteGate = deferred();
  const staleSave = h.press('저장'); await h.settle();
  cleanupGate = deferred(); h.press('취소'); h.flush();
  const beforeNewRequest = nativeRequests;
  nativeWriteGate = undefined; nativeVerifyGate = deferred();
  const newSave = h.press('저장'); await h.settle();
  assert.equal(nativeRequests, beforeNewRequest, 'New write waits for aborted native cleanup');
  cleanupGate.resolve(); cleanupGate = undefined; await h.settle();
  assert.equal(nativeRequests, beforeNewRequest + 1);
  const cancelsBeforeOldReturn = nativeCancels;
  oldWriteGate.resolve(); await staleSave; await h.settle();
  assert.equal(nativeCancels, cancelsBeforeOldReturn, 'Old finally cannot close newer native session');
  assert.equal(h.route.name, 'LinkEdit');
  assert.equal(h.find(imports['@/screens/WriteWaitingScreen'].WriteWaitingScreen).stage, 'verifying', 'Old result cannot end new verification');
  nativeVerifyGate.resolve(); nativeVerifyGate = undefined; await newSave; await h.settle();
  assert.equal(h.route.name, 'WriteComplete'); h.dispose(); writeResult = undefined;
  console.log('PASS: native touch drag + unequal rows/autoscroll/cancel/height changes; duplicate IDs/primary invariants; real save handlers/stages/duplicate taps/cancel/late results; native mismatch -> full rewrite -> verified completion bytes; continuation read=0/identity/capacity preserved; Home new tag reset');
  console.log('PASS: actual Home/TagRead/editor/provider/input handlers and installed StackRouter; reads 1/0/0; retained edits/capacity; full replacement/blank tags; URL order/duplicates/strings; failures/cancel; unmount/blur/newer-read races');
  console.log('PASS: actual service/editor []/TNF_EMPTY replacement, null tag blocks editing/saving, pending native read cancellation on back/blur/unmount, cleanup before retry, completed editor preserves another session, measured gauge capacity retained');
})().catch((error) => { console.error(error); process.exitCode = 1; });
