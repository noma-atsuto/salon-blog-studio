/*
 * SALON BLOG STUDIO — 画面の動き
 * 保存先はこの端末のブラウザ（localStorage）のみ。写真は保存しません。
 */
(function () {
  const DEFAULTS = window.SBS_DEFAULTS;
  const E = window.SBS_ENGINE;
  const SRC = window.SBS_SOURCES;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];
  const GROUP_LABELS = { color: 'カラー', perm: 'パーマ', cut: 'カット', straight: '縮毛矯正', custom: 'カスタム' };

  // ---- 保存（使えない環境でも画面は動くようにする） ----
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  // ---- 設定（初期データ＋管理画面での変更） ----
  function loadSettings() {
    const s = clone(DEFAULTS);
    const o = store.get('sbs.settings', {});
    if (o.staff) s.staff = o.staff;
    if (o.forbidden) s.forbidden = o.forbidden;
    if (o.drive) s.drive = Object.assign({}, s.drive, o.drive);
    if (o.subtitles) Object.assign(s.subtitles, o.subtitles);
    if (o.catches) for (const k of Object.keys(o.catches)) Object.assign(s.catches[k], o.catches[k]);
    if (o.colors) {
      const cg = s.genres.find((g) => g.id === 'color');
      for (const sub of cg.subs) if (o.colors[sub.id]) sub.colors = o.colors[sub.id];
    }
    return s;
  }
  function saveOverride(mutator) {
    const o = store.get('sbs.settings', {});
    mutator(o);
    store.set('sbs.settings', o);
    settings = loadSettings();
    SRC.byId.gdrive.configure(settings.drive);
  }
  let settings = loadSettings();
  SRC.byId.gdrive.configure(settings.drive);

  // ---- 状態 ----
  function seasonOfMonth(m) { return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'; }
  const saved = store.get('sbs.state', {});
  const startSeason = seasonOfMonth(new Date().getMonth() + 1);
  const state = Object.assign({
    season: startSeason, tone: settings.seasons[startSeason].defaultTone,
    staffId: settings.staff[0] ? settings.staff[0].id : null,
    genreId: 'color', subId: null, hairColor: 'auto',
    customLabel: '', customTitle: '', customNote: '',
    source: 'local'
  }, saved, { imageId: null });
  const ui = { cands: [], selected: 0, round: 0, texts: { category: '', catch: '', title: '', subtitle: '' }, crops: {} };

  function saveState() {
    const { imageId, ...rest } = state;
    store.set('sbs.state', rest);
  }
  function currentImage() { return state.imageId ? SRC.get(state.imageId) : null; }
  function currentStaff() { return settings.staff.find((s) => s.id === state.staffId) || null; }
  function engineState() { const img = currentImage(); return Object.assign({}, state, { image: img ? { id: img.id, name: img.name } : null }); }

  // ---- 通知 ----
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ---- 01 写真 ----
  function renderSource() {
    $('sourceTabs').innerHTML = SRC.sources.map((s) =>
      `<button type="button" data-src="${s.id}" class="${state.source === s.id ? 'on' : ''}">${esc(s.label)}</button>`).join('');
    const src = SRC.byId[state.source] || SRC.byId.local;
    if (src.id === 'gdrive') { renderDrive(); return; }
    const items = src.list();
    $('sourceBody').innerHTML = `
      <label class="drop" id="drop">
        <input type="file" id="fileInput" accept="image/*" multiple hidden>
        写真をここにドラッグ、またはタップして選ぶ
      </label>
      ${items.length ? `<div class="gallery">${items.map((it) => `
        <div class="thumb ${state.imageId === it.id ? 'on' : ''}">
          <img src="${it.url}" alt="${esc(it.name)}" data-img>
          <div class="meta"><b>${esc(it.name)}</b>${esc(it.dateLabel)} ${esc(it.date)}<br>投稿者 ${esc(it.uploader)}</div>
          <button type="button" class="btn btn-sm ${state.imageId === it.id ? 'btn-primary' : ''}" data-pick="${esc(it.id)}">${state.imageId === it.id ? '選択中' : '選択'}</button>
        </div>`).join('')}</div>`
        : '<p class="empty">まだ写真がありません。写真はこの端末の中だけで使い、どこにも送信されません。</p>'}`;
    $('sourceBody').querySelectorAll('img[data-img]').forEach((img) => {
      img.addEventListener('error', () => { img.outerHTML = '<div class="img-error">読み込めませんでした</div>'; });
    });
    const drop = $('drop'), input = $('fileInput');
    input.addEventListener('change', () => addFiles(input.files));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
  }
  // ---- 共有フォルダ（Google ドライブ。オーナーの「配る仕組み」経由） ----
  const drive = { path: [], list: null, loading: false, error: '', picking: '' };
  SRC.byId.gdrive.setPasscode(store.get('sbs.drivePass', ''));
  function thumbCard(it, selected, extra) {
    const src = it.thumb || it.url;
    return `<div class="thumb ${selected ? 'on' : ''}">
      ${src ? `<img src="${esc(src)}" alt="${esc(it.name)}" data-img>` : `<div class="img-error" data-thumb="${esc(it.fileId || '')}">読み込み中…</div>`}
      <div class="meta"><b>${esc(it.name)}</b>${esc(it.dateLabel)} ${esc(it.date)}<br>投稿者 ${esc(it.uploader)}</div>
      ${extra}
    </div>`;
  }
  function renderDrive() {
    const G = SRC.byId.gdrive;
    const body = $('sourceBody');
    if (!G.ready) {
      body.innerHTML = `<div style="margin-top:12px">
        <p class="note" style="margin:0 0 8px">共有フォルダを使うには、管理者から届いた「設定ファイル」を読み込みます（最初の1回だけ）。それまでは「この端末から」で写真を選べます。</p>
        <label class="btn btn-primary">設定ファイルを読み込む<input type="file" id="configFile" accept=".json" hidden></label></div>`;
      return;
    }
    if (!G.unlocked) {
      body.innerHTML = `<div style="margin-top:12px">
        <label class="note" for="drivePass" style="display:block;margin:0 0 6px">共有フォルダの合言葉</label>
        <div class="actions"><input id="drivePass" class="input" type="password" autocomplete="off" style="max-width:220px" placeholder="合言葉">
        <button type="button" class="btn btn-primary" id="btnDriveIn">開く</button></div>
        <p class="note">合言葉はこの端末に記憶されます。わからないときは管理者に確認してください。</p>
        ${drive.error ? `<ul class="warn" style="margin-top:8px"><li>${esc(drive.error)}</li></ul>` : ''}</div>`;
      return;
    }
    const crumbs = drive.path.map((p, i) => i === drive.path.length - 1
      ? `<b>${esc(p.name)}</b>` : `<button type="button" class="link" data-crumb="${i}">${esc(p.name)}</button>`).join(' <span class="sep">/</span> ');
    let inner = '';
    if (drive.loading) inner = '<p class="empty">読み込み中…</p>';
    else if (drive.error) inner = `<ul class="warn" style="margin-top:10px"><li>${esc(drive.error)}</li></ul><button type="button" class="btn btn-sm" id="btnDriveRetry">もう一度読み込む</button>`;
    else if (drive.list) {
      const { folders, images } = drive.list;
      inner = (folders.length ? `<div class="folders">${folders.map((f) => `<button type="button" class="chip" data-folder="${esc(f.id)}" data-folder-name="${esc(f.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>${esc(f.name)}</button>`).join('')}</div>` : '')
        + (images.length ? `<div class="gallery">${images.map((it) => thumbCard(it, state.imageId === it.id,
          `<button type="button" class="btn btn-sm ${state.imageId === it.id ? 'btn-primary' : ''}" data-dpick="${esc(it.id)}" ${drive.picking === it.id ? 'disabled' : ''}>${drive.picking === it.id ? '読み込み中…' : state.imageId === it.id ? '選択中' : '選択'}</button>`)).join('')}</div>`
          : folders.length ? '' : '<p class="empty">このフォルダには写真がありません。</p>');
    }
    body.innerHTML = `<div class="crumbs">${crumbs || esc(G.config.rootName)}<button type="button" class="link" id="btnDriveOut" style="margin-left:auto">合言葉を消す</button></div>${inner}
      <p class="note">お客様の顔が写った写真は、利用の許可があるものだけを使ってください。</p>`;
    body.querySelectorAll('img[data-img]').forEach((img) => {
      img.addEventListener('error', () => { img.outerHTML = '<div class="img-error">プレビューなし</div>'; });
    });
    if (!drive.list && !drive.loading && !drive.error) { openFolder(); return; }
    loadThumbs();
  }
  // 見本画像は4枚ずつ取りに行く（配る仕組みに負担をかけすぎない）
  let thumbRun = 0;
  async function loadThumbs() {
    const run = ++thumbRun;
    const todo = drive.list ? drive.list.images.filter((x) => !x.thumb) : [];
    const worker = async () => {
      while (todo.length && run === thumbRun) {
        const it = todo.shift();
        try { it.thumb = await SRC.byId.gdrive.thumbnail(it.fileId); } catch (e) { it.thumb = ''; }
        const el = document.querySelector(`[data-thumb="${CSS.escape(it.fileId)}"]`);
        if (el && run === thumbRun) el.outerHTML = it.thumb ? `<img src="${esc(it.thumb)}" alt="${esc(it.name)}">` : '<div class="img-error">プレビューなし</div>';
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }
  function driveError(e) {
    if (e.code === 'bad_key') { SRC.byId.gdrive.setPasscode(''); store.set('sbs.drivePass', ''); }
    return e.message;
  }
  async function openFolder() {
    const G = SRC.byId.gdrive;
    drive.loading = true; drive.error = ''; renderDrive();
    try {
      const cur = drive.path[drive.path.length - 1];
      drive.list = await G.listFolder(cur ? cur.id : '');
      if (!drive.path.length) drive.path = [{ id: drive.list.folder.id, name: drive.list.folder.name }];
    } catch (e) { drive.list = null; drive.error = driveError(e); }
    drive.loading = false; renderDrive();
  }
  async function driveUnlock() {
    const v = $('drivePass').value.trim();
    if (!v) { toast('合言葉を入れてください'); return; }
    const G = SRC.byId.gdrive;
    G.setPasscode(v); drive.error = '';
    try { await G.check(); store.set('sbs.drivePass', v); drive.list = null; drive.path = []; }
    catch (e) { G.setPasscode(''); drive.error = e.message; }
    renderDrive();
  }
  async function drivePick(id) {
    const img = drive.list && drive.list.images.find((x) => x.id === id);
    if (!img) return;
    drive.picking = id; renderDrive();
    try {
      await SRC.byId.gdrive.fetchImage(img);
      state.imageId = id; update();
      toast('写真を選びました');
    } catch (e) { toast(driveError(e)); }
    drive.picking = ''; renderDrive();
  }

  function addFiles(files) {
    const staff = currentStaff();
    const added = SRC.byId.local.add(files, staff ? staff.name : '');
    if (!added.length) { toast('画像ファイルを選んでください'); return; }
    if (!state.imageId) state.imageId = added[0].id;
    renderSource(); update();
    toast(`${added.length}枚の写真を追加しました`);
  }

  // ---- 02〜05 設定 ----
  function renderSeasons() {
    $('seasonTabs').innerHTML = SEASON_IDS.map((id) =>
      `<button type="button" data-season="${id}" class="${state.season === id ? 'on' : ''}">${settings.seasons[id].label}</button>`).join('');
    const def = settings.seasons[state.season].defaultTone;
    $('toneTabs').innerHTML = Object.entries(settings.tones).map(([id, label]) =>
      `<button type="button" data-tone="${id}" class="${state.tone === id ? 'on' : ''}">${label}${id === def ? '（おすすめ）' : ''}</button>`).join('');
  }
  function renderStaff() {
    const sel = $('staffSelect');
    if (!settings.staff.length) { sel.innerHTML = '<option value="">管理画面でスタッフを登録してください</option>'; state.staffId = null; return; }
    if (!currentStaff()) state.staffId = settings.staff[0].id;
    sel.innerHTML = settings.staff.map((s) => `<option value="${esc(s.id)}" ${s.id === state.staffId ? 'selected' : ''}>${esc(s.name)}（${esc(s.store)}）</option>`).join('');
  }
  function renderGenres() {
    $('genreTabs').innerHTML = settings.genres.map((g) =>
      `<button type="button" data-genre="${g.id}" class="${state.genreId === g.id ? 'on' : ''}">${esc(g.short)}</button>`).join('');
    const g = E.findGenre(settings, state.genreId);
    let html = '';
    if (g.subs) {
      const sub = E.findSub(g, state.subId);
      html = `<div class="subseg"><div class="label">${esc(g.short)}の種類</div>
        <div class="seg seg-wrap" style="grid-template-columns:repeat(${g.subs.length > 2 ? 2 : g.subs.length},1fr)">
        ${g.subs.map((s) => `<button type="button" data-sub="${s.id}" class="${sub.id === s.id ? 'on' : ''}">${esc(s.label)}</button>`).join('')}
        </div></div>`;
    } else if (g.id === 'custom') {
      html = `<div class="subseg grid2">
        <div class="field"><label for="cLabel">施術名（カテゴリーに表示）</label><input id="cLabel" class="input" data-custom="customLabel" value="${esc(state.customLabel)}" placeholder="例：メンズヘッドスパ"></div>
        <div class="field"><label for="cTitle">メインタイトル</label><input id="cTitle" class="input" data-custom="customTitle" value="${esc(state.customTitle)}" placeholder="例：頭皮リセット"></div>
        <div class="field" style="grid-column:1/-1"><label for="cNote">仕上がりの補足（任意）</label><input id="cNote" class="input" data-custom="customNote" value="${esc(state.customNote)}" placeholder="例：髪型はそのまま、艶を少し出す"></div>
      </div>`;
    }
    $('genreSub').innerHTML = html;
  }
  function renderColors() {
    const g = E.findGenre(settings, state.genreId);
    const first = g.group === 'color' ? { v: 'auto', t: 'おまかせ' } : { v: 'keep', t: '写真の髪色のまま' };
    const colors = E.colorsFor(settings, state);
    if (state.hairColor !== first.v && !colors.some((c) => c.name === state.hairColor)) state.hairColor = first.v;
    $('colorChips').innerHTML =
      `<button type="button" class="chip ${state.hairColor === first.v ? 'on' : ''}" data-color="${first.v}">${first.t}</button>` +
      colors.map((c) => `<button type="button" class="chip ${state.hairColor === c.name ? 'on' : ''}" data-color="${esc(c.name)}"><span class="sw" style="background:${c.hex}"></span>${esc(c.name)}</button>`).join('');
  }

  // ---- 06 文章 ----
  function regen(keepRound) {
    if (!keepRound) ui.round = 0;
    ui.cands = E.generateCandidates(settings, engineState(), ui.round);
    ui.selected = 0;
    ui.texts = Object.assign({}, ui.cands[0]);
    renderCands(); renderFields(); update();
  }
  function renderCands() {
    $('cands').innerHTML = ui.cands.map((c, i) => `
      <button type="button" class="cand ${ui.selected === i ? 'on' : ''}" data-cand="${i}">
        案${i + 1}<br>${esc(c.catch)}<span class="t">${esc(c.title)}</span>${esc(c.subtitle)}
      </button>`).join('');
  }
  const FIELD_DEFS = [['category', 'カテゴリー', 0], ['catch', 'キャッチコピー', E.MAX_CHARS], ['title', 'メインタイトル', E.MAX_CHARS], ['subtitle', 'サブタイトル', E.MAX_CHARS]];
  function renderFields() {
    $('fields').innerHTML = FIELD_DEFS.map(([k, label, max]) => `
      <div class="field"><label for="f-${k}">${label}</label>
        <input id="f-${k}" class="input" data-field="${k}" value="${esc(ui.texts[k])}">
        ${max ? `<span class="count" id="cnt-${k}"></span>` : ''}
      </div>`).join('');
    updateCounts();
  }
  function updateCounts() {
    for (const [k, , max] of FIELD_DEFS) {
      if (!max) continue;
      const n = E.charCount(ui.texts[k]);
      const el = $(`cnt-${k}`);
      el.textContent = `${n} / ${max}文字`;
      el.classList.toggle('over', n > max);
    }
  }

  // ---- 07 プレビュー ----
  function renderPreview() {
    const p = E.paletteOf(settings, state);
    const img = currentImage();
    const crop = (img && ui.crops[img.id]) || { x: 50, y: 50, z: 100 };
    const len = Math.max(E.charCount(ui.texts.title), 1);
    const size = Math.max(3.4, Math.min(6.4, 42 / len));
    $('preview').innerHTML = `
      <div class="pv" style="background:linear-gradient(135deg, ${p.bg} 0%, ${p.bg} 45%, ${p.bgSub} 100%);color:${p.text}">
        <div class="pv-photo">${img
          ? `<img src="${img.url}" alt="選んだ写真" style="object-position:${crop.x}% ${crop.y}%;transform:scale(${crop.z / 100});transform-origin:${crop.x}% ${crop.y}%">`
          : '<div class="ph">01 で写真を選ぶと<br>ここに表示されます</div>'}</div>
        <div class="pv-text">
          <span class="pv-band" style="background:${p.band};color:${p.bandText}">${esc(ui.texts.category)}</span>
          <p class="pv-catch">${esc(ui.texts.catch)}</p>
          <h3 class="pv-title" style="color:${p.title};font-size:${size}cqw">${esc(ui.texts.title)}</h3>
          <div class="pv-line short" style="background:${p.accent}"></div>
          <p class="pv-sub">${esc(ui.texts.subtitle)}</p>
          <span class="pv-season" style="color:${p.title}">${settings.seasons[state.season].en}</span>
        </div>
        <div class="pv-frame" style="border-color:${p.accent}"></div>
      </div>`;
    const imgEl = $('preview').querySelector('img');
    if (imgEl) imgEl.addEventListener('error', () => { imgEl.outerHTML = '<div class="ph">写真を読み込めませんでした</div>'; });

    $('crop').innerHTML = img ? [['x', '横の位置', 0, 100], ['y', '縦の位置', 0, 100], ['z', '拡大', 100, 200]].map(([k, l, min, max]) =>
      `<div><label for="crop-${k}">${l}</label><input type="range" id="crop-${k}" min="${min}" max="${max}" value="${crop[k]}" data-crop="${k}"></div>`).join('') : '';
  }

  // ---- 08 プロンプト ----
  function currentPrompt() { return E.buildPrompt(settings, engineState(), ui.texts, currentStaff()); }
  function update() {
    renderPreview();
    $('promptText').textContent = currentPrompt();
    const w = E.validate(settings, engineState(), ui.texts);
    $('warnings').innerHTML = w.map((x) => `<li>${esc(x)}</li>`).join('');
    saveState();
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove(); return ok;
    }
  }

  // ---- 履歴 ----
  function addHistory(prompt) {
    const list = store.get('sbs.history', []);
    const staff = currentStaff();
    const img = currentImage();
    if (list[0] && list[0].prompt === prompt) { list[0].at = Date.now(); }
    else {
      list.unshift({
        id: `h${Date.now()}`, at: Date.now(),
        staffId: state.staffId, staffName: staff ? staff.name : '',
        season: state.season, tone: state.tone, genreId: state.genreId, subId: state.subId, hairColor: state.hairColor,
        customLabel: state.customLabel, customTitle: state.customTitle, customNote: state.customNote,
        imageId: img ? img.id : null, imageName: img ? img.name : '',
        texts: Object.assign({}, ui.texts), prompt
      });
    }
    store.set('sbs.history', list.slice(0, 100));
  }
  function fmtAt(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function genreLabel(h) {
    const g = E.findGenre(settings, h.genreId);
    const sub = E.findSub(g, h.subId);
    return g.id === 'custom' ? (h.customLabel || 'カスタム') : sub ? sub.label : g.label;
  }
  function renderHistory() {
    const list = store.get('sbs.history', []);
    $('historyList').innerHTML = list.length ? list.map((h) => `
      <div class="card hist">
        <div>
          <div class="t">${esc(h.texts.title)}</div>
          <div class="m">${fmtAt(h.at)}・${esc(h.staffName || '投稿者なし')}・${esc((settings.seasons[h.season] || {}).label || '')}・${esc(genreLabel(h))}</div>
          <div class="m">${esc(h.texts.catch)} ／ ${esc(h.texts.subtitle)}${h.imageName ? `<br>写真：${esc(h.imageName)}` : ''}</div>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-sm" data-h-edit="${h.id}">再編集</button>
          <button type="button" class="btn btn-sm" data-h-copy="${h.id}">再コピー</button>
          <button type="button" class="btn btn-sm btn-danger" data-h-del="${h.id}">削除</button>
        </div>
      </div>`).join('') : '<div class="card"><p class="empty">まだ履歴はありません。「プロンプトをコピー」を押すと記録されます。</p></div>';
  }

  // ---- 投稿数（プロンプトをコピーした回数） ----
  function renderPosts() {
    const list = store.get('sbs.history', []);
    const now = new Date();
    const ym = (ms) => { const d = new Date(ms); return d.getFullYear() * 12 + d.getMonth(); };
    const thisM = ym(now.getTime());
    const rows = new Map();
    for (const s of settings.staff) rows.set(s.id, { name: s.name, month: 0, last: 0, total: 0 });
    for (const h of list) {
      // スタッフを取り込み直してIDが変わっても、名前が同じなら同じ人として数える
      const byName = settings.staff.find((s) => s.name === h.staffName);
      const key = rows.has(h.staffId) ? h.staffId : byName ? byName.id : `x:${h.staffName || '投稿者なし'}`;
      if (!rows.has(key)) rows.set(key, { name: `${h.staffName || '投稿者なし'}（登録外）`, month: 0, last: 0, total: 0 });
      const r = rows.get(key);
      r.total += 1;
      if (ym(h.at) === thisM) r.month += 1;
      if (ym(h.at) === thisM - 1) r.last += 1;
    }
    const data = [...rows.values()].sort((a, b) => b.month - a.month || b.total - a.total);
    const max = Math.max(1, ...data.map((r) => r.month));
    const sum = (k) => data.reduce((n, r) => n + r[k], 0);
    $('postsBody').innerHTML = `
      <div class="stat-row">
        <div class="stat"><div class="k">今月（${now.getMonth() + 1}月）</div><div class="v">${sum('month')}</div></div>
        <div class="stat"><div class="k">先月</div><div class="v">${sum('last')}</div></div>
        <div class="stat"><div class="k">累計</div><div class="v">${sum('total')}</div></div>
      </div>
      <div class="card">
        ${data.length ? `<table class="posts">
          <thead><tr><th>スタッフ</th><th class="barcell"></th><th style="text-align:right">今月</th><th style="text-align:right">先月</th><th style="text-align:right">累計</th></tr></thead>
          <tbody>${data.map((r) => `<tr><td>${esc(r.name)}</td>
            <td class="barcell"><div class="bar" style="width:${(r.month / max) * 100}%;${r.month ? '' : 'opacity:.15'}"></div></td>
            <td class="n">${r.month}</td><td class="n">${r.last}</td><td class="n">${r.total}</td></tr>`).join('')}</tbody>
        </table>` : '<p class="empty">スタッフが登録されていません。</p>'}
      </div>`;
  }

  function setMenu(open) {
    $('sidebar').classList.toggle('open', open);
    $('scrim').hidden = !open;
    $('btnMenu').setAttribute('aria-expanded', String(open));
  }

  // ---- 管理画面 ----
  // 暗証番号はそのまま書かず、元に戻せない形（SHA-256）にして比べる
  const DEFAULT_PIN_HASH = '76eab842599dadfb69a41e58ab87ebbb85effe559548541a5e390520bb0e1fa4';
  async function pinHash(pin) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sbs:${pin}`));
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  let adminOpen = false;
  try { adminOpen = sessionStorage.getItem('sbs.admin') === '1'; } catch (e) { adminOpen = false; }
  const adminSel = { colorSub: 'single', catchSeason: state.season, catchGroup: 'color', subGroup: 'color', editStaff: null };

  function renderAdmin() {
    const body = $('adminBody');
    if (!adminOpen) {
      body.innerHTML = `<h1 class="page-title">管理</h1>
        <div class="card"><h3>暗証番号を入力してください</h3>
          <p class="note">テンプレートや辞書の編集は管理者だけが行います。（デモ版の簡易的な確認です。本番では Google ログインで管理者を判定します）</p>
          <div class="actions" style="margin-top:10px"><input id="pin" class="input" type="password" inputmode="numeric" style="max-width:180px" placeholder="暗証番号">
          <button type="button" class="btn btn-primary" id="btnPin">開く</button></div></div>`;
      return;
    }
    const seasonOpts = (cur) => SEASON_IDS.map((id) => `<option value="${id}" ${cur === id ? 'selected' : ''}>${settings.seasons[id].label}</option>`).join('');
    const groupOpts = (cur, groups) => groups.map((g) => `<option value="${g}" ${cur === g ? 'selected' : ''}>${GROUP_LABELS[g]}</option>`).join('');
    const genreIds = settings.genres.map((g) => g.id);
    const colorSubs = E.findGenre(settings, 'color').subs;

    body.innerHTML = `<h1 class="page-title">管理</h1>
      <div class="card"><h3>スタッフ一覧</h3>
        ${settings.staff.map((s) => adminSel.editStaff === s.id ? `
          <div class="row">
            <input class="input" id="es-name" value="${esc(s.name)}" placeholder="表示名">
            <input class="input" id="es-store" value="${esc(s.store)}" placeholder="所属店舗">
            <div class="chips">${genreIds.filter((g) => g !== 'custom').map((g) => `<label class="chip"><input type="checkbox" data-es-genre="${g}" ${(s.genres || []).includes(g) ? 'checked' : ''}>${GROUP_LABELS[g]}</label>`).join('')}</div>
            <div class="actions"><button type="button" class="btn btn-sm btn-primary" data-staff-save="${s.id}">保存</button><button type="button" class="btn btn-sm" data-staff-cancel>やめる</button></div>
          </div>` : `
          <div class="row">
            <b>${esc(s.name)}</b><span>${esc(s.store)}</span>
            <span class="note" style="margin:0">${(s.genres || []).map((g) => GROUP_LABELS[g]).join('・') || '—'}</span>
            <div class="actions"><button type="button" class="btn btn-sm" data-staff-edit="${s.id}">編集</button><button type="button" class="btn btn-sm btn-danger" data-staff-del="${s.id}">削除</button></div>
          </div>`).join('')}
        <div class="row" style="margin-top:14px">
          <input class="input" id="ns-name" placeholder="表示名（例：スタイリストD）">
          <input class="input" id="ns-store" placeholder="所属店舗" value="池袋店">
          <span></span>
          <button type="button" class="btn btn-primary btn-sm" id="btnAddStaff">追加</button>
        </div>
        <p class="note">個人情報を減らすため、表示名はニックネームなどでもかまいません。</p>
        <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
          <b style="font-size:14px">スタッフを取り込む（ビューティーメリット・設定ファイル）</b>
          <p class="note">tools/import_beauty_merit.py で作った <code>private/staff.json</code>、配布用の設定ファイル、または1行に1名のテキスト・CSV を選びます。名前はこの端末のブラウザにだけ保存されます。</p>
          <div class="actions" style="margin-top:8px">
            <label class="btn btn-sm">ファイルを選ぶ<input type="file" id="staffFile" accept=".json,.csv,.txt" hidden></label>
            <label class="chip"><input type="checkbox" id="staffReplace" checked>今の一覧を置き換える</label>
          </div>
        </div>
      </div>

      <div class="card"><h3>カラー候補</h3>
        <div class="actions"><select class="input" style="max-width:160px" id="adColorSub">${colorSubs.map((x) => `<option value="${x.id}" ${adminSel.colorSub === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <p class="note">1行に「カラー名,#色コード,寒色か暖色,色の説明」の形で書きます。カラー名は15文字以内。</p>
        <textarea class="input" id="adColors" style="min-height:220px">${esc(colorSubs.find((x) => x.id === adminSel.colorSub).colors.map((c) => `${c.name},${c.hex},${settings.tones[c.tone]},${c.desc}`).join('\n'))}</textarea>
        <div class="actions" style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" id="btnSaveColors">保存</button></div>
      </div>

      <div class="card"><h3>キャッチコピー辞書</h3>
        <div class="actions"><select class="input" style="max-width:120px" id="adCatchSeason">${seasonOpts(adminSel.catchSeason)}</select>
          <select class="input" style="max-width:140px" id="adCatchGroup">${groupOpts(adminSel.catchGroup, ['color', 'perm', 'cut', 'straight'])}</select></div>
        <p class="note">1行に1つ。15文字以内。（カスタムはカットの辞書を使います）</p>
        <textarea class="input" id="adCatches">${esc((settings.catches[adminSel.catchSeason][adminSel.catchGroup] || []).join('\n'))}</textarea>
        <div class="actions" style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" id="btnSaveCatches">保存</button></div>
      </div>

      <div class="card"><h3>サブタイトル辞書</h3>
        <div class="actions"><select class="input" style="max-width:140px" id="adSubGroup">${groupOpts(adminSel.subGroup, ['color', 'perm', 'cut', 'straight', 'custom'])}</select></div>
        <p class="note">1行に1つ。15文字以内。</p>
        <textarea class="input" id="adSubs">${esc((settings.subtitles[adminSel.subGroup] || []).join('\n'))}</textarea>
        <div class="actions" style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" id="btnSaveSubs">保存</button></div>
      </div>

      <div class="card"><h3>共通の禁止事項</h3>
        <p class="note">1行に1つ。すべてのプロンプトに入ります。</p>
        <textarea class="input" id="adForbidden">${esc(settings.forbidden.join('\n'))}</textarea>
        <div class="actions" style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" id="btnSaveForbidden">保存</button></div>
      </div>

      <div class="card"><h3>共有画像フォルダ（Google ドライブ）</h3>
        <p class="note">Google Apps Script で公開した「配る仕組み」のURL（https://script.google.com/macros/s/…/exec）を入れます。このURLは公開のアプリには入らず、この端末にだけ保存されます。</p>
        <div class="grid2" style="margin-top:8px">
          <div class="field" style="grid-column:1/-1"><label for="adEndpoint">配る仕組みのURL</label><input class="input" id="adEndpoint" value="${esc(settings.drive.endpoint)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
          <div class="field" style="grid-column:1/-1"><label for="adFolderName">フォルダの表示名</label><input class="input" id="adFolderName" value="${esc(settings.drive.rootName)}"></div>
        </div>
        <div class="actions" style="margin-top:8px">
          <button type="button" class="btn btn-primary btn-sm" id="btnSaveDrive">保存</button>
          <button type="button" class="btn btn-sm" id="btnExportConfig">スタッフ配布用の設定ファイルを書き出す</button>
        </div>
        <p class="note">状態：${SRC.byId.gdrive.ready ? '設定済み' : '未設定'}。設定ファイルには、スタッフ一覧と配る仕組みのURLが入ります（合言葉は入りません）。LINE などで個別に渡してください。</p>
      </div>

      <div class="card"><h3>そのほか</h3>
        <div class="actions">
          <input id="newPin" class="input" type="password" inputmode="numeric" style="max-width:180px" placeholder="新しい暗証番号">
          <button type="button" class="btn btn-sm" id="btnPinChange">暗証番号を変更</button>
          <button type="button" class="btn btn-sm btn-danger" id="btnReset">辞書・スタッフを初期値に戻す</button>
          <button type="button" class="btn btn-sm" id="btnLock">管理画面を閉じる</button>
        </div>
      </div>`;
  }

  function linesOf(id) { return $(id).value.split('\n').map((x) => x.trim()).filter(Boolean); }
  function tooLong(list) { return list.filter((t) => E.charCount(t) > E.MAX_CHARS); }
  function afterSettingsChange(msg) {
    renderAll(); regen(); renderAdmin(); toast(msg);
  }

  // ---- 画面の切り替え ----
  function showView() {
    const v = (location.hash || '#create').slice(1);
    const VIEWS = ['create', 'history', 'posts', 'admin'];
    const view = VIEWS.includes(v) ? v : 'create';
    for (const id of VIEWS) $(`view-${id}`).hidden = id !== view;
    document.querySelectorAll('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    setMenu(false);
    if (view === 'history') renderHistory();
    if (view === 'posts') renderPosts();
    if (view === 'admin') renderAdmin();
    window.scrollTo(0, 0);
  }

  function renderAll() { renderSource(); renderSeasons(); renderStaff(); renderGenres(); renderColors(); }

  // ---- 操作 ----
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-pick]');
    if (!t) return;
    const d = t.dataset;
    if (d.src) { state.source = d.src; renderSource(); return; }
    if (d.pick) { state.imageId = d.pick; renderSource(); update(); return; }
    if (d.dpick) { drivePick(d.dpick); return; }
    if (d.folder) { drive.path.push({ id: d.folder, name: d.folderName }); drive.list = null; openFolder(); return; }
    if (d.crumb) { drive.path = drive.path.slice(0, Number(d.crumb) + 1); drive.list = null; openFolder(); return; }
    if (t.id === 'btnDriveIn') { driveUnlock(); return; }
    if (t.id === 'btnDriveRetry') { drive.error = ''; drive.list = null; renderDrive(); return; }
    if (t.id === 'btnDriveOut') { SRC.byId.gdrive.setPasscode(''); store.set('sbs.drivePass', ''); drive.list = null; drive.path = []; renderDrive(); toast('この端末の合言葉を消しました'); return; }
    if (d.season) { state.season = d.season; state.tone = settings.seasons[d.season].defaultTone; renderSeasons(); renderColors(); regen(); return; }
    if (d.tone) { state.tone = d.tone; renderSeasons(); renderColors(); regen(); return; }
    if (d.genre) {
      state.genreId = d.genre; state.subId = null;
      state.hairColor = E.findGenre(settings, d.genre).group === 'color' ? 'auto' : 'keep';
      renderGenres(); renderColors(); regen(); return;
    }
    if (d.sub) {
      state.subId = d.sub;
      if (E.findGenre(settings, state.genreId).group === 'color') state.hairColor = 'auto';
      renderGenres(); renderColors(); regen(); return;
    }
    if (d.color) { state.hairColor = d.color; renderColors(); regen(); return; }
    if (d.cand) { ui.selected = Number(d.cand); ui.texts = Object.assign({}, ui.cands[ui.selected]); renderCands(); renderFields(); update(); return; }

    if (t.id === 'btnMenu') { setMenu(!$('sidebar').classList.contains('open')); return; }
    if (t.id === 'btnMore') { ui.round += 1; regen(true); toast('別案を作りました'); return; }
    if (t.id === 'btnCopy') {
      const prompt = currentPrompt();
      const ok = await copyText(prompt);
      if (!ok) { toast('コピーできませんでした。「プロンプトの中身を見る」から手で選んでコピーしてください'); return; }
      addHistory(prompt);
      toast(currentImage() ? 'コピーしました。ChatGPT に写真を添付して貼り付けてください' : 'コピーしました（写真がまだ選ばれていません）');
      return;
    }
    if (t.id === 'btnDownload') {
      const img = currentImage();
      if (!img) { toast('先に 01 で写真を選んでください'); return; }
      const a = document.createElement('a'); a.href = img.url; a.download = img.name; document.body.appendChild(a); a.click(); a.remove();
      return;
    }

    // 履歴
    if (d.hCopy || d.hEdit || d.hDel) {
      const list = store.get('sbs.history', []);
      const h = list.find((x) => x.id === (d.hCopy || d.hEdit || d.hDel));
      if (!h) return;
      if (d.hCopy) { toast((await copyText(h.prompt)) ? 'コピーしました。ChatGPT に写真を添付して貼り付けてください' : 'コピーできませんでした'); return; }
      if (d.hDel) { store.set('sbs.history', list.filter((x) => x.id !== h.id)); renderHistory(); toast('削除しました'); return; }
      Object.assign(state, { season: h.season, tone: h.tone || settings.seasons[h.season].defaultTone, staffId: h.staffId, genreId: h.genreId, subId: h.subId, hairColor: h.hairColor, customLabel: h.customLabel || '', customTitle: h.customTitle || '', customNote: h.customNote || '' });
      state.imageId = h.imageId && SRC.get(h.imageId) ? h.imageId : null;
      renderAll();
      ui.cands = E.generateCandidates(settings, engineState(), 0); ui.selected = -1; ui.texts = Object.assign({}, h.texts);
      renderCands(); renderFields(); update();
      location.hash = '#create';
      toast(state.imageId ? '履歴の内容を読み込みました' : '履歴を読み込みました。写真はもう一度選んでください');
      return;
    }

    // 管理
    if (t.id === 'btnPin') {
      if ((await pinHash($('pin').value)) === store.get('sbs.pinHash', DEFAULT_PIN_HASH)) {
        adminOpen = true; try { sessionStorage.setItem('sbs.admin', '1'); } catch (err) { /* 保存できなくても開く */ }
        renderAdmin();
      } else toast('暗証番号が違います');
      return;
    }
    if (t.id === 'btnLock') { adminOpen = false; try { sessionStorage.removeItem('sbs.admin'); } catch (err) { /* noop */ } renderAdmin(); return; }
    if (t.id === 'btnAddStaff') {
      const name = $('ns-name').value.trim(), storeName = $('ns-store').value.trim();
      if (!name) { toast('表示名を入れてください'); return; }
      saveOverride((o) => { o.staff = settings.staff.concat([{ id: `st${Date.now()}`, name, store: storeName || '池袋店', genres: [] }]); });
      afterSettingsChange('スタッフを追加しました'); return;
    }
    if (d.staffEdit) { adminSel.editStaff = d.staffEdit; renderAdmin(); return; }
    if ('staffCancel' in d) { adminSel.editStaff = null; renderAdmin(); return; }
    if (d.staffSave) {
      const name = $('es-name').value.trim();
      if (!name) { toast('表示名を入れてください'); return; }
      const genres = [...document.querySelectorAll('[data-es-genre]')].filter((x) => x.checked).map((x) => x.dataset.esGenre);
      saveOverride((o) => { o.staff = settings.staff.map((s) => s.id === d.staffSave ? Object.assign({}, s, { name, store: $('es-store').value.trim() || s.store, genres }) : s); });
      adminSel.editStaff = null; afterSettingsChange('保存しました'); return;
    }
    if (d.staffDel) {
      const s = settings.staff.find((x) => x.id === d.staffDel);
      if (!s || !confirm(`${s.name} を削除しますか？`)) return;
      saveOverride((o) => { o.staff = settings.staff.filter((x) => x.id !== d.staffDel); });
      afterSettingsChange('削除しました'); return;
    }
    if (t.id === 'btnSaveColors') {
      const rows = linesOf('adColors').map((l) => l.split(',').map((x) => x.trim()));
      const toneId = (v) => Object.keys(settings.tones).find((k) => settings.tones[k] === v);
      const bad = rows.filter((r) => !r[0] || !/^#[0-9A-Fa-f]{6}$/.test(r[1] || '') || !toneId(r[2]));
      if (!rows.length || bad.length) { toast('「カラー名,#色コード,寒色か暖色,説明」の形になっていない行があります'); return; }
      const long = tooLong(rows.map((r) => r[0]));
      if (long.length) { toast(`15文字を超えています：${long[0]}`); return; }
      const sub = adminSel.colorSub;
      saveOverride((o) => { o.colors = o.colors || {}; o.colors[sub] = rows.map((r) => ({ name: r[0], hex: r[1].toUpperCase(), tone: toneId(r[2]), desc: r.slice(3).join(',') || r[0] })); });
      afterSettingsChange('カラー候補を保存しました'); return;
    }
    if (t.id === 'btnSaveCatches') {
      const list = linesOf('adCatches');
      const long = tooLong(list);
      if (!list.length) { toast('1つ以上入れてください'); return; }
      if (long.length) { toast(`15文字を超えています：${long[0]}`); return; }
      const { catchSeason: s, catchGroup: g } = adminSel;
      saveOverride((o) => { o.catches = o.catches || {}; o.catches[s] = Object.assign({}, o.catches[s], { [g]: list }); });
      afterSettingsChange('キャッチコピーを保存しました'); return;
    }
    if (t.id === 'btnSaveSubs') {
      const list = linesOf('adSubs');
      const long = tooLong(list);
      if (!list.length) { toast('1つ以上入れてください'); return; }
      if (long.length) { toast(`15文字を超えています：${long[0]}`); return; }
      const g = adminSel.subGroup;
      saveOverride((o) => { o.subtitles = Object.assign({}, o.subtitles, { [g]: list }); });
      afterSettingsChange('サブタイトルを保存しました'); return;
    }
    if (t.id === 'btnSaveDrive') {
      const endpoint = $('adEndpoint').value.trim();
      if (endpoint && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint)) { toast('URLの形が違います（https://script.google.com/macros/s/…/exec）'); return; }
      saveOverride((o) => { o.drive = { endpoint, rootName: $('adFolderName').value.trim() || '共有フォルダ' }; });
      drive.list = null; drive.path = [];
      afterSettingsChange('共有フォルダの設定を保存しました'); return;
    }
    if (t.id === 'btnExportConfig') {
      const data = { app: 'salon-blog-studio', staff: settings.staff, drive: settings.drive };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'salon-blog-studio-設定.json';
      document.body.appendChild(a); a.click(); a.remove();
      toast('設定ファイルを書き出しました'); return;
    }
    if (t.id === 'btnSaveForbidden') {
      const list = linesOf('adForbidden');
      if (!list.length) { toast('1つ以上入れてください'); return; }
      saveOverride((o) => { o.forbidden = list; });
      afterSettingsChange('禁止事項を保存しました'); return;
    }
    if (t.id === 'btnPinChange') {
      const v = $('newPin').value.trim();
      if (v.length < 4) { toast('4文字以上にしてください'); return; }
      store.set('sbs.pinHash', await pinHash(v)); $('newPin').value = ''; toast('この端末の暗証番号を変更しました'); return;
    }
    if (t.id === 'btnReset') {
      if (!confirm('辞書・カラー候補・禁止事項・スタッフを初期値に戻しますか？（履歴は残ります）')) return;
      store.set('sbs.settings', {}); settings = loadSettings();
      afterSettingsChange('初期値に戻しました'); return;
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.field) { ui.texts[t.dataset.field] = t.value; ui.selected = -1; updateCounts(); renderCands(); update(); return; }
    if (t.dataset.custom) {
      state[t.dataset.custom] = t.value;
      ui.cands = E.generateCandidates(settings, engineState(), ui.round);
      if (t.dataset.custom === 'customLabel') { ui.texts.category = E.categoryText(settings, state); $('f-category').value = ui.texts.category; }
      if (t.dataset.custom === 'customTitle') { ui.texts.title = state.customTitle || 'メンズスタイル'; $('f-title').value = ui.texts.title; updateCounts(); }
      renderCands(); update(); return;
    }
    if (t.dataset.crop) {
      const img = currentImage(); if (!img) return;
      const c = ui.crops[img.id] || (ui.crops[img.id] = { x: 50, y: 50, z: 100 });
      c[t.dataset.crop] = Number(t.value);
      const el = $('preview').querySelector('.pv-photo img');
      if (el) { el.style.objectPosition = `${c.x}% ${c.y}%`; el.style.transform = `scale(${c.z / 100})`; el.style.transformOrigin = `${c.x}% ${c.y}%`; }
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'staffSelect') { state.staffId = t.value; update(); return; }
    if (t.id === 'configFile' && t.files[0]) { importStaff(t.files[0], true); t.value = ''; return; }
    if (t.id === 'staffFile' && t.files[0]) { importStaff(t.files[0], $('staffReplace').checked); t.value = ''; return; }
    if (t.id === 'adColorSub') { adminSel.colorSub = t.value; renderAdmin(); return; }
    if (t.id === 'adCatchSeason') { adminSel.catchSeason = t.value; renderAdmin(); return; }
    if (t.id === 'adCatchGroup') { adminSel.catchGroup = t.value; renderAdmin(); return; }
    if (t.id === 'adSubGroup') { adminSel.subGroup = t.value; renderAdmin(); return; }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'pin') $('btnPin').click();
    if (e.key === 'Enter' && e.target.id === 'drivePass') $('btnDriveIn').click();
  });

  // スタッフの取り込み（JSON: {staff:[{name}]} か [{name}] か ["名前"]／テキスト・CSV: 1行目の列を名前とする）
  // 人ではないもの（見出し・合計行・お店の共通アカウント）は取り込まない
  const STAFF_EXCLUDE = ['合計', 'スタッフ', 'AI TOKYO STYLE'];
  function parseStaffFile(text, filename) {
    let names = [];
    if (/\.json$/i.test(filename)) {
      const d = JSON.parse(text);
      const list = Array.isArray(d) ? d : d.staff || [];
      names = list.map((x) => (typeof x === 'string' ? x : x && x.name));
    } else {
      names = text.split(/\r?\n/).map((l) => l.split(',')[0].replace(/^"|"$/g, ''));
    }
    return [...new Set(names.map((n) => String(n || '').trim()).filter((n) => n && !STAFF_EXCLUDE.includes(n)))];
  }
  // 「山田 太郎【池袋】」→ 名前「山田 太郎」・店舗「池袋店」
  function splitStore(raw, fallback) {
    const m = raw.match(/\s*[【\[［](.+?)[】\]］]\s*$/);
    if (!m) return { name: raw.trim(), store: fallback };
    const store = m[1].trim();
    return { name: raw.slice(0, m.index).trim(), store: /店$/.test(store) ? store : `${store}店` };
  }
  function importStaff(file, replace) {
    const reader = new FileReader();
    reader.onload = () => {
      let names;
      try { names = parseStaffFile(String(reader.result), file.name); } catch (e) { toast('ファイルを読み込めませんでした（形式を確認してください）'); return; }
      if (!names.length) { toast('スタッフ名が見つかりませんでした'); return; }
      const base = replace ? [] : settings.staff.slice();
      let added = 0;
      const stores = {};
      if (/\.json$/i.test(file.name)) {
        try { const d = JSON.parse(String(reader.result)); (Array.isArray(d) ? d : d.staff || []).forEach((x) => { if (x && x.name && x.store) stores[x.name] = x.store; }); } catch (e) { /* 店舗名なしで続ける */ }
      }
      names.forEach((raw, i) => {
        const { name, store } = splitStore(raw, stores[raw] || '池袋店');
        if (!name || base.some((s) => s.name === name)) return;
        base.push({ id: `st${Date.now()}_${i}`, name, store, genres: [] });
        added += 1;
      });
      // 配布用の設定ファイルなら、共有フォルダの設定も一緒に取り込む
      let driveCfg = null;
      if (/\.json$/i.test(file.name)) {
        try { const d = JSON.parse(String(reader.result)); if (d && d.drive && d.drive.endpoint) driveCfg = { endpoint: String(d.drive.endpoint), rootName: String(d.drive.rootName || '共有フォルダ') }; } catch (e) { driveCfg = null; }
      }
      saveOverride((o) => { o.staff = base; if (driveCfg) o.drive = driveCfg; });
      drive.list = null; drive.path = [];
      afterSettingsChange(`${added}名を取り込みました${driveCfg ? '（共有フォルダの設定も読み込みました）' : ''}`);
    };
    reader.onerror = () => toast('ファイルを読み込めませんでした');
    reader.readAsText(file, 'utf-8');
  }

  document.addEventListener('click', (e) => { if (e.target.id === 'scrim') setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  window.addEventListener('hashchange', showView);

  // ---- 起動 ----
  renderAll();
  regen();
  showView();
})();
