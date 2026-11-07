// 実行方法: プロジェクト直下で `node --test`
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  buildQuery,
  buildSearchUrl,
  evaluateForm,
  handlePagePath,
  hasUnclosedQuote,
  isValidDate,
  isValidHandle,
  normalizeHandle,
  readHandleParam,
  toSinceUtc,
  toUntilUtc,
} = require('../js/script.js');
const { parseHandlePath } = require('../js/redirect.js');

const qOf = (url) => new URL(url).searchParams.get('q');

describe('仕様の例', () => {
  const form = {
    author: 'alice.bsky.social',
    keyword: 'pauper',
    since: '2026-11-01',
    until: '2026-11-03',
  };

  it('クエリが完全一致する', () => {
    assert.equal(
      evaluateForm(form).query,
      'pauper from:alice.bsky.social since:2026-10-31T15:00:00Z until:2026-11-03T15:00:00Z',
    );
  });

  it('URLが完全一致する', () => {
    assert.equal(
      evaluateForm(form).url,
      'https://bsky.app/search?q=pauper%20from%3Aalice.bsky.social%20since%3A2026-10-31T15%3A00%3A00Z%20until%3A2026-11-03T15%3A00%3A00Z&tab=latest',
    );
  });
});

describe('各項目だけを指定した場合', () => {
  const cases = [
    ['投稿者', { author: 'alice' }, 'from:alice.bsky.social'],
    ['キーワード', { keyword: 'pauper' }, 'pauper'],
    ['開始日', { since: '2026-11-01' }, 'since:2026-10-31T15:00:00Z'],
    ['終了日', { until: '2026-11-03' }, 'until:2026-11-03T15:00:00Z'],
  ];
  for (const [name, form, expected] of cases) {
    it(name, () => {
      const result = evaluateForm(form);
      assert.equal(result.query, expected);
      assert.equal(qOf(result.url), expected);
    });
  }
});

describe('期間の変換', () => {
  const sinceCases = [
    ['月初は前月末になる', '2026-11-01', '2026-10-31T15:00:00Z'],
    ['年始は前年末になる', '2027-01-01', '2026-12-31T15:00:00Z'],
    ['平年の3月1日は2月28日になる', '2027-03-01', '2027-02-28T15:00:00Z'],
    ['閏年の3月1日は2月29日になる', '2028-03-01', '2028-02-29T15:00:00Z'],
  ];
  for (const [name, date, expected] of sinceCases) {
    it(`since: ${name}`, () => assert.equal(toSinceUtc(date), expected));
  }

  const untilCases = [
    ['月末', '2026-10-31', '2026-10-31T15:00:00Z'],
    ['年末', '2026-12-31', '2026-12-31T15:00:00Z'],
    ['閏日', '2028-02-29', '2028-02-29T15:00:00Z'],
  ];
  for (const [name, date, expected] of untilCases) {
    it(`until: ${name}`, () => assert.equal(toUntilUtc(date), expected));
  }

  it('1日だけの指定はちょうど24時間になる', () => {
    const since = Date.parse(toSinceUtc('2026-12-31'));
    const until = Date.parse(toUntilUtc('2026-12-31'));
    assert.equal(until - since, 24 * 60 * 60 * 1000);
  });

  it('実行環境のタイムゾーンに依存しない', () => {
    const originalTz = process.env.TZ;
    const offsets = new Set();
    try {
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
        process.env.TZ = tz;
        offsets.add(new Date('2026-11-01T00:00:00Z').getTimezoneOffset());
        assert.equal(toSinceUtc('2026-11-01'), '2026-10-31T15:00:00Z', tz);
        assert.equal(toUntilUtc('2026-11-03'), '2026-11-03T15:00:00Z', tz);
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
    // TZの切り替えが実際に効いていないと、このテストは何も確かめていないことになる
    assert.equal(offsets.size, 5);
  });
});

describe('ハンドルの整形', () => {
  const cases = [
    ['@付き', '@alice.bsky.social', 'alice.bsky.social'],
    ['全角＠付き', '＠alice.bsky.social', 'alice.bsky.social'],
    ['前後の空白', '  alice.bsky.social\t', 'alice.bsky.social'],
    ['全角空白', '　@alice.bsky.social　', 'alice.bsky.social'],
    ['@と空白', ' @alice ', 'alice.bsky.social'],
    ['.がない', 'alice', 'alice.bsky.social'],
    ['独自ドメイン', 'alice.example.com', 'alice.example.com'],
    ['大文字', 'Alice.Bsky.Social', 'alice.bsky.social'],
    ['.がない大文字', 'Alice', 'alice.bsky.social'],
    ['プロフィールURL', 'https://bsky.app/profile/alice.bsky.social', 'alice.bsky.social'],
    ['末尾スラッシュ', 'https://bsky.app/profile/alice.bsky.social/', 'alice.bsky.social'],
    ['投稿のURL', 'https://bsky.app/profile/alice.bsky.social/post/3abc', 'alice.bsky.social'],
    ['クエリ付きURL', 'https://bsky.app/profile/alice.bsky.social?ref=x', 'alice.bsky.social'],
    ['スキームなしURL', 'bsky.app/profile/alice.bsky.social', 'alice.bsky.social'],
    ['空白付きURL', ' https://bsky.app/profile/alice.bsky.social ', 'alice.bsky.social'],
    ['URLの中の@', 'https://bsky.app/profile/@alice.bsky.social', 'alice.bsky.social'],
    ['URLの.なしハンドル', 'https://bsky.app/profile/alice', 'alice.bsky.social'],
    ['DIDのプロフィールURL', 'https://bsky.app/profile/did:plc:AbC123', 'did:plc:AbC123'],
    ['DID', 'did:plc:z72i7hdynmk6r22z27h6tvur', 'did:plc:z72i7hdynmk6r22z27h6tvur'],
    ['空', '', ''],
    ['空白のみ', '   ', ''],
    ['@のみ', '@', ''],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => assert.equal(normalizeHandle(input), expected));
  }

  it('2回かけても結果が変わらない', () => {
    for (const [, input, expected] of cases) {
      assert.equal(normalizeHandle(normalizeHandle(input)), expected);
    }
  });

  it('nullとundefinedは空として扱う', () => {
    assert.equal(normalizeHandle(null), '');
    assert.equal(normalizeHandle(undefined), '');
  });
});

