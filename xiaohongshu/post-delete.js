/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/post-delete — social-media P1 adapter (manage / write)
 *
 * Delete one of your own published posts. Strategy: navigate to the post;
 * click 「...」 (more) menu in the top-right of the post detail page; click
 * 「删除」; confirm in the modal.
 *
 * Requires `confirm: true`. XHS hard-deletes (not just unpublishes) — there is
 * no undo on the platform. The author's profile and engagement metrics lose
 * the deleted post immediately.
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §10.3 (WriteReceipt)
 */

/* @meta
{
  "name": "xiaohongshu/post-delete",
  "title": "删除自己发布的小红书笔记",
  "description": "Hard-delete one of your own published posts. P1 adapter. Requires confirm=true. Opens the post, clicks the more menu, clicks 删除, confirms. Returns WriteReceipt.",
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
      "name": "confirm",
      "type": "boolean",
      "required": true
    }
  ],
  "example": "bb-browser site xiaohongshu/post-delete --noteId '69f5d0bc0000000035033f20' --confirm true --json",
  "capabilities": [
    "write",
    "network"
  ],
  "accessTier": "auth_write",
  "intent": "manage"
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

async function postDelete(args) {
  const { noteId, xsecToken: tokenArg, xsecSource = 'pc_search', confirm = false } = args || {};

  if (!noteId) {
    return { ok: false, authStatus: 'anonymous', data: null, error: 'MISSING_ARG', hint: 'noteId is required.', action: 'abort' };
  }
  if (confirm !== true) {
    return {
      ok: false, authStatus: 'anonymous', data: null,
      error: 'MISSING_ARG',
      hint: 'Deletion is irreversible on XHS. Pass --confirm true.',
      action: 'abort',
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
      hint: `No xsecToken for noteId ${noteId}.`,
      action: 'abort',
      recommendedNextActions: [{ adapter: 'search', args: { keyword: '' }, why: 'Refresh xsecToken.' }],
    };
  }

  const url = `${HOME_URL}/explore/${encodeURIComponent(noteId)}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${encodeURIComponent(xsecSource)}&source=web_explore_feed`;
  const page = await bb.goto(url, { waitUntil: 'networkidle' });

  // Login + ownership check
  const probe = await page.eval(async (targetNoteId) => {
    let cookies = [];
    try { cookies = window.cookieStore ? await window.cookieStore.getAll() : []; } catch (_) {}
    const s = window.__INITIAL_STATE__;
    const u = s && s.user;
    const ui = u && u.userInfo ? (u.userInfo._value !== undefined ? u.userInfo._value : u.userInfo) : null;
    const dm = s && s.note && s.note.noteDetailMap;
    const realKey = dm ? Object.keys(dm).find((k) => k && k.length > 5) : null;
    const entry = realKey ? dm[realKey] : null;
    const data = entry && entry.note ? (entry.note._value !== undefined ? entry.note._value : entry.note) : null;
    const ownerId = data && data.user ? data.user.userId : null;
    return {
      userId: ui ? ui.userId : null,
      isOwner: ui && ownerId && ui.userId === ownerId,
      ownerId,
      realNoteId: data ? data.noteId : null,
    };
  }, noteId);

  if (!probe.userId) {
    return {
      ok: false, authStatus: 'anonymous', data: null,
      error: 'LOGIN_REQUIRED',
      hint: 'Deletion requires login.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }
  if (!probe.isOwner) {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'PERMISSION_DENIED',
      hint: `Cannot delete post ${noteId} — not the author.`,
      action: 'abort',
      recommendedNextActions: [],
    };
  }

  // Open the more menu (...) and click 删除.
  try {
    const opened = await page.eval(() => {
      const candidates = Array.from(document.querySelectorAll('button, span, div, svg'));
      // Find the more menu icon. XHS uses "..." or a settings icon in the post header.
      const menuBtn = candidates.find((el) => {
        const t = (el.textContent || '').trim();
        const cl = String(el.className || '');
        return t === '...' || t === '···' || t === '更多' || /more/i.test(cl) || /ellipsis/i.test(cl);
      });
      if (!menuBtn) return { ok: false, reason: 'no_menu_button' };
      try { menuBtn.click(); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
    });
    if (!opened.ok) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'WRITE_FAILED',
        hint: `Could not open more menu: ${opened.reason}.`,
        action: 'retry_or_abort',
        recommendedNextActions: [],
      };
    }
    await page.wait(500);

    // Click 删除 (delete) in the dropdown.
    const clickedDel = await page.eval(() => {
      const candidates = Array.from(document.querySelectorAll('button, span, div, li'));
      const delBtn = candidates.find((el) => (el.textContent || '').trim() === '删除' || (el.textContent || '').trim() === '删除笔记');
      if (!delBtn) return { ok: false, reason: 'no_delete_option' };
      try { delBtn.click(); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
    });
    if (!clickedDel.ok) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'WRITE_FAILED',
        hint: `Could not click delete: ${clickedDel.reason}.`,
        action: 'retry_or_abort',
        recommendedNextActions: [],
      };
    }
    await page.wait(500);

    // Confirm in the modal: look for a confirmation button "确定" / "确认删除".
    const confirmed = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const confirmBtn = btns.find((b) => {
        const t = (b.textContent || '').trim();
        return t === '确定' || t === '确认' || t === '确认删除';
      });
      if (!confirmBtn) return { ok: false, reason: 'no_confirm_button' };
      try { confirmBtn.click(); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
    });
    if (!confirmed.ok) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'WRITE_FAILED',
        hint: `Could not confirm delete: ${confirmed.reason}.`,
        action: 'retry_or_abort',
        recommendedNextActions: [],
      };
    }
    await page.wait(2000);
  } catch (e) {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'WRITE_FAILED',
      hint: `Delete flow failed: ${e.message}.`,
      action: 'retry_or_abort',
      recommendedNextActions: [],
    };
  }

  return {
    ok: true, authStatus: 'auth_write',
    data: {
      action: 'delete',
      targetId: noteId,
      resultId: noteId,
      undoable: false,  // XHS hard-deletes; no undo
      undoAdapter: null,
      undoHint: 'XHS does not support undelete. Repost if needed.',
      url: `${HOME_URL}/explore/${noteId}`,
    },
    recommendedNextActions: [
      { adapter: 'user-notes', args: { whose: 'me', whichList: 'published' }, why: 'Verify the post was removed.' },
    ],
  };
}

const __cache_helpers = { getNoteContext };
