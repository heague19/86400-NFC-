// Run: node scripts/check-link-presets.cjs (no device/new dependencies).
// HANDOFF §5.1·§5.2 — 프리셋 입력 파이프라인과 기타 분리를 실제 모듈로 확인한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}

const model = load('src/models/linkType.ts');
const n = load('src/utils/urlNormalizer.ts');
const run = (id, input) => n.normalizePresetInput(model.findLinkTypeById(id), input);
const urlOf = (id, input) => run(id, input).url;
const kinds = (id, input) => run(id, input).warnings.map((w) => w.kind);

// §5.2 — 프리셋 6종의 저장 URL 패턴. 6종 전부 계정명 입력, 기타만 URL 전체 입력.
const patterns = {
  x: 'https://x.com/hong', github: 'https://github.com/hong', tiktok: 'https://www.tiktok.com/@hong',
  youtube: 'https://youtube.com/@hong', instagram: 'https://www.instagram.com/hong/', linkedin: 'https://linkedin.com/in/hong',
};
assert.deepEqual(model.LINK_TYPES.filter((t) => t.inputMode === 'username').map((t) => t.id).sort(), Object.keys(patterns).sort());
assert.deepEqual(model.LINK_TYPES.filter((t) => t.inputMode === 'fullUrl').map((t) => t.id), ['custom']);
for (const [id, expected] of Object.entries(patterns)) {
  assert.equal(urlOf(id, 'hong'), expected, id);
  assert.deepEqual(run(id, 'hong').warnings, [], `${id} plain handle has no warning`);
}

// 정규화 순서 — 공백 → (붙여넣기) → 선행 @ → 끝 / → 허용 문자 → 대소문자 유지 → 조립
assert.equal(urlOf('x', '  @@Hong.Gil//  '), 'https://x.com/Hong.Gil');
assert.equal(urlOf('instagram', ' @Mixed_Name/ '), 'https://www.instagram.com/Mixed_Name/');
assert.equal(urlOf('tiktok', '@MiXeD'), 'https://www.tiktok.com/@MiXeD', 'Case is preserved; @ is re-attached by the pattern');
assert.deepEqual(kinds('github', 'hong-gil_1.x'), [], '. _ - are allowed');
for (const empty of ['', '   ', '@', '@@/', '/', ' @ / ']) assert.equal(urlOf('x', empty), null, JSON.stringify(empty));

// 허용 문자 위반은 경고(URL은 그대로 만들어진다). 공백이 들어가 URL이 못 되는 입력만 만들지 않는다.
for (const bad of ['hong$', '홍길동', 'ho%ng', 'a?b', 'a#b']) {
  assert.deepEqual(kinds('x', bad), ['chars'], bad);
  assert.equal(urlOf('x', bad), `https://x.com/${bad}`, bad);
}
// 공백이 든 입력도 경고와 함께 추가된다 (§5.6 — 형식 이상은 막지 않음). 공백은 %20으로 바꿔 URL이 유효하게 남는다.
assert.deepEqual(kinds('x', 'bad name'), ['chars']);
assert.equal(urlOf('x', 'bad name'), 'https://x.com/bad%20name');
assert.equal(n.isValidHttpUrl(urlOf('x', 'bad name')), true, 'The app\'s own read path still accepts what it wrote');
assert.equal(urlOf('x', '@ hong'), 'https://x.com/%20hong'); assert.deepEqual(kinds('x', '@ hong'), ['chars']);
assert.equal(urlOf('instagram', 'a\tb'), 'https://www.instagram.com/a%09b/');
// 파싱할 수 없는 URL 모양은 입력 문자열로 보고 경고한다
assert.deepEqual(run('x', 'https://'), { url: 'https://x.com/https:', warnings: run('x', 'https://').warnings, customSuggestion: null });
assert.deepEqual(kinds('x', 'https://'), ['chars']);
assert.equal(urlOf('x', 'http://bad host/x'), 'https://x.com/http://bad%20host/x'); assert.deepEqual(kinds('x', 'http://bad host/x'), ['chars']);
assert.equal(urlOf('x', 'a$&b'), 'https://x.com/a$&b', 'Handle text is never read as a replacement pattern');
assert.equal(urlOf('x', 'a$1b'), 'https://x.com/a$1b');

