// 実行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/data.js');
const E = require('../js/engine.js');

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const TONES = ['cool', 'warm'];
const base = { season: 'autumn', tone: 'warm', staffId: 'bm1', genreId: 'color', subId: null, hairColor: 'auto', image: { id: 'local:test.jpg' } };
const colorSubs = D.genres.find((g) => g.id === 'color').subs;

test('辞書の文章とタイトルはすべて15文字以内', () => {
  const all = [];
  for (const s of SEASONS) for (const list of Object.values(D.catches[s])) all.push(...list);
  for (const list of [...Object.values(D.subtitles), ...Object.values(D.toneCatches), ...Object.values(D.toneSubtitles)]) all.push(...list);
  for (const sub of colorSubs) all.push(...sub.colors.map((c) => c.name));
  for (const g of D.genres) {
    all.push(...(g.titles || []));
    for (const sub of g.subs || []) all.push(...(sub.titles || []), ...(sub.extraSubtitles || []));
  }
  assert.deepEqual(all.filter((t) => E.charCount(t) > E.MAX_CHARS), []);
});

test('配色：寒色・暖色どちらも、文字と背景のコントラスト比が4.5以上', () => {
  for (const s of SEASONS) for (const tone of TONES) {
    const p = D.seasons[s].palettes[tone];
    assert.ok(p, `${s}/${tone}`);
    for (const [fg, bg] of [[p.title, p.bg], [p.title, p.bgSub], [p.text, p.bg], [p.text, p.bgSub], [p.bandText, p.band]]) {
      const r = E.contrastRatio(fg, bg);
      assert.ok(r >= 4.5, `${s}/${tone}: ${fg} on ${bg} = ${r.toFixed(2)}`);
    }
  }
});

test('候補は3つ作られ、キャッチとサブタイトルが重ならない（全季節・全テイスト・全ジャンル）', () => {
  for (const s of SEASONS) for (const tone of TONES) for (const g of D.genres) {
    for (const subId of g.subs ? g.subs.map((x) => x.id) : [null]) {
      const c = E.generateCandidates(D, { ...base, season: s, tone, genreId: g.id, subId }, 0);
      const where = `${s}/${tone}/${g.id}/${subId}`;
      assert.equal(c.length, 3);
      assert.equal(new Set(c.map((x) => x.catch)).size, 3, where);
      assert.equal(new Set(c.map((x) => x.subtitle)).size, 3, where);
      assert.ok(c.every((x) => x.category.startsWith('池袋 ') && x.title), where);
    }
  }
});

test('「別案を生成」で結果が変わる／同じ番号なら同じ結果', () => {
  const a = E.generateCandidates(D, base, 0);
  assert.deepEqual(E.generateCandidates(D, base, 0), a);
  assert.ok([1, 2, 3, 4].some((r) => JSON.stringify(E.generateCandidates(D, base, r)) !== JSON.stringify(a)));
});

test('季節とテイスト：春秋は暖色・夏冬は寒色が初期値。テイストで髪色・配色・言葉が変わる', () => {
  assert.deepEqual(SEASONS.map((s) => D.seasons[s].defaultTone), ['warm', 'cool', 'warm', 'cool']);
  for (const s of SEASONS) for (const tone of TONES) {
    const st = { ...base, season: s, tone };
    const c = E.generateCandidates(D, st, 0);
    const okCatch = [...D.catches[s].color, ...D.toneCatches[tone]];
    assert.ok(c.every((x) => okCatch.includes(x.catch)), `${s}/${tone}`);
    assert.ok(c.every((x) => E.findHairColor(D, x.title).tone === tone), `${s}/${tone}`);
    assert.equal(E.paletteOf(D, st), D.seasons[s].palettes[tone]);
    const p = E.buildPrompt(D, st, c[0], null);
    assert.ok(p.includes(D.seasons[s].background[tone]) && p.includes(D.toneStyles[tone]) && p.includes(D.seasons[s].palettes[tone].title));
  }
});

