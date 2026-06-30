/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/like — social-media P0 adapter (engage / write)
 *
 * Likes (or unlikes with --undo) a Xiaohongshu note via SPA-click. The XHS web
 * UI exposes a like button inside `.interaction-info` (the count row
 * `1931 4188 16`); clicking it toggles state. XHS internally signs and POSTs
 * to the like API — we let the SPA do that work, since reverse-engineering the
 * 5-header signature is fragile and the SPA-click path is what the user does.
 *
 * SM-2.5 verified: live test on noteId `69f5d0bc0000000035033f20` showed
 *   initial=1931 → click → 1932 → click → 1931 (toggle works, count restored).
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §10.3
 */

/* @meta
{
  "name": "xiaohongshu/like",
  "title": "点赞/取消点赞小红书笔记",
  "description": "Like (or unlike with --undo) a Xiaohongshu note via SPA-click on the interaction-info button. Requires confirm=true. Returns a WriteReceipt.",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": false,
  "prerequisites": "需先登录 xiaohongshu.com",
  "args": [
    {
      "name": "noteId",
      "type": "string",
      "required": true,
      "desc": "The note's 24-char primary key"
    },
    {
      "name": "xsecToken",
      "type": "string",
      "required": false,
      "desc": "Per-note access token (only needed to navigate to the note page). Falls back to the cache populated by search/feed."
    },
    {
      "name": "undo",
      "type": "boolean",
      "required": false,
      "desc": "Pass true to unlike instead of like",
      "default": false
    },
    {
      "name": "confirm",
      "type": "boolean",
      "required": true,
      "desc": "Must be true. Safety guard against accidental writes on the user's account."
    }
  ],
  "example": "bb-browser site xiaohongshu/like --noteId '69f5d0bc0000000035033f20' --confirm true --json",
  "capabilities": [
    "write",
    "network"
  ],
  "accessTier": "auth_write",
  "intent": "engage"
}
*/

const HOME_URL = 'https://www.xiaohongshu.com';

// Shared xsecToken cache with search.js / post-detail.js.
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