describe('ハンドルの検証', () => {
  const valid = ['alice.bsky.social', 'a-b.example.com', 'did:plc:z72i7hdynmk6r22z27h6tvur'];
  for (const handle of valid) {
    it(`有効: ${handle}`, () => assert.equal(isValidHandle(handle), true));
  }

  const invalid = [
    ['空白を含む', 'alice since:2020-01-01.bsky.social'],
    ['日本語', 'ありす.bsky.social'],
    ['下線', 'a_b.bsky.social'],
    ['先頭のハイフン', '-alice.bsky.social'],
    ['連続するドット', 'alice..bsky.social'],
    ['末尾のドット', 'alice.'],
    ['数字で始まるTLD', 'alice.1com'],
    ['他サイトのURL', 'https://example.com/profile/alice'],
  ];
  for (const [name, handle] of invalid) {
    it(`無効: ${name}`, () => assert.equal(isValidHandle(handle), false));
  }

  it('不正なハンドルは検索させない', () => {
    const result = evaluateForm({ author: 'alice since:2020-01-01' });
    assert.deepEqual(result.errors.map((e) => e.field), ['author']);
    assert.equal(result.query, '');
    assert.equal(result.url, '');
  });
});

describe('キーワード', () => {
  const cases = [
    ['フレーズ', '"hello world"'],
    ['除外', 'pauper -standard'],
    ['日本語', 'パウパー 統率者'],
    ['引用符と日本語', '"統率者 戦" -スタンダード'],
    ['URLで特別な文字', 'a&b=c+d#e?f/g%20h'],
    ['絵文字', '🦋 検索'],
  ];
  for (const [name, keyword] of cases) {
    it(`そのまま q に入る: ${name}`, () => {
      const result = evaluateForm({ keyword });
      assert.equal(result.query, keyword);
      assert.equal(qOf(result.url), keyword);
    });
  }

  it('他の項目の前に置かれる', () => {
    const result = evaluateForm({ keyword: '"統率者 戦"', author: 'alice', since: '2026-11-01' });
    assert.equal(
      qOf(result.url),
      '"統率者 戦" from:alice.bsky.social since:2026-10-31T15:00:00Z',
    );
  });

  it('URLのqとtabのほかにパラメータが増えない', () => {
    const url = new URL(evaluateForm({ keyword: 'a&b=c' }).url);
    assert.deepEqual([...url.searchParams.keys()], ['q', 'tab']);
    assert.equal(url.origin + url.pathname, 'https://bsky.app/search');
  });

  it('閉じていない引用符を検出する', () => {
    assert.equal(hasUnclosedQuote('"hello'), true);
    assert.equal(hasUnclosedQuote('"a b" "c'), true);
    assert.equal(hasUnclosedQuote('"hello world"'), false);
    assert.equal(hasUnclosedQuote('hello'), false);
  });

  it('閉じていない引用符があれば検索させない', () => {
    const result = evaluateForm({ keyword: '"hello', author: 'alice' });
    assert.deepEqual(result.errors.map((e) => e.field), ['keyword']);
    assert.equal(result.query, '');
    assert.equal(result.url, '');
  });
});

