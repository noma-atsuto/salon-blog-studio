// gas/Code.gs（配る仕組み）の安全の決まりを、Google ドライブの代わりの見本で検査する
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = '1fxp-ECPTHG2UjGXpU7n00r6ATXIkNeAR';
// 見本のドライブ：ROOT > HAIR > photo1.jpg、ROOT の外に SECRET > secret.jpg と memo.txt
const folders = { [ROOT]: { name: '店舗写真（スタッフ共用）', parents: ['MYDRIVE'] }, HAIR: { name: '03_ヘアスタイル作品', parents: [ROOT] }, SECRET: { name: '経理', parents: ['MYDRIVE'] }, MYDRIVE: { name: 'マイドライブ', parents: [] } };
const files = {
  photo1: { name: 'photo1.jpg', mime: 'image/jpeg', parents: ['HAIR'], size: 1000 },
  secret: { name: 'secret.jpg', mime: 'image/jpeg', parents: ['SECRET'], size: 1000 },
  memo: { name: 'memo.txt', mime: 'text/plain', parents: [ROOT], size: 10 },
  huge: { name: 'huge.jpg', mime: 'image/jpeg', parents: [ROOT], size: 99 * 1024 * 1024 }
};
const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
const blob = (mime) => ({ getContentType: () => mime, getBytes: () => [1, 2, 3] });
function folderObj(id) {
  if (!folders[id]) throw new Error('no folder');
  return {
    getId: () => id, getName: () => folders[id].name,
    getParents: () => iter(folders[id].parents.map(folderObj)),
    getFolders: () => iter(Object.keys(folders).filter((k) => folders[k].parents.includes(id)).map(folderObj)),
    getFiles: () => iter(Object.keys(files).filter((k) => files[k].parents.includes(id)).map(fileObj))
  };
}
function fileObj(id) {
  const f = files[id];
  if (!f) throw new Error('no file');
  return {
    getId: () => id, getName: () => f.name, getMimeType: () => f.mime, getSize: () => f.size, isTrashed: () => false,
    getDateCreated: () => new Date('2026-10-12T00:00:00Z'), getOwner: () => ({ getName: () => 'オーナー' }),
    getParents: () => iter(f.parents.map(folderObj)), getThumbnail: () => blob('image/png'), getBlob: () => blob(f.mime)
  };
}

function load(passcode) {
  const store = new Map();
  const ctx = {
    DriveApp: { getFolderById: folderObj, getFileById: fileObj },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'PASSCODE' ? passcode : null) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => store.set(k, v) }) },
    Utilities: { base64Encode: () => 'AQID' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ body: JSON.parse(t) }) }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/Code.gs'), 'utf8'), ctx);
  return (req) => ctx.doPost({ postData: { contents: JSON.stringify(req) } }).body;
}

test('合言葉が正しければ一覧が返り、違えば断る', () => {
  const call = load('salon-2026');
  assert.equal(call({ key: 'salon-2026', action: 'ping' }).rootName, '店舗写真（スタッフ共用）');
  const list = call({ key: 'salon-2026', action: 'list' });
  assert.deepEqual(list.folders.map((f) => f.name), ['03_ヘアスタイル作品']);
  assert.deepEqual(list.images.map((f) => f.name), ['huge.jpg']); // 画像以外（memo.txt）は出さない
  assert.equal(call({ key: 'wrong', action: 'list' }).error, 'bad_key');
  assert.equal(call({ action: 'list' }).error, 'bad_key');
});

test('合言葉が未設定なら何も返さない', () => {
  assert.equal(load(null)({ key: '', action: 'list' }).error, 'not_configured');
});

test('フォルダの外のファイル・フォルダは返さない', () => {
  const call = load('k');
  assert.equal(call({ key: 'k', action: 'list', folder: 'SECRET' }).error, 'forbidden');
  assert.equal(call({ key: 'k', action: 'image', id: 'secret' }).error, 'forbidden');
  assert.equal(call({ key: 'k', action: 'thumb', id: 'secret' }).error, 'forbidden');
  assert.equal(call({ key: 'k', action: 'image', id: 'memo' }).error, 'not_image');
  assert.equal(call({ key: 'k', action: 'image', id: 'nothing' }).error, 'not_found');
  assert.ok(call({ key: 'k', action: 'image', id: 'photo1' }).ok); // 下の階層の写真は返す
  assert.equal(call({ key: 'k', action: 'image', id: 'huge' }).error, 'too_large');
});

test('合言葉を10回まちがえると、正しい合言葉でも止まる', () => {
  const call = load('4831');
  for (let i = 0; i < 9; i++) call({ key: '0000', action: 'ping' });
  assert.ok(call({ key: '4831', action: 'ping' }).ok); // 9回までは止まらない
  for (let i = 0; i < 1; i++) call({ key: 'x', action: 'ping' });
  assert.equal(call({ key: '4831', action: 'ping' }).error, 'locked');
});
