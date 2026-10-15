/*
 * SALON BLOG STUDIO — 文章候補とプロンプトを組み立てる処理
 * 画面（app.js）には依存しない純粋な関数だけを置き、tests/ から検査できるようにしています。
 */
(function (root) {
  const MAX_CHARS = 15;

  // 文字数（絵文字なども1文字として数える）
  function charCount(s) { return [...String(s || '')].length; }

  // 同じ条件・同じ番号なら同じ結果になる乱数（「別案」は番号を変えて作る）
  function hashStr(s) {
    let h = 2166136261;
    for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const uniq = (list) => [...new Set(list.filter(Boolean))];

  function findGenre(settings, genreId) {
    return settings.genres.find((g) => g.id === genreId) || settings.genres[0];
  }
  function findSub(genre, subId) {
    if (!genre.subs) return null;
    return genre.subs.find((s) => s.id === subId) || genre.subs[0];
  }
  const isNamedColor = (v) => v && v !== 'auto' && v !== 'keep';
  function colorGenre(settings) { return settings.genres.find((g) => g.id === 'color'); }
  // その条件で選べる髪色（カラー系は種類ごと、それ以外はカラーの色）をテイストで絞る
  function colorsFor(settings, state) {
    const g = findGenre(settings, state.genreId);
    const cg = colorGenre(settings);
    const sub = g.group === 'color' ? findSub(g, state.subId) : cg.subs[0];
    return sub.colors.filter((c) => !state.tone || c.tone === state.tone);
  }
  function findHairColor(settings, name) {
    for (const sub of colorGenre(settings).subs) {
      const c = sub.colors.find((x) => x.name === name);
      if (c) return c;
    }
    return null;
  }
  function paletteOf(settings, state) {
    const s = settings.seasons[state.season];
    return s.palettes[state.tone] || s.palettes[s.defaultTone];
  }

  // カテゴリー表示（例：池袋 メンズカラー）
  function categoryText(settings, state) {
    const g = findGenre(settings, state.genreId);
    const sub = findSub(g, state.subId);
    const label = g.id === 'custom' ? (state.customLabel || 'メンズヘア') : (sub && sub.category) || g.label;
    return `${settings.area} ${label}`;
  }

  // メインタイトルの候補
  function titleCandidates(settings, state) {
    const g = findGenre(settings, state.genreId);
    if (g.group === 'color') {
      if (isNamedColor(state.hairColor)) return [state.hairColor];
      return colorsFor(settings, state).map((c) => c.name);
    }
    if (g.group === 'custom') return [state.customTitle || 'メンズスタイル'];
    const sub = findSub(g, state.subId);
    return (sub ? sub.titles : g.titles) || [g.label];
  }

  function dictGroup(g) { return g.group === 'custom' ? 'cut' : g.group; }

  // 3つの候補（カテゴリー・キャッチ・メインタイトル・サブタイトル）を作る
  function generateCandidates(settings, state, round, count) {
    count = count || 3;
    const g = findGenre(settings, state.genreId);
    const sub = findSub(g, state.subId);
    const key = [state.season, state.tone || '', g.id, sub ? sub.id : '', state.hairColor || '', round || 0].join('|');
    const rand = rng(hashStr(key));

    const toneC = (settings.toneCatches && settings.toneCatches[state.tone]) || [];
    const toneS = (settings.toneSubtitles && settings.toneSubtitles[state.tone]) || [];
    const catches = shuffled(uniq([...(settings.catches[state.season][dictGroup(g)] || []), ...toneC]), rand);
    const subs = shuffled(uniq([...(settings.subtitles[g.group] || []), ...((sub && sub.extraSubtitles) || []), ...toneS]), rand);
    const titles = shuffled(uniq(titleCandidates(settings, state)), rand);
    const category = categoryText(settings, state);

    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({
        category,
        catch: catches[i % catches.length] || '',
        title: titles[i % titles.length] || '',
        subtitle: subs[i % subs.length] || ''
      });
    }
    return out;
  }

  // 入力内容の確認（画面に注意として出す）
  function validate(settings, state, texts) {
    const warnings = [];
    const labels = { catch: 'キャッチコピー', title: 'メインタイトル', subtitle: 'サブタイトル' };
    for (const k of Object.keys(labels)) {
      const n = charCount(texts[k]);
      if (n === 0) warnings.push(`${labels[k]}が空です`);
      else if (n > MAX_CHARS) warnings.push(`${labels[k]}が${n}文字です（15文字以内がおすすめ）`);
    }
    const g = findGenre(settings, state.genreId);
    if (g.group === 'color' && isNamedColor(state.hairColor) && texts.title !== state.hairColor) {
      warnings.push(`メインタイトル「${texts.title}」と選んだ髪色「${state.hairColor}」が一致していません`);
    }
    if (!state.image) warnings.push('写真がまだ選ばれていません');
    if (!state.staffId) warnings.push('投稿者がまだ選ばれていません');
    return warnings;
  }

  // 髪についての指示
  function hairInstruction(settings, state, texts) {
    const g = findGenre(settings, state.genreId);
    const lines = [];
    if (g.id === 'style') lines.push('・添付写真の髪の長さと質感を生かしながら、下のスタイルの特徴がはっきり伝わるように整えてください。');
    else lines.push('・添付写真の髪型、長さ、毛流れ、分け目はそのまま維持してください。');

    let colorName = null;
    if (g.group === 'color') colorName = isNamedColor(state.hairColor) ? state.hairColor : texts.title;
    else if (isNamedColor(state.hairColor)) colorName = state.hairColor;
    const c = colorName ? findHairColor(settings, colorName) : null;
    const hint = c ? `（${c.desc}。色の目安 ${c.hex}）` : '';
    const sub = g.group === 'color' ? findSub(g, state.subId) : null;

    if (sub && sub.id === 'highlight') {
      lines.push('・ベースの髪色は添付写真のまま、または少し暗めの自然な色にしてください。');
      lines.push(`・そこに「${colorName}」を入れてください${hint}。${sub.desc}。`);
      lines.push('・ハイライトは太すぎず、ムラや不自然な縞模様に見えないようにしてください。');
    } else if (colorName) {
      const how = sub && sub.id === 'double' ? `${sub.desc}として、` : '';
      lines.push(`・髪色だけを、${how}「${colorName}」に自然に変更してください。${hint}`);
      lines.push('・根元から毛先まで自然になじませ、光が当たる部分は少し明るく、影の部分は少し深く見せてください。');
    } else {
      lines.push('・髪色は添付写真のまま変更しないでください。');
    }

    if (g.group === 'perm' || g.group === 'straight') {
      const sub = findSub(g, state.subId);
      lines.push(`・施術「${sub.label}」の仕上がりが伝わるようにしてください：${sub.desc}。`);
    } else if (g.group === 'cut') {
      const st = findSub(g, state.subId);
      if (st) lines.push(`・スタイル「${st.label}」の特徴が伝わるようにしてください：${st.desc}。`);
      else lines.push(`・施術「メンズカット」の仕上がりが伝わるようにしてください：${g.desc}。`);
    } else if (g.group === 'custom' && state.customNote) {
      lines.push(`・施術の補足：${state.customNote}`);
    }
    lines.push('・髪の一本一本、束感、艶が分かる高精細な描写にしてください。');
    return lines.join('\n');
  }

  // ChatGPT に貼り付ける完成プロンプト
  function buildPrompt(settings, state, texts, staff) {
    const season = settings.seasons[state.season];
    const p = paletteOf(settings, state);
    const g = findGenre(settings, state.genreId);
    const sub = findSub(g, state.subId);
    const genreName = g.id === 'custom' ? (state.customLabel || 'カスタム') : (sub ? `${g.label}（${sub.label}）` : g.label);

    return [
      '# 美容室ブログ用アイキャッチ画像の作成依頼',
      '',
      'このプロンプトと一緒に添付した人物写真を参照画像として使用してください。',
      'ホットペッパービューティーのブログに掲載する、上品なファッション誌風のアイキャッチ画像を1枚作成してください。',
      '',
      '## 1. 画像の仕様',
      '・横長 4:3（目標 1200×900px）。',
      '・左側 約45% に人物、右側 約55% に文字を配置する、余白を生かした構図。',
      '・人物は顔を大きく配置し、髪の質感がはっきり分かる高精細な写真にしてください。',
      '・右側の文字エリアには細い罫線をあしらい、落ち着いた雑誌の誌面のように整えてください。',
      '',
      '## 2. 人物について（いちばん大切）',
      '・添付写真の人物の顔立ち、輪郭、目元、鼻、口、眼鏡、アクセサリーは、できる限りそのまま維持してください。',
      '・別人に見えないようにしてください。表情も自然なままにしてください。',
      `・服装は季節に合わせて変更してかまいません：${season.clothing}。`,
      '',
      '## 3. 髪について',
      hairInstruction(settings, state, texts),
      '',
      `## 4. 季節の演出（${season.label}）`,
      `・背景：${season.background[state.tone] || season.background[season.defaultTone]}。`,
      `・光：${season.light}。`,
      `・装飾：${season.decor}。`,
      '・季節感は上品に、控えめに表現してください。',
      `・全体の色のテイスト：${settings.toneStyles[state.tone] || ''}。`,
      '',
      '## 5. 画像に入れる文字（一字一句この通りに）',
      `・カテゴリー帯（小さく、右側上部）：「${texts.category}」`,
      `・キャッチコピー（小さめ）：「${texts.catch}」`,
      `・メインタイトル（いちばん大きく）：「${texts.title}」`,
      `・サブタイトル（タイトルの下）：「${texts.subtitle}」`,
      '・上の4つ以外の文字は入れないでください。',
      '・日本語の文字は、誤字・脱字・崩れた文字がないよう正確に描いてください。',
      '・文字はすべて右側の文字エリアに置き、人物の顔には絶対に重ねないでください。',
      '',
      '## 6. 配色（HEXコード）',
      `・背景：${p.bg} → ${p.bgSub} のやわらかなグラデーション`,
      `・メインタイトルの文字色：${p.title}`,
      `・キャッチコピー・サブタイトルの文字色：${p.text}`,
      `・アクセントライン（細い罫線）：${p.accent}`,
      `・カテゴリー帯：背景 ${p.band}、文字 ${p.bandText}`,
      '・髪色とデザインの色に統一感を持たせてください。',
      '',
      '## 7. 禁止事項',
      ...settings.forbidden.map((f) => `・${f}`),
      '',
      '## 8. 仕上がりの品質',
      '・プロのカメラマンが撮影したような、ピントの合った高精細な写真の質感。',
      '・自然な肌の質感と、柔らかな自然光。',
      '・全体として、清潔感と高級感のある美容室らしい雰囲気。',
      '',
      '---',
      '（管理用メモ・画像には入れないでください）',
      `施術ジャンル：${genreName}／季節：${season.label}／テイスト：${settings.tones[state.tone] || ''}／投稿者：${staff ? staff.name : '未選択'}`
    ].join('\n');
  }

  // ---- ブログ本文 ----
  // 施術・髪色の説明（ブログのテーマ用）
  function themeLines(settings, state, texts) {
    const g = findGenre(settings, state.genreId);
    const sub = findSub(g, state.subId);
    const lines = [];
    const genreName = g.id === 'custom' ? (state.customLabel || 'カスタム') : (sub ? `${g.label}（${sub.label}）` : g.label);
    lines.push(`・施術ジャンル：${genreName}`);
    if (sub && sub.desc) lines.push(`・施術・スタイルの特徴：${sub.desc}`);
    else if (g.desc) lines.push(`・施術の特徴：${g.desc}`);
    if (g.id === 'custom' && state.customNote) lines.push(`・補足：${state.customNote}`);
    const colorName = g.group === 'color' ? (isNamedColor(state.hairColor) ? state.hairColor : texts.title)
      : (isNamedColor(state.hairColor) ? state.hairColor : null);
    const c = colorName ? findHairColor(settings, colorName) : null;
    if (colorName) lines.push(`・髪色：${colorName}${c ? `（${c.desc}）` : ''}`);
    return lines;
  }

  // ChatGPT に貼り付ける、ブログ本文づくりの依頼文
  function buildBlogPrompt(settings, state, texts, staff) {
    const season = settings.seasons[state.season];
    const b = settings.blog || { minChars: 600, maxChars: 900, titleMax: 30 };
    return [
      '# ホットペッパービューティーのブログ本文の作成依頼',
      '',
      `${settings.area}のメンズ美容室のスタイリストとして、お客様に向けたブログの本文を書いてください。`,
      '',
      '## 1. 今回のテーマ',
      `・メインタイトル：${texts.title}`,
      `・キャッチコピー：${texts.catch}`,
      `・サブタイトル：${texts.subtitle}`,
      `・カテゴリー：${texts.category}`,
      `・季節：${season.label}`,
      `・テイスト：${settings.toneStyles[state.tone] || ''}`,
      ...themeLines(settings, state, texts),
      `・書き手：${staff ? staff.name : '担当スタイリスト'}（本文で名乗る必要はありません）`,
      '',
      '## 2. 読む人',
      '・20〜30代の男性。髪型に興味はあるが、美容室にくわしくない人も含む。',
      '・専門用語は使いすぎず、使うときはやさしく言いかえる。',
      '',
      '## 3. 構成（この順番で）',
      `1. ${season.label}の季節感にふれながら、読む人の気持ちに寄りそう導入`,
      '2. 今回のスタイル・施術・髪色の紹介',
      '3. 特徴と、おすすめする理由',
      '4. どんな人に似合うか、どんな悩みの人に合うか',
      '5. 自宅でのスタイリングや、きれいに保つコツ',
      '6. 押しつけない、来店のお誘い',
      '',
      '## 4. 書き方のルール（必ず守る）',
      '・1文ごとに改行する。1行に2つ以上の文を書かない。',
      '・まとまりの区切りには、空行を1行だけ入れる。',
      '・絵文字、顔文字、記号は使わない。文の中で使ってよい記号は「、」と「。」だけ。',
      '・使わない記号の例：！　？　♪　★　☆　※　・　「」　（）　【】　〜　…　#　■',
      '・カタカナの長音「ー」は使ってよい。',
      '・見出しや箇条書きは使わず、すべて文章で書く。',
      `・本文は${b.minChars}〜${b.maxChars}文字くらい。`,
      `・言葉選びはテイスト（${settings.tones[state.tone] || ''}）に合わせ、季節感は自然に入れる。`,
      '・効果を保証する表現や、大げさな表現は使わない（例：必ず、絶対、誰でも、治る、ダメージゼロ）。',
      '・ここに書いていない事実（料金、キャンペーン、日付、実績の数字など）は書かない。',
      '・ほかのお店や人を下げる表現は使わない。',
      '',
      '## 5. 出力の形',
      `・1行目：ブログのタイトル（「${texts.title}」を入れて${b.titleMax}文字以内。記号は使わない）`,
      '・2行目：空行',
      '・3行目から：本文',
      '・本文のあとに空行を1行入れ、次の店舗情報を一字一句そのまま最後に付ける（店舗情報の中の記号や改行は変えない）。',
      '・店舗情報のあとには何も書かない。前置きや説明の文も書かない。',
      '',
      '----- 店舗情報ここから -----',
      settings.shopFooter || '',
      '----- 店舗情報ここまで -----'
    ].join('\n');
  }

  // 本文で使ってよい文字：文字・数字・空白・「、」「。」・長音「ー」
  const BLOG_ALLOWED = /[\p{L}\p{N}\s、。ー]/u;
  function splitFooter(text, footer) {
    const t = String(text || '').replace(/\r\n?/g, '\n');
    const f = String(footer || '').trim();
    const i = f ? t.lastIndexOf(f.split('\n')[0]) : -1;
    return i >= 0 ? { body: t.slice(0, i), footer: t.slice(i).trim() } : { body: t, footer: '' };
  }

  // 生成された本文がルールどおりか調べる
  function checkBlogText(text, footer) {
    const { body, footer: f } = splitFooter(text, footer);
    const problems = [];
    const bad = [...new Set([...body].filter((ch) => !BLOG_ALLOWED.test(ch)))];
    if (bad.length) problems.push(`使えない記号・絵文字があります：${bad.slice(0, 12).join(' ')}`);
    const multi = body.split('\n').filter((l) => /[。！？!?]\s*\S/.test(l));
    if (multi.length) problems.push(`1行に2つ以上の文がある行が${multi.length}か所あります`);
    if (!f || f !== String(footer || '').trim()) problems.push('最後の店舗情報が、元の文章と一字一句同じになっていません');
    return problems;
  }

  // ルールに合わせて整える（記号を消し、1文ごとに改行し、店舗情報を正しいものに付け直す）
  function cleanBlogText(text, footer) {
    const { body } = splitFooter(text, footer);
    const lines = [];
    for (const raw of body.split('\n')) {
      let l = raw.replace(/[！？!?]+/g, '。');
      l = [...l].filter((ch) => BLOG_ALLOWED.test(ch)).join('').replace(/[ \t　]+/g, (m) => m[0]).trim();
      if (!l) { lines.push(''); continue; }
      // 1行目はタイトル。分けず、終わりの「。」も付けない
      if (!lines.some((x) => x)) { lines.push(l.replace(/。+$/, '')); continue; }
      // 本文は1文ごとに改行し、文の終わりに「。」を付ける
      const parts = l.replace(/。+/g, '。').split(/(?<=。)/).map((x) => x.trim()).filter(Boolean);
      lines.push(...parts.map((x) => (x.endsWith('。') ? x : `${x}。`)));
    }
    const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return `${out}\n\n${String(footer || '').trim()}`;
  }

  // 文字と背景の見やすさ（コントラスト比。4.5以上が目安）
  function luminance(hex) {
    const v = hex.replace('#', '');
    const rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }
  function contrastRatio(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  }

  const api = {
    MAX_CHARS, charCount, findGenre, findSub, findHairColor, colorsFor, paletteOf, categoryText, titleCandidates,
    generateCandidates, validate, buildPrompt, buildBlogPrompt, checkBlogText, cleanBlogText, contrastRatio
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SBS_ENGINE = api;
})(this);
