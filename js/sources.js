/*
 * SALON BLOG STUDIO — 写真の取得元（アダプター）
 * 取得元ごとに同じ形（list / add）で使えるようにしておき、後から Google ドライブなどを足せるようにしています。
 * 写真はブラウザの中だけで扱い、どこにも送信・保存しません（ページを閉じると消えます）。
 */
(function (root) {
  function fmtDate(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

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
        if (this.items.some((x) => x.id === id)) continue;
        const item = {
          id, name: f.name, url: URL.createObjectURL(f), file: f,
          date: fmtDate(f.lastModified), dateLabel: '更新日',
          uploader: uploaderName || '—'
        };
        this.items.unshift(item);
        added.push(item);
      }
      return added;
    },
    get(id) { return this.items.find((x) => x.id === id) || null; }
  };

  // 共有フォルダ（Google ドライブ）— 次の段階で接続（Google ログイン → Drive API で一覧を取得）
  const GoogleDriveSource = {
    id: 'gdrive',
    label: '共有フォルダ',
    ready: false,
    note: 'Google ドライブとの接続は次の段階で設定します。今は「この端末から」で写真を選んでください。',
    list() { return []; },
    get() { return null; }
  };

  const api = { sources: [LocalSource, GoogleDriveSource], byId: { local: LocalSource, gdrive: GoogleDriveSource } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SBS_SOURCES = api;
})(this);