// 길이 규칙은 YouTube만 (3~30자). 경우에 따라 다른 프리셋에 번지면 안 된다.
const rep = (len) => 'a'.repeat(len);
for (const [len, ok] of [[1, false], [2, false], [3, true], [30, true], [31, false]]) {
  assert.deepEqual(kinds('youtube', rep(len)), ok ? [] : ['format'], `youtube ${len}`);
  assert.equal(urlOf('youtube', rep(len)), `https://youtube.com/@${rep(len)}`, 'Length is a warning, the URL is still built');
}
for (const id of ['x', 'github', 'tiktok', 'instagram', 'linkedin']) {
  for (const len of [1, 2, 31, 60]) assert.deepEqual(kinds(id, rep(len)), [], `${id} has no length rule (${len})`);
}

// P2 — 같은 서비스 전체 URL을 붙여넣으면 계정명만 꺼내 그 프리셋 패턴으로 조립
for (const [id, input, expected] of [
  ['x', 'https://x.com/hong', 'https://x.com/hong'],
  ['x', 'https://www.x.com/hong/', 'https://x.com/hong'],
  ['x', 'https://twitter.com/hong?s=21', 'https://x.com/hong'],
  ['x', 'mobile.twitter.com/hong', 'https://x.com/hong'],
  ['x', 'x.com/Hong', 'https://x.com/Hong'],
  ['github', 'https://github.com/octocat', 'https://github.com/octocat'],
  ['tiktok', 'https://www.tiktok.com/@hong?lang=ko', 'https://www.tiktok.com/@hong'],
  ['youtube', 'https://www.youtube.com/@hong', 'https://youtube.com/@hong'],
  ['youtube', 'https://m.youtube.com/@hong?si=x', 'https://youtube.com/@hong'],
  ['instagram', 'https://www.instagram.com/Mixed_Name/?igsh=abc', 'https://www.instagram.com/Mixed_Name/'],
  ['instagram', 'instagram.com/hong', 'https://www.instagram.com/hong/'],
  ['instagram', 'HTTP://INSTAGRAM.COM/Hong', 'https://www.instagram.com/Hong/'],
  ['linkedin', 'https://www.linkedin.com/in/hong-gil/', 'https://linkedin.com/in/hong-gil'],
  ['linkedin', 'linkedin.com/in/hong', 'https://linkedin.com/in/hong'],
]) {
  const r = run(id, input);
  assert.equal(r.url, expected, `${id} ${input}`); assert.equal(r.customSuggestion, null, `${id} ${input}`);
}

// 다른 도메인이거나 계정 페이지가 아니면 이 프리셋으로 만들지 않고 기타로 추가를 제안한다.
for (const [id, input, suggestion] of [
  ['instagram', 'https://github.com/foo', 'https://github.com/foo'],
  ['x', 'example.com/foo', 'https://example.com/foo'],
  ['x', 'https://x.com/hong/status/1', 'https://x.com/hong/status/1'],
  ['github', 'https://github.com/org/repo', 'https://github.com/org/repo'],
  ['tiktok', 'https://www.tiktok.com/@hong/video/1', 'https://www.tiktok.com/@hong/video/1'],
  ['tiktok', 'https://www.tiktok.com/hong', 'https://www.tiktok.com/hong'],
  ['youtube', 'https://youtube.com/watch?v=abc', 'https://youtube.com/watch?v=abc'],
  ['youtube', 'https://youtube.com/c/foo', 'https://youtube.com/c/foo'],
  ['youtube', 'https://youtu.be/abc', 'https://youtu.be/abc'],
  ['instagram', 'https://instagram.com/p/xyz/', 'https://instagram.com/p/xyz/'],
  ['linkedin', 'https://linkedin.com/company/foo', 'https://linkedin.com/company/foo'],
  ['linkedin', 'https://lnkd.in/x', 'https://lnkd.in/x'],
]) {
  const r = run(id, input);
  assert.equal(r.url, null, `${id} ${input} is not assembled`); assert.equal(r.customSuggestion, suggestion, `${id} ${input}`);
}
// http(s)가 아닌 스킴은 만들지 않고 제안도 하지 않는다 (K9 — 기타로도 넘기지 않는다).
for (const input of ['ftp://example.com/x', 'ftp://a b', 'file:///etc/passwd', 'javascript://x', 'intent://scan/#Intent;end']) {
  const r = run('x', input); assert.equal(r.url, null, input); assert.equal(r.customSuggestion, null, input);
}

// 점이 들어간 계정명을 URL로 오인하지 않는다 (붙여넣기 감지는 끝 / 제거보다 먼저 돈다)
for (const [input, expected] of [
  ['john.doe', 'https://x.com/john.doe'], ['hong/', 'https://x.com/hong'], ['@hong/', 'https://x.com/hong'],
  ['hong.kim/', 'https://x.com/hong.kim'], ['@john.doe/', 'https://x.com/john.doe'],
]) {
  const r = run('x', input); assert.equal(r.url, expected, input); assert.equal(r.customSuggestion, null, input);
}
assert.equal(urlOf('instagram', 'john.doe'), 'https://www.instagram.com/john.doe/');

