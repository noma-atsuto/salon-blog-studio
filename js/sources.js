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
  // 会社の Google アカウントでログインし、読み取り専用の権限（drive.readonly）で一覧と写真を取得します。
  // ログインの鍵（アクセストークン）はページを開いている間だけメモリに置き、保存しません。
  const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const FOLDER = 'application/vnd.google-apps.folder';

  const GoogleDriveSource = {
    id: 'gdrive',
    label: '共有フォルダ',
    config: { clientId: '', rootFolderId: '', rootName: '共有フォルダ' },
    token: null, expiresAt: 0, tokenClient: null,
    get ready() { return Boolean(this.config.clientId && this.config.rootFolderId); },
    get signedIn() { return Boolean(this.token && Date.now() < this.expiresAt); },

    configure(cfg) {
      const changed = cfg.clientId !== this.config.clientId;
      this.config = Object.assign({}, this.config, cfg);
      if (changed) { this.tokenClient = null; this.token = null; }
    },

    loadGis() {
      if (root.google && root.google.accounts && root.google.accounts.oauth2) return Promise.resolve();
      if (this._gis) return this._gis;
      this._gis = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { this._gis = null; reject(new Error('Google のログイン部品を読み込めませんでした')); };
        document.head.appendChild(s);
      });
      return this._gis;
    },

    async signIn() {
      await this.loadGis();
      return new Promise((resolve, reject) => {
        if (!this.tokenClient) {
          this.tokenClient = root.google.accounts.oauth2.initTokenClient({
            client_id: this.config.clientId,
            scope: SCOPE,
            callback: () => {}
          });
        }
        this.tokenClient.callback = (res) => {
          if (res.error) { reject(new Error(res.error)); return; }
          this.token = res.access_token;
          this.expiresAt = Date.now() + (Number(res.expires_in) || 3600) * 1000 - 60000;
          resolve();
        };
        this.tokenClient.error_callback = (err) => reject(new Error((err && err.type) || 'popup_closed'));
        this.tokenClient.requestAccessToken({ prompt: this.token ? '' : 'select_account' });
      });
    },

    signOut() {
      if (this.token && root.google && root.google.accounts) root.google.accounts.oauth2.revoke(this.token, () => {});
      this.token = null; this.expiresAt = 0;
    },

    async request(url) {
      if (!this.signedIn) throw Object.assign(new Error('ログインが必要です'), { code: 401 });
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
      if (res.status === 401) { this.token = null; throw Object.assign(new Error('ログインの期限が切れました'), { code: 401 }); }
      if (res.status === 403 || res.status === 404) throw Object.assign(new Error('このフォルダを見る権限がありません'), { code: res.status });
      if (!res.ok) throw Object.assign(new Error(`読み込みに失敗しました（${res.status}）`), { code: res.status });
      return res;
    },

    // フォルダの中身（フォルダと画像）を取得
    async listFolder(folderId) {
      const q = `'${folderId}' in parents and trashed = false and (mimeType = '${FOLDER}' or mimeType contains 'image/')`;
      const fields = 'nextPageToken,files(id,name,mimeType,thumbnailLink,createdTime,imageMediaMetadata(time),lastModifyingUser(displayName),owners(displayName))';
      const out = { folders: [], images: [] };
      let pageToken = '';
      do {
        const params = new URLSearchParams({ q, fields, orderBy: 'folder,name', pageSize: '200', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await (await this.request(`${API}?${params}`)).json();
        for (const f of data.files || []) {
          if (f.mimeType === FOLDER) { out.folders.push({ id: f.id, name: f.name }); continue; }
          const shot = f.imageMediaMetadata && f.imageMediaMetadata.time;
          out.images.push({
            fileId: f.id, id: `gdrive:${f.id}`, name: f.name,
            thumb: f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, '=s400') : '',
            // 撮影日（写真の情報 "2026:10:01 12:00:00" 形式）がなければ登録日
            date: shot ? fmtDate(shot.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')) : fmtDate(f.createdTime),
            dateLabel: shot ? '撮影日' : '登録日',
            uploader: (f.owners && f.owners[0] && f.owners[0].displayName) || (f.lastModifyingUser && f.lastModifyingUser.displayName) || '—'
          });
        }
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      return out;
    },

    // 選んだ写真の本体を取得し、ブラウザの中だけで使える形にする
    async fetchImage(img) {
      if (registry.has(img.id)) return registry.get(img.id);
      const blob = await (await this.request(`${API}/${img.fileId}?alt=media&supportsAllDrives=true`)).blob();
      return register(Object.assign({}, img, { url: URL.createObjectURL(blob) }));
    }
  };

  const api = {
    sources: [LocalSource, GoogleDriveSource],
    byId: { local: LocalSource, gdrive: GoogleDriveSource },
    get(id) { return registry.get(id) || null; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SBS_SOURCES = api;
})(this);