describe('入力の検証', () => {
  it('開始日が終了日より後なら検索させない', () => {
    const result = evaluateForm({ keyword: 'pauper', since: '2026-11-04', until: '2026-11-03' });
    assert.deepEqual(result.errors.map((e) => e.field), ['range']);
    assert.equal(result.query, '');
    assert.equal(result.url, '');
  });

  it('ほかの項目にエラーがあっても日付の前後を検出する', () => {
    const result = evaluateForm({ keyword: '"hello', since: '2026-11-04', until: '2026-11-03' });
    assert.deepEqual(result.errors.map((e) => e.field), ['keyword', 'range']);
  });

  it('年をまたいで前後が逆でも検出する', () => {
    const result = evaluateForm({ since: '2027-01-01', until: '2026-12-31' });
    assert.deepEqual(result.errors.map((e) => e.field), ['range']);
  });

  it('開始日と終了日が同じ日なら検索できる', () => {
    const result = evaluateForm({ since: '2026-11-03', until: '2026-11-03' });
    assert.equal(result.errors.length, 0);
    assert.equal(result.query, 'since:2026-11-02T15:00:00Z until:2026-11-03T15:00:00Z');
  });

  it('全部空なら検索しない', () => {
    const result = evaluateForm({ author: '', keyword: '', since: '', until: '' });
    assert.equal(result.isEmpty, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.url, '');
  });

  it('空白だけの入力は空として扱う', () => {
    const result = evaluateForm({ author: ' @ ', keyword: ' 　', since: '', until: '' });
    assert.equal(result.isEmpty, true);
    assert.equal(result.url, '');
  });

  it('空白だけのキーワードはクエリから省く', () => {
    assert.equal(buildQuery({ keyword: '  ', handle: 'alice.bsky.social' }), 'from:alice.bsky.social');
  });

  const invalidDates = ['2026-02-30', '2026-13-01', '2026-00-10', '0026-11-01', '9999-12-31', '2026/11/01', '20261101', 'abc'];
  for (const date of invalidDates) {
    it(`不正な日付: ${date}`, () => {
      assert.equal(isValidDate(date), false);
      const result = evaluateForm({ since: date });
      assert.deepEqual(result.errors.map((e) => e.field), ['since']);
      assert.equal(result.url, '');
    });
  }

  it('閏日は閏年だけ有効', () => {
    assert.equal(isValidDate('2028-02-29'), true);
    assert.equal(isValidDate('2027-02-29'), false);
  });
});

describe('言語', () => {
  it('末尾に lang: を付ける', () => {
    assert.equal(evaluateForm({ keyword: 'pauper', lang: 'ja' }).query, 'pauper lang:ja');
  });

  it('全項目と組み合わせられる', () => {
    const result = evaluateForm({
      author: 'alice.bsky.social',
      keyword: 'pauper',
      since: '2026-11-01',
      until: '2026-11-03',
      lang: 'en',
    });
    assert.equal(
      qOf(result.url),
      'pauper from:alice.bsky.social since:2026-10-31T15:00:00Z until:2026-11-03T15:00:00Z lang:en',
    );
  });

  it('指定なしなら lang: を付けない', () => {
    assert.equal(evaluateForm({ keyword: 'pauper', lang: '' }).query, 'pauper');
  });

  it('言語だけでは検索しない', () => {
    const result = evaluateForm({ lang: 'ja' });
    assert.equal(result.isEmpty, true);
    assert.equal(result.url, '');
  });

  it('選択肢にない値は無視する', () => {
    assert.equal(evaluateForm({ keyword: 'pauper', lang: 'fr' }).query, 'pauper');
  });
});