test('カラーは「カラー・ダブルカラー・ハイライト」の3種類で、それぞれの色名が出る', () => {
  assert.deepEqual(colorSubs.map((x) => x.label), ['カラー', 'ダブルカラー', 'ハイライト']);
  const single = colorSubs[0].colors.map((c) => c.name);
  for (const n of ['アッシュブラウン', 'マットブラウン', 'ピンクブラウン', 'レッドブラウン']) assert.ok(single.includes(n), n);
  const dbl = colorSubs[1].colors.map((c) => c.name);
  for (const n of ['ミルクティーベージュ', 'グレージュ', 'シルバーグレー', 'カーキアッシュ', 'ピンクベージュ']) assert.ok(dbl.includes(n), n);
  for (const sub of colorSubs) {
    for (const tone of TONES) assert.ok(sub.colors.some((c) => c.tone === tone), `${sub.id}/${tone}`);
    const c = E.generateCandidates(D, { ...base, subId: sub.id }, 0);
    assert.ok(c.every((x) => sub.colors.some((k) => k.name === x.title)), sub.id);
    assert.equal(c[0].category, `池袋 ${sub.category}`);
  }
});

test('カラーで髪色を指定するとタイトルはその色名になる', () => {
  const c = E.generateCandidates(D, { ...base, hairColor: 'モカブラウン' }, 0);
  assert.ok(c.every((x) => x.title === 'モカブラウン'));
});

test('パーマ・縮毛矯正はカラー名ではなく種類に合ったスタイル名になる', () => {
  const perm = D.genres.find((g) => g.id === 'perm');
  for (const sub of perm.subs) {
    const c = E.generateCandidates(D, { ...base, genreId: 'perm', subId: sub.id }, 0);
    assert.ok(c.every((x) => sub.titles.includes(x.title)), sub.id);
  }
  assert.deepEqual(perm.subs.map((s) => s.label), ['波巻きパーマ', 'ツイストスパイラル', 'シャドウパーマ', 'ニュアンスパーマ']);
  assert.deepEqual(D.genres.find((g) => g.id === 'straight').subs.map((s) => s.label), ['縮毛矯正', '曲がる縮毛矯正']);
});

test('プロンプトに必要な情報がすべて入る', () => {
  const texts = { category: '池袋 メンズカラー', catch: '秋の抜け感をつくる', title: 'モカブラウン', subtitle: '大人の余裕をまとうカラー' };
  const p = E.buildPrompt(D, base, texts, D.staff[0]);
  for (const must of [
    'このプロンプトと一緒に添付した人物写真を参照画像として使用してください。',
    '4:3', '1200×900', '45%', '55%',
    '「池袋」', '「メンズカラー」', texts.catch, texts.title, texts.subtitle,
    D.seasons.autumn.palettes.warm.title, D.seasons.autumn.palettes.warm.accent,
    '髪色だけを、「モカブラウン」', '顔には絶対に重ねない', D.forbidden[0], D.staff[0].name, 'テイスト：暖色'
  ]) assert.ok(p.includes(must), `missing: ${must}`);
});

test('ダブルカラー・ハイライトのプロンプトは、それぞれの施術の指示になる', () => {
  const t = (title) => ({ category: 'x', catch: 'a', title, subtitle: 'b' });
  const pd = E.buildPrompt(D, { ...base, subId: 'double', tone: 'cool', hairColor: 'シルバーグレー' }, t('シルバーグレー'), null);
  assert.ok(pd.includes('ブリーチ') && pd.includes('「シルバーグレー」'));
  const ph = E.buildPrompt(D, { ...base, subId: 'highlight', tone: 'cool' }, t('アッシュハイライト'), null);
  assert.ok(ph.includes('ベースの髪色') && ph.includes('「アッシュハイライト」') && !ph.includes('髪色だけを'));
});