// 태그에서 읽은 URL — 계정 페이지일 때만 그 프리셋으로 분류 (extractPresetHandle)
const handleOf = (id, url) => n.extractPresetHandle(model.findLinkTypeById(id), url);
assert.equal(handleOf('instagram', 'https://www.instagram.com/Mixed_Name/'), 'Mixed_Name');
assert.equal(handleOf('instagram', 'https://instagram.com/hong'), 'hong');
assert.equal(handleOf('github', 'https://github.com/org/repo'), null);
assert.equal(handleOf('youtube', 'https://www.youtube.com/watch?v=abc'), null);
assert.equal(handleOf('github', 'https://github.io/x'), null);
assert.equal(handleOf('x', 'not a url'), null);

// 기타(normalizeFullUrl)는 프리셋 규칙과 분리돼 있다 — 허용 문자·길이·@·끝 / 규칙이 닿지 않는다 (K1·F5)
assert.equal(n.normalizeFullUrl('example.com/a/b:c?x=1#f'), 'https://example.com/a/b:c?x=1#f');
assert.equal(n.normalizeFullUrl('  Example.com/Path/  '), 'https://Example.com/Path/');
assert.equal(n.normalizeFullUrl('http://example.com:8080/@user/'), 'http://example.com:8080/@user/');
for (const bad of ['', '  ', 'ftp://example.com', 'javascript:alert(1)', 'a b', 'https://']) assert.equal(n.normalizeFullUrl(bad), null, bad);
// 추적 파라미터 제거는 현행 유지 (STATUS 판정 2 · HANDOFF §5.1 E3a)
assert.equal(n.removeTrackingParams('https://example.com/p?utm_source=a&keep=1&igsh=z'), 'https://example.com/p?keep=1');
assert.equal(n.removeTrackingParams('https://example.com/p?utm_medium=a'), 'https://example.com/p');
assert.equal(n.removeTrackingParams('https://example.com/p?tok=A~B&utm_source=x'), 'https://example.com/p?tok=A%7EB', 'Known E3a rewrite, kept as is');
// 기타 입력(normalizeCustomInput) — 형식 이상은 경고와 함께 추가, 빈 입력·http(s) 아닌 스킴만 막는다 (K9)
const ci = n.normalizeCustomInput;
for (const ok of ['example.com/a/b:c?x=1#f', '  Example.com/Path/  ', 'http://example.com:8080/@user/']) {
  assert.deepEqual(ci(ok), { url: n.normalizeFullUrl(ok), warnings: [] }, ok);
}
for (const [bad, url] of [['bad name', 'https://bad name'], ['https://exa mple.com', 'https://exa mple.com'], ['https://', 'https://'], ['a b/c d', 'https://a b/c d']]) {
  const r = ci(bad); assert.equal(r.url, url, bad); assert.deepEqual(r.warnings.map((x) => x.kind), ['format'], bad);
  assert.equal(n.normalizeFullUrl(bad), null, 'The strict normalizer is unchanged');
  assert.equal(n.removeTrackingParams(r.url), r.url, 'Tracking removal leaves a malformed URL alone');
}
for (const blocked of ['', '   ', 'ftp://example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'mailto:a@b.c', 'tel:123']) {
  assert.deepEqual(ci(blocked), { url: null, warnings: [] }, JSON.stringify(blocked));
}
assert.equal(n.isValidHttpUrl('https://x.com/a b'), false); assert.equal(n.isValidHttpUrl('javascript:alert(1)'), false);

// 3-7a — 경고 배지 규칙 (linkWarnings): 중복 · 허용 문자 위반 · 형식 이상
const w = load('src/utils/linkWarnings.ts', { '@/utils/urlNormalizer': n });
const T = (id) => model.findLinkTypeById(id);
const preset = (id, input) => ({ linkType: T(id), originalInput: input, normalizedUrl: urlOf(id, input), estimatedBytes: 0, isValid: true });
const custom = (url, extra = {}) => ({ linkType: model.CUSTOM_LINK_TYPE, originalInput: url, normalizedUrl: url, estimatedBytes: 0, isValid: true, ...extra });
const dup = (links, candidate, self) => w.findDuplicate(links, candidate, self)?.kind ?? null;

// 프리셋 중복 = 같은 서비스 (계정이 달라도). 다른 서비스·기타 행은 세지 않는다.
assert.equal(dup([preset('x', 'a')], preset('x', 'b')), 'duplicate');
assert.equal(dup([preset('x', 'a')], preset('github', 'a')), null);
assert.equal(dup([custom('https://x.com/a')], preset('x', 'a')), null, 'A 기타 row is not a service duplicate');
// 기타 중복 = 저장 URL이 완전히 같을 때만 (같은 도메인·대소문자·끝 슬래시 차이는 중복이 아니다)
assert.equal(dup([custom('https://example.com/a')], custom('https://example.com/a')), 'duplicate');
for (const other of ['https://example.com/b', 'https://example.com/A', 'https://example.com/a/', 'http://example.com/a']) {
  assert.equal(dup([custom('https://example.com/a')], custom(other)), null, other);
}
// 기존 행을 고칠 때 자기 자신은 세지 않는다 (selfIndex)
const pair = [preset('x', 'a'), preset('github', 'g')];
assert.equal(dup(pair, preset('x', 'a2'), 0), null, 'Editing the only X row');
assert.equal(dup([preset('x', 'a'), preset('x', 'b')], preset('x', 'a2'), 0), 'duplicate', 'Another X row still counts');
assert.equal(dup([custom('https://example.com/a')], custom('https://example.com/a'), 0), null, 'Editing the only identical 기타 row');
assert.equal(dup(pair, preset('x', 'new')), 'duplicate', 'Adding (no selfIndex) compares with every row');

// 행 경고 — 입력 문자열에서 매번 다시 계산 · 태그에서 읽은 행은 경고하지 않는다 (T3)
const kindsOf = (links, i) => w.warningsForLink(links, i).map((x) => x.kind);
assert.deepEqual(kindsOf([preset('x', 'hong$')], 0), ['chars']);
assert.deepEqual(kindsOf([preset('youtube', 'ab')], 0), ['format']);
assert.deepEqual(kindsOf([preset('x', 'ho$ng'), preset('x', 'ok')], 0), ['chars', 'duplicate'], 'Own warnings first, then duplicate');
assert.deepEqual(kindsOf([custom('https://example.com/a?x=1&y=$%')], 0), [], '기타 never gets the preset char rules');
assert.deepEqual(kindsOf([custom('bad name')], 0), ['format'], 'A malformed 기타 URL keeps its badge in the list');
assert.deepEqual(kindsOf([custom('bad name', { fromTag: true })], 0), [], 'but never for a row read from a tag');
const fromTag = [preset('instagram', 'a'), preset('instagram', 'b')].map((l) => ({ ...l, fromTag: true }));
assert.deepEqual([kindsOf(fromTag, 0), kindsOf(fromTag, 1)], [[], []], 'Tag rows load without warnings');
assert.deepEqual(kindsOf([...fromTag, preset('instagram', 'c')], 2), ['duplicate'], 'A new row that overlaps a tag row is flagged');
assert.deepEqual(kindsOf([...fromTag, preset('instagram', 'c')], 0), [], 'The tag row itself stays quiet');
assert.deepEqual(w.warningsForLink([], 0), []);
// 같은 문구를 입력 화면과 목록이 쓴다
const d = w.describeWarnings([{ kind: 'chars', message: 'm1' }, { kind: 'chars', message: 'm2' }, { kind: 'duplicate', message: 'm3' }]);
assert.deepEqual(d, { title: '허용 문자 위반 · 중복', message: 'm1\nm2\nm3' });

// 3-8 — hostOf: ①·② 공용. www.만 벗기고 서브도메인은 둔다. 파싱 불가면 '링크'.
for (const [url, host] of [['https://www.notion.so/a', 'notion.so'], ['https://velog.io/@x', 'velog.io'], ['http://Blog.Example.COM:8080/p', 'blog.example.com'],
    ['https://m.example.com/', 'm.example.com'], ['not a url', '링크'], ['', '링크']]) assert.equal(n.hostOf(url), host, url);

console.log('PASS: six preset patterns, normalization order (trim/paste/@/trailing slash/chars/case/assemble), YouTube-only 3~30 length, allowed chars incl. "-", per-service URL paste extraction, other-domain/non-account suggestion, handle-vs-URL false positives, tag URL classification, 기타 pipeline separation and unchanged tracking removal; format anomalies warn-and-add (preset whitespace -> %20, 기타 malformed URL) while empty input and non-http(s) schemes stay blocked; warning rules: same-service vs exact-URL duplicates, edit self-exclusion, tag rows quiet, per-row recompute; hostOf');
