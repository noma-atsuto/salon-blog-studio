/**
 * SALON BLOG STUDIO — 共有フォルダの写真を配る仕組み（Google Apps Script）
 *
 * オーナーの権限で動き、ROOT_ID のフォルダの中にある写真だけを、合言葉を知っている人に返します。
 * ・ドライブのほかのファイルは返しません（フォルダの中かどうかを毎回確かめます）
 * ・合言葉はこのファイルに書かず、「プロジェクトの設定 → スクリプト プロパティ」の PASSCODE に入れます
 * ・合言葉を1時間に10回まちがえると、1時間すべて止めます（4桁の合言葉でも当てられにくくするため）
 * ・写真の変更・削除はしません（読むだけ）
 */
const ROOT_ID = '1fxp-ECPTHG2UjGXpU7n00r6ATXIkNeAR'; // 店舗写真（スタッフ共用）
const MAX_BYTES = 15 * 1024 * 1024; // 1枚 15MB まで
const MAX_FAILS = 10;
const LOCK_SECONDS = 3600;

function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { return json_({ ok: false, error: 'bad_request' }); }
  try {
    checkKey_(req.key);
    let out;
    if (req.action === 'ping') out = { rootName: DriveApp.getFolderById(ROOT_ID).getName() };
    else if (req.action === 'list') out = list_(req.folder || ROOT_ID);
    else if (req.action === 'thumb') out = thumb_(req.id);
    else if (req.action === 'image') out = image_(req.id);
    else throw err_('bad_request');
    return json_(Object.assign({ ok: true }, out));
  } catch (x) {
    return json_({ ok: false, error: x.code || 'server_error' });
  }
}

// ブラウザで直接開かれたとき（動いているかの確認用。中身は返さない）
function doGet() {
  return json_({ ok: true, service: 'salon-blog-studio' });
}

function checkKey_(key) {
  const pass = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  if (!pass) throw err_('not_configured');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) throw err_('locked');
  if (typeof key !== 'string' || key !== pass) {
    cache.put('fails', String(fails + 1), LOCK_SECONDS);
    throw err_('bad_key');
  }
}

// フォルダが ROOT_ID の中にあるか（親をたどって確かめる。確認済みのものは6時間覚えておく）
function folderInRoot_(id, depth) {
  if (id === ROOT_ID) return true;
  if ((depth || 0) > 20) return false;
  const cache = CacheService.getScriptCache();
  if (cache.get('in:' + id) === '1') return true;
  const parents = DriveApp.getFolderById(id).getParents();
  while (parents.hasNext()) {
    if (folderInRoot_(parents.next().getId(), (depth || 0) + 1)) { cache.put('in:' + id, '1', 21600); return true; }
  }
  return false;
}
function fileInRoot_(file) {
  const parents = file.getParents();
  while (parents.hasNext()) if (folderInRoot_(parents.next().getId(), 0)) return true;
  return false;
}
function safeFile_(id) {
  let file;
  try { file = DriveApp.getFileById(String(id)); } catch (x) { throw err_('not_found'); }
  if (!fileInRoot_(file)) throw err_('forbidden');
  if (!/^image\//.test(file.getMimeType())) throw err_('not_image');
  return file;
}

function list_(folderId) {
  let folder;
  try { folder = DriveApp.getFolderById(String(folderId)); } catch (x) { throw err_('not_found'); }
  if (!folderInRoot_(folder.getId(), 0)) throw err_('forbidden');
  const folders = [], images = [];
  const fi = folder.getFolders();
  while (fi.hasNext()) { const f = fi.next(); folders.push({ id: f.getId(), name: f.getName() }); }
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!/^image\//.test(f.getMimeType()) || f.isTrashed()) continue;
    let owner = '';
    try { owner = f.getOwner() ? f.getOwner().getName() : ''; } catch (x) { owner = ''; }
    images.push({ id: f.getId(), name: f.getName(), created: f.getDateCreated().toISOString(), owner: owner });
  }
  const byName = function (a, b) { return a.name.localeCompare(b.name, 'ja'); };
  folders.sort(byName); images.sort(byName);
  return { folder: { id: folder.getId(), name: folder.getName() }, folders: folders, images: images };
}

function thumb_(id) {
  const file = safeFile_(id);
  let blob = null;
  try { blob = file.getThumbnail(); } catch (x) { blob = null; }
  if (!blob) return { mime: null, data: null };
  return { mime: blob.getContentType() || 'image/png', data: Utilities.base64Encode(blob.getBytes()) };
}

function image_(id) {
  const file = safeFile_(id);
  if (file.getSize() > MAX_BYTES) throw err_('too_large');
  const blob = file.getBlob();
  return { name: file.getName(), mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function err_(code) { const e = new Error(code); e.code = code; return e; }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
