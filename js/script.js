// =========================================================
//  投稿検索フォーム（非公式）
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

function buildQuery({ keyword = '', handle = '', since = '', until = '' }) {
  return [
    keyword.trim() === '' ? '' : keyword,
    handle && `from:${handle}`,
    since && `since:${toSinceUtc(since)}`,
    until && `until:${toUntilUtc(until)}`,
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
 * errors の field は author / since / until / range のいずれか。
 */
function evaluateForm({ author = '', keyword = '', since = '', until = '' }) {
  const handle = normalizeHandle(author);
  const isEmpty = handle === '' && keyword.trim() === '' && since === '' && until === '';
  const errors = [];

  if (handle !== '' && !isValidHandle(handle)) {
    errors.push({ field: 'author', message: '投稿者のハンドルの形式が正しくありません。' });
  }
  if (since !== '' && !isValidDate(since)) {
    errors.push({ field: 'since', message: '開始日が正しい日付ではありません。' });
  }
  if (until !== '' && !isValidDate(until)) {
    errors.push({ field: 'until', message: '終了日が正しい日付ではありません。' });
  }
  if (errors.length === 0 && since !== '' && until !== '' && since > until) {
    errors.push({ field: 'range', message: '開始日は終了日以前の日付にしてください。' });
  }

  const canSearch = !isEmpty && errors.length === 0;
  const query = canSearch ? buildQuery({ keyword, handle, since, until }) : '';
  return {
    isEmpty,
    errors,
    hasUnclosedQuote: hasUnclosedQuote(keyword),
    query,
    url: canSearch ? buildSearchUrl(query) : '',
  };
}

/** フォームの値をページURLのクエリにする。空の項目は入れない */
function formToPageParams({ author = '', keyword = '', since = '', until = '' }) {
  const handle = normalizeHandle(author);
  const params = new URLSearchParams();
  if (handle !== '') params.set('author', isValidHandle(handle) ? handle : author.trim());
  if (keyword.trim() !== '') params.set('q', keyword);
  if (since !== '') params.set('since', since);
  if (until !== '') params.set('until', until);
  return params;
}

/** ページURLのクエリをフォームの値に戻す。日付として不正な値は捨てる */
function pageParamsToForm(params) {
  const readDate = (name) => {
    const value = params.get(name) ?? '';
    return isValidDate(value) ? value : '';
  };
  return {
    author: params.get('author') ?? '',
    keyword: params.get('q') ?? '',
    since: readDate('since'),
    until: readDate('until'),
  };
}

// ---------------------------------------------------------
//  【UI】表示の更新と検索
// ---------------------------------------------------------

function initForm() {
  const form = document.getElementById('search-form');
  const inputs = {
    author: document.getElementById('author'),
    keyword: document.getElementById('keyword'),
    since: document.getElementById('since'),
    until: document.getElementById('until'),
  };
  const queryOutput = document.getElementById('query');
  const messageBox = document.getElementById('message');
  const quoteWarning = document.getElementById('quote-warning');

  // 入力途中のハンドルは不正に見えるため、欄を離れるか検索するまでエラーを出さない
  let isEditingAuthor = false;

  function readForm() {
    return {
      author: inputs.author.value,
      keyword: inputs.keyword.value,
      since: inputs.since.value,
      until: inputs.until.value,
    };
  }

  function writeForm(values) {
    for (const [name, input] of Object.entries(inputs)) input.value = values[name];
  }

  function syncPageUrl(values) {
    const params = formToPageParams(values).toString();
    try {
      history.replaceState(null, '', params ? `${location.pathname}?${params}` : location.pathname);
    } catch (e) {
      // 短時間に呼びすぎると例外を投げるブラウザがある。次の入力で反映し直すので無視する
    }
  }

  // 日付を途中まで入力すると value が空になり、期間なしで検索されてしまうため別に検出する
  function incompleteDateErrors() {
    const labels = { since: '開始日', until: '終了日' };
    return Object.keys(labels)
      .filter((name) => inputs[name].validity.badInput)
      .map((name) => ({ field: name, message: `${labels[name]}を最後まで入力してください。` }));
  }

  function fieldsOf(error) {
    return error.field === 'range' ? ['since', 'until'] : [error.field];
  }

  function showMessages(messages) {
    messageBox.replaceChildren(
      ...messages.map((text) => {
        const p = document.createElement('p');
        p.textContent = text;
        return p;
      }),
    );
    messageBox.hidden = messages.length === 0;
  }

  function render({ submitted = false } = {}) {
    const values = readForm();
    const result = evaluateForm(values);
    const errors = [...incompleteDateErrors(), ...result.errors];
    const isEmpty = result.isEmpty && errors.length === 0;
    const canSearch = !isEmpty && errors.length === 0;
    const shownErrors = errors.filter((e) => submitted || e.field !== 'author' || !isEditingAuthor);

    const invalidFields = new Set(shownErrors.flatMap(fieldsOf));
    for (const [name, input] of Object.entries(inputs)) {
      if (invalidFields.has(name)) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }

    const messages = shownErrors.map((e) => e.message);
    if (submitted && isEmpty) messages.push('検索条件を1つ以上入力してください。');
    showMessages(messages);

    queryOutput.textContent = canSearch ? result.query : '—';
    quoteWarning.hidden = !result.hasUnclosedQuote;
    syncPageUrl(values);

    return { canSearch, url: result.url, firstField: errors[0] ? fieldsOf(errors[0])[0] : 'author' };
  }

  form.addEventListener('input', (event) => {
    if (event.target === inputs.author) isEditingAuthor = true;
    render();
  });

  inputs.author.addEventListener('blur', () => {
    isEditingAuthor = false;
    render();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const { canSearch, url, firstField } = render({ submitted: true });
    if (!canSearch) {
      inputs[firstField].focus();
      return;
    }
    // ポップアップブロックを避けるため、クリック（送信）の処理の中で直接開く
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  writeForm(pageParamsToForm(new URLSearchParams(location.search)));
  render();
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
    formToPageParams,
    pageParamsToForm,
  };
} else {
  initForm();
}
