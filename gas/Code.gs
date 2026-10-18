/**
 * SALON BLOG STUDIO — 共有フォルダの写真を配る仕組み（Google Apps Script）
 *
 * オーナーの権限で動き、ROOT_ID のフォルダの中にある写真だけを、合言葉を知っている人に返します。
 * ・ドライブのほかのファイルは返しません（フォルダの中かどうかを毎回確かめます）
 * ・合言葉はこのファイルに書かず、「プロジェクトの設定 → スクリプト プロパティ」の PASSCODE に入れます
 *   （PASSCODE を消すと合言葉なしで使える。もう一度入れると合言葉が必要に戻る）
 * ・合言葉を1時間に10回まちがえると、1時間すべて止めます（4桁の合言葉でも当てられにくくするため）
 * ・写真の追加（upload）と、アプリから追加した写真をゴミ箱に移す（trash）ことができます。そのほかの変更はしません
 * ・ゴミ箱に移せるのは「アプリから追加」の写真だけ・1時間に30枚まで。30日以内ならドライブのゴミ箱から戻せます
 * ・追加できるのはフォルダの中・画像だけ・1枚10MBまで・1時間に60枚まで。利用許可の確認が必要です
 */
const ROOT_ID = '1fxp-ECPTHG2UjGXpU7n00r6ATXIkNeAR'; // 店舗写真（スタッフ共用）
const MAX_BYTES = 15 * 1024 * 1024; // 1枚 15MB まで
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 追加は1枚 10MB まで
const MAX_UPLOADS_PER_HOUR = 60;
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_TRASH_PER_HOUR = 30;
const MAX_FAILS = 10;
const LOCK_SECONDS = 3600;

function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { return json_({ ok: false, error: 'bad_request' }); }
  // 合言葉が必要かどうかだけを答える（合言葉なしで聞ける。まちがいの回数には数えない）
  if (req.action === 'mode') return json_({ ok: true, needKey: Boolean(PropertiesService.getScriptProperties().getProperty('PASSCODE')) });
  try {
    checkKey_(req.key);
    let out;
    if (req.action === 'ping') out = { rootName: DriveApp.getFolderById(ROOT_ID).getName() };
    else if (req.action === 'list') out = list_(req.folder || ROOT_ID);
    else if (req.action === 'thumb') out = thumb_(req.id);
    else if (req.action === 'image') out = image_(req.id);
    else if (req.action === 'upload') out = upload_(req);
    else if (req.action === 'trash') out = trash_(req);
    else throw err_('bad_request');
    return json_(Object.assign({ ok: true }, out));
  } catch (x) {
    // 想定外のエラーは記録し、原因が分かるよう短い説明も返す
    if (!x.code) console.error(x);
    return json_({ ok: false, error: x.code || 'server_error', detail: x.code ? undefined : String((x && x.message) || x).slice(0, 200) });
  }
}

// ブラウザで直接開かれたとき（動いているかの確認用。中身は返さない）
function doGet() {
  return json_({ ok: true, service: 'salon-blog-studio' });
}

function checkKey_(key) {
  const pass = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  if (!pass) return; // 合言葉が設定されていなければ、確認しない
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
    // アプリから追加した写真は、説明欄の「投稿者:」を投稿者として返す
    let owner = '';
    const m = String(f.getDescription() || '').match(/投稿者:\s*([^\n／]+)/);
    if (m) owner = m[1].trim();
    else { try { owner = f.getOwner() ? f.getOwner().getName() : ''; } catch (x) { owner = ''; } }
    images.push({ id: f.getId(), name: f.getName(), created: f.getDateCreated().toISOString(), owner: owner, app: isAppUpload_(f) });
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

// 写真を1枚追加する（フォルダの中だけ・画像だけ・利用許可の確認が必要）
function upload_(req) {
  if (req.consent !== true) throw err_('no_consent');
  if (UPLOAD_TYPES.indexOf(String(req.mime)) < 0) throw err_('not_image');
  let folder;
  try { folder = DriveApp.getFolderById(String(req.folder || '')); } catch (x) { throw err_('not_found'); }
  if (!folderInRoot_(folder.getId(), 0)) throw err_('forbidden');
  const bytes = Utilities.base64Decode(String(req.data || ''));
  if (!bytes.length) throw err_('bad_request');
  if (bytes.length > MAX_UPLOAD_BYTES) throw err_('too_large');
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get('uploads') || 0);
  if (count >= MAX_UPLOADS_PER_HOUR) throw err_('upload_limit');
  cache.put('uploads', String(count + 1), 3600);
  // ファイル名は記号を除いて短くする
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[req.mime];
  const base = String(req.name || 'photo').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 60) || 'photo';
  const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmm');
  const file = folder.createFile(Utilities.newBlob(bytes, req.mime, stamp + '_' + base + '.' + ext));
  const uploader = String(req.uploader || '不明').replace(/[\r\n／]+/g, ' ').slice(0, 40);
  file.setDescription('投稿者: ' + uploader + '／利用許可: 確認済み（アプリから追加）／登録: ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'));
  return { file: { id: file.getId(), name: file.getName() } };
}

// アプリから追加した写真か（説明欄の印で見分ける）
function isAppUpload_(file) { return /アプリから追加/.test(String(file.getDescription() || '')); }

// まちがえて追加した写真を、ゴミ箱に移す（アプリから追加した写真だけ。30日以内なら戻せる）
function trash_(req) {
  const file = safeFile_(req.id);
  if (!isAppUpload_(file)) throw err_('not_app_upload');
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get('trashes') || 0);
  if (count >= MAX_TRASH_PER_HOUR) throw err_('trash_limit');
  cache.put('trashes', String(count + 1), 3600);
  const by = String(req.by || '不明').replace(/[\r\n／]+/g, ' ').slice(0, 40);
  file.setDescription(file.getDescription() + '／削除: ' + by + '（' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') + '）');
  file.setTrashed(true);
  return { trashed: file.getId() };
}

function err_(code) { const e = new Error(code); e.code = code; return e; }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 書き込みの許可を確かめる（エディタから1回だけ実行する。フォルダの説明を同じ内容で書き直すだけで、中身は変えない）
function checkWritePermission() {
  const folder = DriveApp.getFolderById(ROOT_ID);
  folder.setDescription(folder.getDescription() || '');
  return 'ok';
}
