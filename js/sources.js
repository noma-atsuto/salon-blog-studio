/*
 * SALON BLOG STUDIO — 写真の取得元（アダプター）
 * 取得元ごとに同じ形で使えるようにしておき、後から別の保存先も足せるようにしています。
 * 選んだ写真はブラウザの中だけで扱い、このアプリからどこかへ送信・保存することはありません。
 */
(function (root) {
  function fmtDate(v) {
    const d = new Date(v);
    if (isNaN(d)) return '—';
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }
  // どの取得元の写真でも id で引けるようにする
  const registry = new Map();
  function register(item) { registry.set(item.id, item); return item; }

  // この端末から選んだ写真
  const LocalSource = {
    id: 'local',
    label: 'この端末から',
    ready: true,
    items: [],
    list() { return this.items; },
    add(files, uploaderName) {
      const added = [];
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        const id = `local:${f.name}:${f.size}:${f.lastModified}`;
        if (registry.has(id)) continue;
        const item = register({
          id, name: f.name, url: URL.createObjectURL(f),
          date: fmtDate(f.lastModified), dateLabel: '更新日',
          uploader: uploaderName || '—'
        });
        this.items.unshift(item);
        added.push(item);
      }
      return added;
    }
  };

  // 共有フォルダ（Google ドライブ）
  // オーナーのドライブに置いた「配る仕組み」（gas/Code.gs）に、合言葉をつけて問い合わせます。
  // スタッフは Google ログイン不要。配る範囲は「店舗写真（スタッフ共用）」フォルダの中だけです。
  function b64ToBlob(data, mime) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'image/jpeg' });
  }
  const ERRORS = {
    bad_key: '合言葉が違います',
    locked: '合言葉のまちがいが続いたため、10分ほど止まっています。少し待ってからお試しください',
    not_configured: '配る仕組みに合言葉が設定されていません（管理者に連絡してください）',
    forbidden: 'このフォルダの外の写真は見られません',
    not_found: '写真またはフォルダが見つかりません',
    too_large: '写真が大きすぎます（15MBまで）',
    network: '共有フォルダにつながりませんでした。通信状態か、配る仕組みのURLを確認してください'
  };

  const DriveRelaySource = {
    id: 'gdrive',
    label: '共有フォルダ',
    config: { endpoint: '', rootName: '共有フォルダ' },
    passcode: '',
    thumbs: new Map(),
    get ready() { return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(this.config.endpoint || ''); },
    get unlocked() { return Boolean(this.passcode); },
    configure(cfg) { this.config = Object.assign({}, this.config, cfg); },
    setPasscode(v) { this.passcode = v || ''; },

    async call(body) {
      let res;
      try {
        // text/plain にすると、ブラウザの事前確認なしで送れる（Apps Script 向けのよくある方法）
        res = await fetch(this.config.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: this.passcode }, body)) });
      } catch (e) { throw Object.assign(new Error(ERRORS.network), { code: 'network' }); }
      let data;
      try { data = await res.json(); } catch (e) { throw Object.assign(new Error(ERRORS.network), { code: 'network' }); }
      if (!data.ok) throw Object.assign(new Error(ERRORS[data.error] || `読み込みに失敗しました（${data.error}）`), { code: data.error });
      return data;
    },

    async check() { return this.call({ action: 'ping' }); },

    // フォルダの中身（フォルダと画像）
    async listFolder(folderId) {
      const data = await this.call({ action: 'list', folder: folderId || '' });
      return {
        folder: data.folder,
        folders: data.folders,
        images: data.images.map((f) => ({
          fileId: f.id, id: `gdrive:${f.id}`, name: f.name, thumb: this.thumbs.get(f.id) || '',
          date: fmtDate(f.created), dateLabel: '登録日', uploader: f.owner || '—'
        }))
      };
    },

    // 小さな見本画像（1枚ずつ取りに行き、覚えておく）
    async thumbnail(fileId) {
      if (this.thumbs.has(fileId)) return this.thumbs.get(fileId);
      const d = await this.call({ action: 'thumb', id: fileId });
      const url = d.data ? URL.createObjectURL(b64ToBlob(d.data, d.mime)) : '';
      this.thumbs.set(fileId, url);
      return url;
    },

    // 選んだ写真の本体（ブラウザの中だけで使う）
    async fetchImage(img) {
      if (registry.has(img.id)) return registry.get(img.id);
      const d = await this.call({ action: 'image', id: img.fileId });
      return register(Object.assign({}, img, { url: URL.createObjectURL(b64ToBlob(d.data, d.mime)) }));
    }
  };

  const api = {
    sources: [LocalSource, DriveRelaySource],
    byId: { local: LocalSource, gdrive: DriveRelaySource },
    get(id) { return registry.get(id) || null; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SBS_SOURCES = api;
})(this);