test('パーマのプロンプトは髪色を変えず、パーマの質感を指示する', () => {
  const texts = { category: '池袋 メンズパーマ', catch: 'a', title: '波巻きパーマ', subtitle: 'b' };
  const p = E.buildPrompt(D, { ...base, genreId: 'perm', subId: 'nami', hairColor: 'keep' }, texts, null);
  assert.ok(p.includes('髪色は添付写真のまま'));
  assert.ok(p.includes('波巻きパーマ'));
  assert.ok(!p.includes('髪色だけを'));
});

test('入力の確認：長すぎる文字・髪色の不一致・写真なしを知らせる', () => {
  const w = E.validate(D, { ...base, hairColor: 'モカブラウン', image: null },
    { catch: 'あ'.repeat(16), title: 'カフェブラウン', subtitle: 'ok' });
  assert.ok(w.some((x) => x.includes('16文字')));
  assert.ok(w.some((x) => x.includes('一致していません')));
  assert.ok(w.some((x) => x.includes('写真')));
});

test('スタイルのタブに6種類があり、それぞれのスタイル名と指示になる', () => {
  const st = D.genres.find((g) => g.id === 'style');
  assert.deepEqual(st.subs.map((x) => x.label), ['マッシュ', 'センターパート', 'アップバング', '束感マッシュ', 'ショートマッシュ', 'スパイキーショート']);
  assert.ok(st.subs[1].titles.includes('毛流れセンターパート') && st.subs[1].titles.includes('ツイストセンターパート') && st.subs[1].titles.includes('波巻きセンターパート'));
  for (const sub of st.subs) {
    const c = E.generateCandidates(D, { ...base, genreId: 'style', subId: sub.id, hairColor: 'keep' }, 0);
    assert.ok(c.every((x) => sub.titles.includes(x.title)), sub.id);
    assert.equal(c[0].category, `池袋 ${sub.category}`);
    const p = E.buildPrompt(D, { ...base, genreId: 'style', subId: sub.id, hairColor: 'keep' }, c[0], null);
    assert.ok(p.includes(`スタイル「${sub.label}」`) && p.includes(sub.desc) && p.includes('髪色は添付写真のまま'), sub.id);
  }
});

test('ブログ用プロンプト：テーマ・ルール・店舗情報（一字一句）が入る', () => {
  const texts = { category: '池袋 メンズパーマ', catch: '秋めく柔らかな毛流れ', title: '波巻きパーマ', subtitle: '束感でつくる大人の色気' };
  const p = E.buildBlogPrompt(D, { ...base, genreId: 'perm', subId: 'nami', hairColor: 'keep', tone: 'cool' }, texts, D.staff[0]);
  for (const must of [texts.title, texts.catch, texts.subtitle, '秋', D.toneStyles.cool, '1文ごとに改行', '絵文字', '「、」と「。」だけ', D.shopFooter, '平平'.slice(0, 0)]) assert.ok(p.includes(must), must);
  assert.ok(p.trim().endsWith('----- 店舗情報ここまで -----'));
  assert.ok(D.shopFooter.startsWith("AI TOKYO men's 池袋店") && D.shopFooter.endsWith('学割クーポン］'));
});

test('ブログ本文の確認と整え：記号・絵文字を消し、1文ごとに改行し、店舗情報を最後に正しく付ける', () => {
  const raw = '秋のモカブラウン特集！\n\nモカブラウンの季節です！秋らしい色ですね😊\n「やわらかい」印象に♪ なります。\n\n\n\nぜひ。\nAI TOKYO men\'s 池袋店\nまちがった店舗情報';
  const problems = E.checkBlogText(raw, D.shopFooter);
  assert.ok(problems.some((x) => x.includes('記号')) && problems.some((x) => x.includes('2つ以上')) && problems.some((x) => x.includes('店舗情報')));
  const fixed = E.cleanBlogText(raw, D.shopFooter);
  assert.deepEqual(E.checkBlogText(fixed, D.shopFooter), []);
  assert.ok(fixed.endsWith(D.shopFooter));
  const body = fixed.slice(0, fixed.length - D.shopFooter.length).trim().split('\n');
  assert.deepEqual(body, ['秋のモカブラウン特集', '', 'モカブラウンの季節です。', '秋らしい色ですね。', 'やわらかい印象に なります。', '', 'ぜひ。']);
});