describe('URLのhandleパラメータ', () => {
  it('値を返す', () => {
    assert.equal(readHandleParam('?handle=alice.bsky.social'), 'alice.bsky.social');
  });

  it('エンコードされた@を戻す', () => {
    assert.equal(readHandleParam('?handle=%40alice'), '@alice');
  });

  it('前後の空白を除く', () => {
    assert.equal(readHandleParam('?handle=+alice+'), 'alice');
  });

  it('パラメータがなければ空', () => {
    assert.equal(readHandleParam(''), '');
    assert.equal(readHandleParam('?q=pauper'), '');
  });

  it('入れた値は検索時に整形される', () => {
    const result = evaluateForm({ author: readHandleParam('?handle=%40Alice') });
    assert.equal(result.query, 'from:alice.bsky.social');
  });
});

describe('URLの@ハンドル（404.htmlでの振り分け）', () => {
  it('トップのパスとハンドルを取り出す', () => {
    assert.deepEqual(parseHandlePath('/bsky-post-search/@alice.bsky.social'), {
      base: '/bsky-post-search/',
      handle: 'alice.bsky.social',
    });
  });

  it('末尾のスラッシュを許す', () => {
    assert.equal(parseHandlePath('/bsky-post-search/@alice/').handle, 'alice');
  });

  it('%エンコードを戻す', () => {
    assert.equal(parseHandlePath('/bsky-post-search/@did%3Aplc%3Aabc').handle, 'did:plc:abc');
  });

  it('@で始まらないパスは対象外', () => {
    assert.equal(parseHandlePath('/bsky-post-search/'), null);
    assert.equal(parseHandlePath('/bsky-post-search/foo'), null);
    assert.equal(parseHandlePath('/bsky-post-search/foo@alice'), null);
  });

  it('@のあとが空なら対象外', () => {
    assert.equal(parseHandlePath('/bsky-post-search/@'), null);
    assert.equal(parseHandlePath('/bsky-post-search/@%20'), null);
  });

  it('@のあとにさらにパスが続けば対象外', () => {
    assert.equal(parseHandlePath('/bsky-post-search/@alice/post/123'), null);
  });

  it('壊れた%エンコードは対象外', () => {
    assert.equal(parseHandlePath('/bsky-post-search/@%E0%A4%A'), null);
  });
});

describe('アドレスバーの@ハンドル', () => {
  it('トップのパスに@ハンドルを付ける', () => {
    assert.equal(handlePagePath('/bsky-post-search/', 'alice.bsky.social'), '/bsky-post-search/@alice.bsky.social');
  });

  it('index.htmlのパスからでも同じ形にする', () => {
    assert.equal(handlePagePath('/bsky-post-search/index.html', 'alice.bsky.social'), '/bsky-post-search/@alice.bsky.social');
  });

  it('整形したハンドルを使う', () => {
    assert.equal(handlePagePath('/bsky-post-search/', '@Alice'), '/bsky-post-search/@alice.bsky.social');
  });

  it('正しいハンドルにならなければ書き換えない', () => {
    assert.equal(handlePagePath('/bsky-post-search/', 'a b'), '');
    assert.equal(handlePagePath('/bsky-post-search/', ''), '');
  });

  it('@のURL→?handle=→@のURLと往復する', () => {
    const { base, handle } = parseHandlePath('/bsky-post-search/@Alice');
    const search = `?handle=${encodeURIComponent(handle)}`;
    assert.equal(handlePagePath(base, readHandleParam(search)), '/bsky-post-search/@alice.bsky.social');
  });
});

describe('buildSearchUrl', () => {
  it('クエリをエンコードする', () => {
    assert.equal(buildSearchUrl('a b'), 'https://bsky.app/search?q=a%20b&tab=latest');
  });
});
