// =========================================================
//  404.html 用：/リポジトリ名/@ハンドル を ?handle= に置き換えてトップへ移る
//  GitHub Pages は存在しないパスに 404.html を返すため、ここで振り分ける
// =========================================================

/** パスが「…/@ハンドル」なら、トップのパスとハンドルを返す。違えば null */
function parseHandlePath(pathname) {
  const match = /^(.*\/)@([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const handle = decodeURIComponent(match[2]).trim();
    return handle ? { base: match[1], handle } : null;
  } catch (e) {
    return null; // 壊れた%エンコード
  }
}

if (typeof module !== 'undefined') {
  // Node のテスト（test/script.test.js）から読み込んだときは、関数だけを書き出す
  module.exports = { parseHandlePath };
} else {
  const target = parseHandlePath(location.pathname);
  if (target) location.replace(`${target.base}?handle=${encodeURIComponent(target.handle)}`);
}