test('画像の文字デザイン：タイトルは2行、カテゴリーは2つの箱、サブタイトルの最後の言葉を強調', () => {
  assert.deepEqual(E.titleLines('ミルクブラウン'), ['ミルク', 'ブラウン']);
  assert.deepEqual(E.titleLines('グレージュ'), ['グレージュ']);
  assert.deepEqual(E.subtitleParts('大人のモテカラー'), { before: '大人の', accent: 'モテカラー' });
  assert.deepEqual(E.subtitleParts('朝のセットを手軽に'), { before: '朝のセットを手軽に', accent: '' });
  assert.deepEqual(E.categoryParts('池袋 メンズカラー'), { area: '池袋', label: 'メンズカラー' });
  const texts = { category: '池袋 メンズカラー', catch: '秋の抜け感をつくる', title: 'ミルクブラウン', subtitle: '大人のモテカラー' };
  const p = E.buildPrompt(D, { ...base, hairColor: 'ミルクブラウン' }, texts, null);
  for (const must of ['1枚の写真として画面全体を自然につなげる', '約55%', '約45%', '「池袋」', '「メンズカラー」', '1行目「ミルク」、2行目「ブラウン」', '季節の字「秋」', '「モテカラー」だけアクセント色', '細い横線を2本', D.seasons.autumn.backdrops[0].decor, D.seasons.autumn.backdrops[0].scene]) assert.ok(p.includes(must), must);
});

test('人物の後ろの背景に、季節の景色の指示が入る（4季節とも）', () => {
  const texts = { category: '池袋 メンズカラー', catch: 'a', title: 'b', subtitle: 'c' };
  for (const s of SEASONS) {
    const p = E.buildPrompt(D, { ...base, season: s }, texts, null);
    assert.ok(p.includes('人物の後ろ（左側）の背景：' + D.seasons[s].backdrops[0].scene), s);
    assert.ok(p.includes(`ひと目で${D.seasons[s].label}だと分かる景色`), s);
    assert.ok(p.includes('時間帯は昼') && D.seasons[s].light.includes('昼'), s);
    assert.ok(!/夕方|夜|街の灯り|イルミネーション|夕日/.test(D.seasons[s].backdrops.map((b) => b.scene + b.decor).join('') + D.seasons[s].light), s);
  }
});

test('投稿者の初期一覧は10名', () => {
  assert.equal(D.staff.length, 10);
  assert.ok(D.staff.every((x) => x.id && x.name && x.store === '池袋店'));
});

test('ブログ本文はコンパクト（350〜450文字・15〜20文）で、構成が6つ', () => {
  const texts = { category: '池袋 メンズカラー', catch: 'a', title: 'ミルクブラウン', subtitle: 'b' };
  const p = E.buildBlogPrompt(D, base, texts, null);
  assert.ok(p.includes('350〜450文字') && p.includes('15〜20文') && p.includes('40文字以内'));
  assert.ok(p.includes('おすすめのポイントを3つ') && p.includes('押しつけない、来店のお誘い'));
  assert.ok(!p.includes('600〜900'));
});

test('ブログのタイトル案：全部の組み合わせで「池袋」入り・25文字以内・句読点や記号なし', () => {
  for (const s of SEASONS) for (const g of D.genres) {
    for (const subId of g.subs ? g.subs.map((x) => x.id) : [null]) {
      const st = { ...base, season: s, genreId: g.id, subId };
      for (const title of E.titleCandidates(D, st)) {
        for (const r of [0, 1, 2]) {
          const c = E.blogTitleCandidates(D, st, { title }, r);
          assert.ok(c.length >= 1, `${s}/${g.id}/${subId}/${title}`);
          for (const t of c) assert.deepEqual(E.checkBlogTitle(D, t), [], `${t}`);
        }
      }
    }
  }
});

