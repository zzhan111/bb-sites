/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/comment-delete — social-media P1 adapter (manage / write)
 *
 * Delete one of your own comments. Strategy: navigate to the note's comment
 * area; find the comment by id; click 「...」 (more) on the comment; click
 * 「删除」; confirm.
 *
 * Requires `confirm: true`. Comment deletion is irreversible on XHS.
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §10.3 (WriteReceipt)
 */

/* @meta
{
  "name": "xiaohongshu/comment-delete",
  "title": "删除自己在小红书的评论",
  "description": "Delete one of your own comments on a note. P1 adapter. Requires confirm=true. Returns WriteReceipt.",
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
      "name": "commentId",
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
  "example": "bb-browser site xiaohongshu/comment-delete --noteId '69f5d0bc0000000035033f20' --commentId 'c1' --confirm true --json",
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

async function commentDelete(args) {
  const { noteId, commentId, xsecToken: tokenArg, xsecSource = 'pc_search', confirm = false } = args || {};

  if (!noteId) return { ok: false, authStatus: 'anonymous', data: null, error: 'MISSING_ARG', hint: 'noteId is required.', action: 'abort' };
  if (!commentId) return { ok: false, authStatus: 'anonymous', data: null, error: 'MISSING_ARG', hint: 'commentId is required.', action: 'abort' };
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
      recommendedNextActions: [{ adapter: 'comments', args: { noteId }, why: 'Refresh xsecToken.' }],
    };
  }

  const url = `${HOME_URL}/explore/${encodeURIComponent(noteId)}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${encodeURIComponent(xsecSource)}&source=web_explore_feed`;
  const page = await bb.goto(url, { waitUntil: 'networkidle' });

  // Login probe + comment ownership check
  const probe = await page.eval(async (targetNoteId, targetCommentId) => {
    let cookies = [];
    try { cookies = window.cookieStore ? await window.cookieStore.getAll() : []; } catch (_) {}
    const s = window.__INITIAL_STATE__;
    const u = s && s.user;
    const ui = u && u.userInfo ? (u.userInfo._value !== undefined ? u.userInfo._value : u.userInfo) : null;
    const dm = s && s.note && s.note.noteDetailMap;
    const realKey = dm ? Object.keys(dm).find((k) => k && k.length > 5) : null;
    const entry = realKey ? dm[realKey] : null;
    const data = entry && entry.note ? (entry.note._value !== undefined ? entry.note._value : entry.note) : null;
    const commentsRef = data && data.comments;
    const list = commentsRef && commentsRef._value !== undefined ? commentsRef._value : (commentsRef || []);
    let foundComment = null;
    if (Array.isArray(list)) {
      foundComment = list.find((c) => c && (c.id === targetCommentId || c.commentId === targetCommentId));
      // Also search sub-comments.
      if (!foundComment) {
        for (const c of list) {
          if (c && Array.isArray(c.subComments)) {
            foundComment = c.subComments.find((sc) => sc && (sc.id === targetCommentId || sc.commentId === targetCommentId));
            if (foundComment) break;
          }
        }
      }
    }
    return {
      userId: ui ? ui.userId : null,
      isOwner: !!(ui && foundComment && foundComment.userInfo && ui.userId === foundComment.userInfo.userId),
      found: !!foundComment,
    };
  }, noteId, commentId);

  if (!probe.userId) {
    return {
      ok: false, authStatus: 'anonymous', data: null,
      error: 'LOGIN_REQUIRED',
      hint: 'Deletion requires login.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }
  if (!probe.found) {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'NOT_FOUND',
      hint: `Comment ${commentId} not found on note ${noteId}.`,
      action: 'abort',
      recommendedNextActions: [{ adapter: 'comments', args: { noteId, xsecToken }, why: 'Re-list comments.' }],
    };
  }
  if (!probe.isOwner) {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'PERMISSION_DENIED',
      hint: `Comment ${commentId} is not yours.`,
      action: 'abort',
      recommendedNextActions: [],
    };
  }

  // Open the comment's more menu and click 删除.
  try {
    const opened = await page.evaluate((cid) => {
      // Find the comment container by id (XHS often adds data-comment-id).
      const commentEl = document.querySelector(`[data-comment-id="${cid}"]`)
        || Array.from(document.querySelectorAll('[class*="comment" i]')).find((el) => el.textContent && el.textContent.includes(cid));
      if (!commentEl) return { ok: false, reason: 'no_comment_element' };
      const buttons = commentEl.querySelectorAll('button, span, div');
      const menu = buttons[buttons.length - 1];  // last button is usually the more menu
      if (!menu) return { ok: false, reason: 'no_menu_button' };
      try { menu.click(); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
    }, commentId);
    if (!opened.ok) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'WRITE_FAILED',
        hint: `Could not open comment menu: ${opened.reason}.`,
        action: 'retry_or_abort',
        recommendedNextActions: [],
      };
    }
    await page.wait(500);

    const clickedDel = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, span, div, li'));
      const delBtn = candidates.find((el) => (el.textContent || '').trim() === '删除' || (el.textContent || '').trim() === '删除评论');
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
    await page.wait(1500);
  } catch (e) {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'WRITE_FAILED',
      hint: `Comment delete flow failed: ${e.message}.`,
      action: 'retry_or_abort',
      recommendedNextActions: [],
    };
  }

  return {
    ok: true, authStatus: 'auth_write',
    data: {
      action: 'delete',
      targetId: commentId,
      resultId: commentId,
      undoable: false,
      undoAdapter: null,
      undoHint: 'XHS does not support undelete.',
      url: `${HOME_URL}/explore/${noteId}?comment=${commentId}`,
    },
    recommendedNextActions: [
      { adapter: 'comments', args: { noteId, xsecToken }, why: 'Verify the comment was removed.' },
    ],
  };
}

const __cache_helpers = { getNoteContext };
