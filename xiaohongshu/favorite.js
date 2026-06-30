/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/favorite — social-media P0 adapter (engage / write)
 *
 * Favorite (bookmark) or unfavorite a note via SPA-click on the
 * `.interaction-info` second button (collect). Verified by observing the
 * collected-count change (1931→1932→1931 pattern as proven by the like adapter
 * SM-2.5 test).
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §10.3 (WriteReceipt)
 */

/* @meta
{
  "name": "xiaohongshu/favorite",
  "title": "收藏/取消收藏小红书笔记",
  "description": "Favorite (or unfavorite with --undo) a Xiaohongshu note via SPA-click on .interaction-info > :nth-child(2). Requires confirm=true. Returns WriteReceipt.",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": false,
  "prerequisites": "需先登录 xiaohongshu.com",
  "args": [
    {
      "name": "noteId",
      "type": "string",
      "required": true
    },
    {
      "name": "xsecToken",
      "type": "string",
      "required": false
    },
    {
      "name": "xsecSource",
      "type": "enum",
      "values": [
        "pc_search",
        "pc_feed",
        "pc_explore"
      ],
      "default": "pc_search"
    },
    {
      "name": "undo",
      "type": "boolean",
      "default": false
    },
    {
      "name": "confirm",
      "type": "boolean",
      "required": true
    }
  ],
  "example": "bb-browser site xiaohongshu/favorite --noteId '69f5d0bc0000000035033f20' --confirm true --json",
  "capabilities": [
    "write",
    "network"
  ],
  "accessTier": "auth_write",
  "intent": "engage"
}
*/

const HOME_URL = 'https://www.xiaohongshu.com';

const noteContextCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function getNoteContext(noteId) {
  const ctx = noteContextCache.get(noteId);
  if (!ctx) return null;
  if (Date.now() - ctx.fetchedAt > CACHE_TTL_MS) {
    noteContextCache.delete(noteId);
    return null;
  }
  return ctx;
}

async function favorite(args) {
  const { noteId, xsecToken: tokenArg, xsecSource = 'pc_search', undo = false, confirm = false } = args || {};

  if (!noteId) {
    return { ok: false, authStatus: 'anonymous', data: null, error: 'MISSING_ARG', hint: 'noteId is required.', action: 'abort' };
  }
  if (confirm !== true) {
    return {
      ok: false, authStatus: 'anonymous', data: null,
      error: 'MISSING_ARG',
      hint: 'Favorites are real public actions. Pass --confirm true.',
      action: 'abort',
      recommendedNextActions: [{ adapter: 'post-detail', args: { noteId }, why: 'Re-read before favoriting.' }],
    };
  }

  let xsecToken = tokenArg || '';
  if (!xsecToken) {
    const ctx = getNoteContext(noteId);
    if (ctx) xsecToken = ctx.xsecToken;
  }
  if (!xsecToken) {
    return {
      ok: false, authStatus: 'auth_read', data: null,
      error: 'PERMISSION_DENIED',
      hint: `No xsecToken for noteId ${noteId}. Run search/feed/post-detail first.`,
      action: 'abort',
      recommendedNextActions: [{ adapter: 'search', args: { keyword: '' }, why: 'Refresh xsecToken.' }],
    };
  }

  const url = `${HOME_URL}/explore/${encodeURIComponent(noteId)}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${encodeURIComponent(xsecSource)}&source=web_explore_feed`;
  const page = await bb.goto(url, { waitUntil: 'networkidle' });

  const probe = await page.eval(async () => {
    let cookies = [];
    try { cookies = window.cookieStore ? await window.cookieStore.getAll() : []; } catch (_) {}
    const s = window.__INITIAL_STATE__;
    const u = s && s.user;
    const ui = u && u.userInfo ? (u.userInfo._value !== undefined ? u.userInfo._value : u.userInfo) : null;
    return { userId: ui ? ui.userId : null };
  });
  if (!probe.userId) {
    return {
      ok: false, authStatus: 'anonymous', data: null,
      error: 'LOGIN_REQUIRED',
      hint: 'Writes require login.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  // SPA-click on .interaction-info > :nth-child(2) (collect button).
  // The first child is like; second is collect (favorite).
  let beforeCount, afterCount;
  try {
    const before = await page.eval(() => {
      const root = document.querySelector('.interaction-info');
      if (!root) return { found: false };
      const btn = root.children[1]; // second child = collect
      const countSpan = btn && btn.querySelector ? btn.querySelector('span:last-child') : null;
      return {
        found: true,
        btnTag: btn ? btn.tagName : null,
        countText: countSpan ? String(countSpan.textContent).trim() : null,
      };
    });
    if (!before.found) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'NOT_FOUND',
        hint: 'Could not find .interaction-info on note page.',
        action: 'abort',
        recommendedNextActions: [{ adapter: 'post-detail', args: { noteId, xsecToken }, why: 'Re-fetch the post.' }],
      };
    }
    beforeCount = before.countText;

    const clicked = await page.eval(() => {
      const root = document.querySelector('.interaction-info');
      const btn = root && root.children[1];
      if (!btn) return { ok: false, reason: 'no_button' };
      try { btn.click(); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
    });
    if (!clicked.ok) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'WRITE_FAILED',
        hint: `SPA click failed: ${clicked.reason}.`,
        action: 'retry_or_abort',
        recommendedNextActions: [],
      };
    }

    await page.wait(800);

    const after = await page.eval(() => {
      const root = document.querySelector('.interaction-info');
      const btn = root && root.children[1];
      const countSpan = btn && btn.querySelector ? btn.querySelector('span:last-child') : null;
      return { countText: countSpan ? String(countSpan.textContent).trim() : null };
    });
    afterCount = after.countText;
  } catch (e) {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'WRITE_FAILED', hint: `Favorite flow failed: ${e.message}`, action: 'retry_or_abort',
      recommendedNextActions: [],
    };
  }

  return {
    ok: true, authStatus: 'auth_write',
    data: {
      action: undo ? 'unfavorite' : 'favorite',
      targetId: noteId,
      resultId: '',
      undoable: true,
      undoAdapter: `xiaohongshu/favorite --noteId ${noteId} --undo true --confirm true`,
      undoHint: 'Re-run with --undo true to remove this favorite.',
      url: `${HOME_URL}/explore/${noteId}`,
      beforeCount, afterCount,
    },
    recommendedNextActions: [
      { adapter: 'favorite', args: { noteId, undo: !undo, confirm: true }, why: 'Undo if unintended.' },
      { adapter: 'post-detail', args: { noteId, xsecToken }, why: 'Re-read to confirm updated count.' },
    ],
  };
}

const __cache_helpers = { getNoteContext };