test('ブログのタイトルの確認：池袋なし・26文字以上・句読点や記号ありを知らせる', () => {
  assert.ok(E.checkBlogTitle(D, '秋のミルクブラウン').some((x) => x.includes('池袋')));
  assert.ok(E.checkBlogTitle(D, '池袋' + 'あ'.repeat(24)).some((x) => x.includes('26文字')));
  assert.ok(E.checkBlogTitle(D, '池袋、秋のミルクブラウン！').some((x) => x.includes('記号')));
  assert.ok(E.checkBlogTitle(D, '池袋 秋').some((x) => x.includes('空白')));
  assert.deepEqual(E.checkBlogTitle(D, '池袋で叶える秋のミルクブラウン'), []);
});

test('ブログ用プロンプトは、選んだタイトルを1行目にそのまま使う。本文の確認は1行目のタイトルも見る', () => {
  const texts = { category: '池袋 メンズカラー', catch: 'a', title: 'ミルクブラウン', subtitle: 'b' };
  const p = E.buildBlogPrompt(D, base, texts, null, '池袋で叶える秋のミルクブラウン');
  assert.ok(p.includes('ブログのタイトル「池袋で叶える秋のミルクブラウン」を一字一句このまま'));
  const bad = '池袋、秋のミルクブラウン！\n\n本文です。\n\n' + D.shopFooter;
  assert.ok(E.checkBlogText(bad, D.shopFooter, D).some((x) => x.startsWith('1行目のタイトルに句読点')));
  const fixed = E.cleanBlogText(bad, D.shopFooter);
  assert.equal(fixed.split('\n')[0], '池袋秋のミルクブラウン');
  assert.deepEqual(E.checkBlogText(fixed, D.shopFooter, D), []);
});

test('ブログのタイトル案は「池袋」の位置がばらける（「池袋で」始まりは3つのうち1つまで）', () => {
  for (const g of D.genres) for (const subId of g.subs ? g.subs.map((x) => x.id) : [null]) {
    const st = { ...base, genreId: g.id, subId };
    const title = E.titleCandidates(D, st)[0];
    for (const r of [0, 1, 2, 3]) {
      const c = E.blogTitleCandidates(D, st, { title }, r);
      assert.equal(c.length, 3, c.join('/'));
      assert.ok(c.filter((t) => t.startsWith('池袋で')).length <= 1, c.join('/'));
      assert.ok(c.some((t) => !t.startsWith('池袋')), c.join('/'));
      assert.ok(c.every((t) => !t.includes('人気')), c.join('/'));
      assert.equal(new Set(c.map((t) => t.slice(-3))).size, 3, `終わり方が重なっている：${c.join('/')}`);
    }
  }
});

test('背景のテイスト：各季節に5種類（暖かめ・鮮やか・クール・爽やか を含む）。選んだ背景がプロンプトに入る', () => {
  const texts = { category: '池袋 メンズカラー', catch: 'a', title: 'b', subtitle: 'c' };
  for (const s of SEASONS) {
    const list = D.seasons[s].backdrops;
    assert.equal(list.length, 5, s);
    for (const label of ['暖かめ', '鮮やか', 'クール', '爽やか']) assert.ok(list.some((b) => b.label === label), `${s}/${label}`);
    assert.equal(new Set(list.map((b) => b.scene)).size, 5, s);
    for (const b of list) {
      const p = E.buildPrompt(D, { ...base, season: s, backdrop: b.id }, texts, null);
      assert.ok(p.includes(b.scene) && p.includes(b.decor) && p.includes(`背景のテイスト：${b.label}`), `${s}/${b.id}`);
    }
    // 見つからない id のときは1つ目
    assert.equal(E.findBackdrop(D, { season: s, backdrop: 'none' }), list[0]);
  }
  assert.ok(!D.seasons.autumn.backdrops.slice(1).some((b) => /紅葉|楓|もみじ/.test(b.scene)), '秋の紅葉以外の背景に紅葉が入っている');
});
