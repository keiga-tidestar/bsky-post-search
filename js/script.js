// =========================================================
//  投稿検索フォーム
//  入力から bsky.app の検索URLを作り、新しいタブで開く
// =========================================================

// ---------------------------------------------------------
//  【ロジック】検索URLの生成
//  DOMと実行環境のタイムゾーンに依存しない純粋関数
// ---------------------------------------------------------

const SEARCH_URL = 'https://bsky.app/search';
const JST_OFFSET_HOURS = 9;
const DEFAULT_HANDLE_SUFFIX = '.bsky.social';
const MAX_HANDLE_LENGTH = 253;
// until は翌日0時に変換するので、9999年まで許すと5桁の年になり形式が崩れる
const MAX_DATE_YEAR = 9998;

const PROFILE_URL_RE = /^(?:https?:\/\/)?(?:www\.)?bsky\.app\/profile\/([^/?#\s]+)/i;
const HANDLE_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DID_RE = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// 言語のラジオボタンで選べる値。空文字は指定なし
const LANGUAGES = ['ja', 'en'];

/**
 * 投稿者の入力をハンドルへ整形する。空なら空文字を返す。
 * 検索は大文字を含むハンドルに一致しない（実測で0件）ため小文字に揃える。
 * プロフィールURLにはDIDが入ることがある。DIDは大文字小文字を区別するのでそのまま返す。
 */
function normalizeHandle(input) {
  let value = String(input ?? '').trim();
  const profile = value.match(PROFILE_URL_RE);
  if (profile) value = profile[1];
  value = value.replace(/^[@＠]+/, '').trim();
  if (value === '') return '';
  if (/^did:/i.test(value)) return value;
  value = value.toLowerCase();
  return value.includes('.') ? value : value + DEFAULT_HANDLE_SUFFIX;
}

function isValidHandle(handle) {
  if (DID_RE.test(handle)) return true;
  return handle.length <= MAX_HANDLE_LENGTH && HANDLE_RE.test(handle);
}

function parseDate(value) {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year > MAX_DATE_YEAR) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // 2026-02-30 のように繰り上がる日付や、Date.UTCが19xx年に読み替える年を弾く
  const isSameDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return isSameDate ? { year, month, day } : null;
}

function isValidDate(value) {
  return parseDate(value) !== null;
}

function jstMidnightToUtc(value, dayOffset) {
  const { year, month, day } = parseDate(value);
  const utc = new Date(Date.UTC(year, month - 1, day + dayOffset, -JST_OFFSET_HOURS));
  return utc.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 開始日の0時（JST）をUTCにする */
function toSinceUtc(date) {
  return jstMidnightToUtc(date, 0);
}

/** 終了日の翌日0時（JST）をUTCにする。until は指定時刻を含まないため */
function toUntilUtc(date) {
  return jstMidnightToUtc(date, 1);
}

function buildQuery({ keyword = '', handle = '', since = '', until = '', lang = '' }) {
  return [
    keyword.trim() === '' ? '' : keyword,
    handle && `from:${handle}`,
    since && `since:${toSinceUtc(since)}`,
    until && `until:${toUntilUtc(until)}`,
    lang && `lang:${lang}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** 公式アプリの検索画面は tab でタブを選ぶ。sort は読まれず「トップ」が開く（2026-11-07実測） */
function buildSearchUrl(query) {
  return `${SEARCH_URL}?q=${encodeURIComponent(query)}&tab=latest`;
}

/** 閉じていない `"` があると、公式アプリは後ろの from: などまで1語に含めてしまう */
function hasUnclosedQuote(keyword) {
  return (keyword.match(/"/g) ?? []).length % 2 === 1;
}

/**
 * フォームの値を検証し、検索できる場合だけ query と url を返す。
 * errors の field は author / keyword / since / until / range のいずれか。
 */
function evaluateForm({ author = '', keyword = '', since = '', until = '', lang = '' }) {
  const handle = normalizeHandle(author);
  const language = LANGUAGES.includes(lang) ? lang : '';
  // 言語は絞り込みの条件なので、言語だけでは検索しない
  const isEmpty = handle === '' && keyword.trim() === '' && since === '' && until === '';
  const errors = [];

  if (handle !== '' && !isValidHandle(handle)) {
    errors.push({ field: 'author', message: '投稿者のハンドルの形式が正しくありません。' });
  }
  if (hasUnclosedQuote(keyword)) {
    errors.push({ field: 'keyword', message: 'キーワードの「"」が閉じていません。' });
  }
  if (since !== '' && !isValidDate(since)) {
    errors.push({ field: 'since', message: '開始日が正しい日付ではありません。' });
  }
  if (until !== '' && !isValidDate(until)) {
    errors.push({ field: 'until', message: '終了日が正しい日付ではありません。' });
  }
  if (isValidDate(since) && isValidDate(until) && since > until) {
    errors.push({ field: 'range', message: '開始日は終了日以前の日付にしてください。' });
  }

  const canSearch = !isEmpty && errors.length === 0;
  const query = canSearch ? buildQuery({ keyword, handle, since, until, lang: language }) : '';
  return {
    isEmpty,
    errors,
    query,
    url: canSearch ? buildSearchUrl(query) : '',
  };
}

/** ページURLの ?handle= の値を返す。投稿者欄の初期値に使う（例: index.html?handle=alice.bsky.social） */
function readHandleParam(search) {
  return (new URLSearchParams(search).get('handle') ?? '').trim();
}

// ---------------------------------------------------------
//  【UI】検索ボタンを押したときに検証して開く
// ---------------------------------------------------------

function initForm() {
  const form = document.getElementById('search-form');
  const inputs = {
    author: document.getElementById('author'),
    keyword: document.getElementById('keyword'),
    since: document.getElementById('since'),
    until: document.getElementById('until'),
  };
  const langRadios = form.elements.namedItem('lang');
  const messageBox = document.getElementById('message');

  function readForm() {
    return {
      author: inputs.author.value,
      keyword: inputs.keyword.value,
      since: inputs.since.value,
      until: inputs.until.value,
      lang: langRadios.value,
    };
  }

  // 日付を途中まで入力すると value が空になり、期間なしで検索されてしまうため別に検出する
  function incompleteDateErrors() {
    const labels = { since: '開始日', until: '終了日' };
    return Object.keys(labels)
      .filter((name) => inputs[name].validity.badInput)
      .map((name) => ({ field: name, message: `${labels[name]}を最後まで入力してください。` }));
  }

  function fieldsOf(error) {
    if (error.field === 'range') return ['since', 'until'];
    return error.field ? [error.field] : [];
  }

  function showErrors(errors) {
    const invalidFields = new Set(errors.flatMap(fieldsOf));
    for (const [name, input] of Object.entries(inputs)) {
      if (invalidFields.has(name)) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    messageBox.replaceChildren(
      ...errors.map((error) => {
        const p = document.createElement('p');
        p.textContent = error.message;
        return p;
      }),
    );
    messageBox.hidden = errors.length === 0;
  }

  // 入力を直したら、前回のエラー表示は消す
  form.addEventListener('input', () => showErrors([]));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = evaluateForm(readForm());
    const errors = [...incompleteDateErrors(), ...result.errors];
    if (result.isEmpty && errors.length === 0) {
      errors.push({ field: null, message: '検索条件を1つ以上入力してください。' });
    }
    if (errors.length > 0) {
      showErrors(errors);
      inputs[fieldsOf(errors[0])[0] ?? 'author'].focus();
      return;
    }
    showErrors([]);
    // ポップアップブロックを避けるため、クリック（送信）の処理の中で直接開く
    window.open(result.url, '_blank', 'noopener,noreferrer');
  });

  const handle = readHandleParam(location.search);
  if (handle) inputs.author.value = handle;
}

// ---------------------------------------------------------
//  起動
// ---------------------------------------------------------

if (typeof module !== 'undefined') {
  // Node のテスト（test/script.test.js）から読み込んだときは、ロジックだけを書き出す
  module.exports = {
    normalizeHandle,
    isValidHandle,
    isValidDate,
    toSinceUtc,
    toUntilUtc,
    buildQuery,
    buildSearchUrl,
    hasUnclosedQuote,
    evaluateForm,
    readHandleParam,
  };
} else {
  initForm();
}