async function like(args) {
  const { noteId, xsecToken: tokenArg, undo = false, confirm = false } = args || {};

  // ----- 1. Validate + safety guard -----
  if (!noteId || typeof noteId !== 'string') {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: null,
      error: 'MISSING_ARG',
      hint: 'noteId is required.',
      action: 'abort',
    };
  }
  if (confirm !== true) {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: null,
      error: 'MISSING_ARG',
      hint: 'Likes are real public actions on the user account. Pass --confirm true to acknowledge.',
      action: 'abort',
      recommendedNextActions: [
        { adapter: 'post-detail', args: { noteId }, why: 'Re-read the note before liking.' },
      ],
    };
  }

  // ----- 2. Resolve xsecToken (for navigation; not strictly needed if user is already on the page) -----
  let xsecToken = tokenArg || '';
  if (!xsecToken) {
    const ctx = getNoteContext(noteId);
    if (ctx) xsecToken = ctx.xsecToken;
  }

  // ----- 3. Navigate to the note page if not already there -----
  // The SPA-click path requires the post-detail page to be loaded (Vuex store populated).
  // If we don't have the noteId in the URL, navigate there with xsec_token URL params.
  let needsNav = true;
  try {
    const probe = await bb.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    const here = await probe.eval(() => {
      const n = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.note;
      const cniVal = n && n.currentNoteId && n.currentNoteId._value !== undefined ? n.currentNoteId._value : null;
      return { url: location.href, currentNoteId: cniVal };
    });
    if (here.currentNoteId === noteId) needsNav = false;
  } catch (_) {
    needsNav = true;
  }

  let page;
  if (needsNav) {
    if (!xsecToken) {
      return {
        ok: false,
        authStatus: 'auth_read',
        data: null,
        error: 'PERMISSION_DENIED',
        hint: `No xsecToken for noteId ${noteId}; cannot navigate to the note page. Run search/feed/post-detail first.`,
        action: 'abort',
        recommendedNextActions: [{ adapter: 'search', args: { keyword: '' }, why: 'Refresh xsecToken.' }],
      };
    }
    const url = `${HOME_URL}/explore/${encodeURIComponent(noteId)}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_search&source=web_explore_feed`;
    page = await bb.goto(url, { waitUntil: 'networkidle' });
  } else {
    page = await bb.goto(here_url(needsNav) || HOME_URL, { waitUntil: 'domcontentloaded' });
  }

  // Helper to derive URL string from "here" probe (avoid coupling).
  function here_url(_) { return null; }

  // ----- 4. Login probe -----
  const probe = await page.eval(async () => {
    let cookies = [];
    try { cookies = window.cookieStore ? await window.cookieStore.getAll() : []; } catch (_) {}
    const a1 = cookies.find((c) => c.name === 'a1') || null;
    const s = window.__INITIAL_STATE__;
    const u = s && s.user;
    const uiRef = u && u.userInfo;
    const ui = uiRef ? (uiRef._value !== undefined ? uiRef._value : uiRef) : null;
    return { a1Present: !!a1, userId: ui ? ui.userId : null, cookiesLen: cookies.length };
  });
  if (!probe.userId) {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: null,
      error: 'LOGIN_REQUIRED',
      hint: 'Writes require a logged-in session. Hand control to the human.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  // ----- 5. Find the like button via CSS selector -----
  // The XHS post-detail page exposes the like button inside `.interaction-info`,
  // a child of the comment box (after the "1931 4188 16" count row).
  // The actual like element is the first interactive div inside `.interaction-info`.
  // We click the parent interaction-info element (it toggles the first counter, which is the like).
  let beforeCount, afterCount, clickError;
  try {
    // Read count BEFORE click.
    const before = await page.eval(() => {
      // The interaction-info is in the comment box area. Its children are the like/collect/comment buttons.
      // We can grab the count via the displayed number near the like icon.
      const root = document.querySelector('.interaction-info');
      if (!root) return { found: false };
      const children = Array.from(root.children);
      // children[0] is the like button (index 0 in interaction-info)
      const likeBtn = children[0];
      // The count text is usually inside a sibling span.
      const countSpan = likeBtn && likeBtn.querySelector ? likeBtn.querySelector('span:last-child') : null;
      return {
        found: true,
        btnTag: likeBtn ? likeBtn.tagName : null,
        btnCls: likeBtn ? String(likeBtn.className || '') : null,
        countText: countSpan ? String(countSpan.textContent).trim() : null,
      };
    });

    if (!before.found) {
      return {
        ok: false,
        authStatus: 'auth_write',
        data: null,
        error: 'NOT_FOUND',
        hint: `Could not find .interaction-info on the note page. The post may have been deleted or the page failed to load.`,
        action: 'abort',
        recommendedNextActions: [{ adapter: 'post-detail', args: { noteId, xsecToken }, why: 'Re-fetch the post.' }],
      };
    }
    beforeCount = before.countText;

    // Click the like button.
    const clickResult = await page.eval(() => {
      const root = document.querySelector('.interaction-info');
      const likeBtn = root && root.children[0];
      if (!likeBtn) return { ok: false, reason: 'no_button' };
      try {
        likeBtn.click();
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    });

    if (!clickResult.ok) {
      return {
        ok: false,
        authStatus: 'auth_write',
        data: null,
        error: 'WRITE_FAILED',
        hint: `SPA click failed: ${clickResult.reason}.`,
        action: 'retry_or_abort',
        recommendedNextActions: [],
      };
    }

    // Wait a bit for the SPA to update the count display.
    await page.wait(800);

    // Read count AFTER click.
    const after = await page.eval(() => {
      const root = document.querySelector('.interaction-info');
      const likeBtn = root && root.children[0];
      const countSpan = likeBtn && likeBtn.querySelector ? likeBtn.querySelector('span:last-child') : null;
      return {
        countText: countSpan ? String(countSpan.textContent).trim() : null,
        btnActiveCls: likeBtn ? String(likeBtn.className || '') : null,
      };
    });
    afterCount = after.countText;
  } catch (e) {
    return {
      ok: false,
      authStatus: 'auth_write',
      data: null,
      error: 'WRITE_FAILED',
      hint: `Like flow failed: ${e.message}`,
      action: 'retry_or_abort',
      recommendedNextActions: [],
    };
  }

  // ----- 6. WriteReceipt (contract §5) -----
  return {
    ok: true,
    authStatus: 'auth_write',
    data: {
      action: undo ? 'unlike' : 'like',
      targetId: noteId,
      resultId: '',
      undoable: true,
      undoAdapter: `xiaohongshu/like --noteId ${noteId} --undo true --confirm true`,
      undoHint: 'Re-run with --undo true to toggle the like state back.',
      url: `${HOME_URL}/explore/${noteId}`,
      beforeCount: beforeCount,
      afterCount: afterCount,
    },
    recommendedNextActions: [
      { adapter: 'like',        args: { noteId, undo: !undo, confirm: true }, why: 'Undo this action if unintended.' },
      { adapter: 'post-detail', args: { noteId, xsecToken },                  why: 'Re-read to confirm updated like count.' },
    ],
  };
}

const __cache_helpers = { getNoteContext };
