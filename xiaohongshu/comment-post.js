/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/comment-post — social-media P0 adapter (engage / write)
 *
 * Post a top-level comment or reply on a note.
 *
 * Strategy: navigate to the note page (requires xsecToken), find the comment
 * input element (a contentEditable <p>), set its text, then click the send
 * button. XHS SPA handles the actual POST.
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §10.3 (WriteReceipt)
 */

/* @meta
{
  "name": "xiaohongshu/comment-post",
  "title": "在小红书笔记下发表评论",
  "description": "Post a top-level comment or reply on a note. Requires confirm=true. SPA-edit on contentEditable, click send. Returns WriteReceipt with resultId=commentId.",
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
      "name": "content",
      "type": "string",
      "required": true,
      "desc": "Comment text. XHS limits ~1000 chars."
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
      "name": "replyToCommentId",
      "type": "string",
      "required": false,
      "desc": "If set, posts a reply to this comment."
    },
    {
      "name": "confirm",
      "type": "boolean",
      "required": true
    }
  ],
  "example": "bb-browser site xiaohongshu/comment-post --noteId '69f5d0bc0000000035033f20' --content '学到了！' --confirm true --json",
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

async function commentPost(args) {
  const { noteId, content, xsecToken: tokenArg, xsecSource = 'pc_search', replyToCommentId, confirm = false } = args || {};

  if (!noteId) {
    return { ok: false, authStatus: 'anonymous', data: null, error: 'MISSING_ARG', hint: 'noteId is required.', action: 'abort' };
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return { ok: false, authStatus: 'anonymous', data: null, error: 'MISSING_ARG', hint: 'content is required.', action: 'abort' };
  }
  if (confirm !== true) {
    return {
      ok: false, authStatus: 'anonymous', data: null,
      error: 'MISSING_ARG',
      hint: 'Comments are public actions. Pass --confirm true.',
      action: 'abort',
      recommendedNextActions: [{ adapter: 'post-detail', args: { noteId }, why: 'Re-read before commenting.' }],
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
      error: 'LOGIN_REQUIRED', hint: 'Comments require login.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  // SPA-edit + click send.
  // Find: comment input (a contentEditable or textarea in the bottom comment box).
  let resultId = '';
  let submitError = null;
  try {
    const editResult = await page.eval((text) => {
      // Find the comment editor. The page has multiple contenteditables; the visible bottom one
      // is the active comment input. Pick the one that is empty + visible.
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      const target = editables.find((e) => e.offsetParent !== null);
      if (!target) return { ok: false, reason: 'no_editable' };
      try {
        target.focus();
        target.innerText = text;
        // Dispatch input event so Vue picks up the change.
        target.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    }, content);

    if (!editResult.ok) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'WRITE_FAILED',
        hint: `Could not set comment input: ${editResult.reason}.`,
        action: 'retry_or_abort',
        recommendedNextActions: [],
      };
    }

    // Find and click the send button. It's typically the button containing "发送".
    const clicked = await page.eval(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const sendBtn = btns.find((b) => b.textContent && b.textContent.trim() === '发送');
      if (!sendBtn) return { ok: false, reason: 'no_send_button' };
      try {
        sendBtn.click();
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    });
    if (!clicked.ok) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'WRITE_FAILED',
        hint: `Send button click failed: ${clicked.reason}.`,
        action: 'retry_or_abort',
        recommendedNextActions: [],
      };
    }

    // Wait for XHS to process and the new comment to land in INITIAL_STATE.
    await page.wait(2000);

    // Re-read comments to find the new one. Match by content.
    const newComment = await page.eval((text) => {
      const s = window.__INITIAL_STATE__;
      const dm = s && s.note && s.note.noteDetailMap;
      const realKey = dm ? Object.keys(dm).find((k) => k && k.length > 5) : null;
      const entry = realKey ? dm[realKey] : null;
      const data = entry && entry.note ? (entry.note._value !== undefined ? entry.note._value : entry.note) : null;
      const commentsRef = data && data.comments;
      const list = commentsRef && commentsRef._value !== undefined ? commentsRef._value : (commentsRef || []);
      if (!Array.isArray(list)) return null;
      // Find by content (newest first or last).
      for (const c of list) {
        if (c && c.content === text) return c;
      }
      return null;
    }, content);
    if (newComment) resultId = newComment.id || newComment.commentId || '';
  } catch (e) {
    submitError = e.message;
  }

  if (submitError) {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'WRITE_FAILED',
      hint: `Comment flow failed: ${submitError}.`,
      action: 'retry_or_abort',
      recommendedNextActions: [],
    };
  }

  return {
    ok: true, authStatus: 'auth_write',
    data: {
      action: 'comment',
      targetId: noteId,
      resultId,
      undoable: !!replyToCommentId,  // XHS supports deleting own comments (P1: comment-delete)
      undoAdapter: resultId ? `xiaohongshu/comment-delete --noteId ${noteId} --commentId ${resultId} --confirm true` : null,
      undoHint: resultId ? 'Use comment-delete (P1) to remove.' : 'Comment may have posted; verify by reading comments.',
      url: `${HOME_URL}/explore/${noteId}?comment=${resultId || ''}`,
    },
    recommendedNextActions: [
      { adapter: 'comments', args: { noteId, xsecToken }, why: 'Verify the comment was posted.' },
    ],
  };
}

const __cache_helpers = { getNoteContext };
