/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/comments — social-media P0 adapter (consume / read / list)
 *
 * Read top-level comments on a note.
 *
 * Data path: navigate to /explore/<noteId>?xsec_token=<token>&xsec_source=pc_search;
 * XHS SPA loads comments into INITIAL_STATE.note.noteDetailMap[noteId].comments.
 *
 * xhs-cli notes: the comments API path is /api/sns/web/v2/comment/page. The SPA
 * preloads the first page of comments into the Vuex store; pagination beyond
 * what the SPA preloaded requires the API. Adapter returns what the SPA provides.
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §5 (Comment) + §10.2
 */

/* @meta
{
  "name": "xiaohongshu/comments",
  "title": "读取小红书笔记评论",
  "description": "Read top-level comments on a note. Requires xsecToken (from prior search/feed/post-detail call). Reads from INITIAL_STATE.note.noteDetailMap[noteId].comments.",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": true,
  "prerequisites": "需先登录 xiaohongshu.com,需笔记 xsecToken",
  "args": [
    {
      "name": "noteId",
      "type": "string",
      "required": true
    },
    {
      "name": "xsecToken",
      "type": "string",
      "required": false,
      "desc": "Falls back to cache populated by search/feed/post-detail."
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
    }
  ],
  "example": "bb-browser site xiaohongshu/comments --noteId '69f5d0bc0000000035033f20' --json",
  "capabilities": [
    "read",
    "list",
    "network"
  ],
  "accessTier": "auth_read",
  "intent": "consume"
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

function mapXhsComment(raw, noteId) {
  if (!raw) return null;
  const userInfo = raw.userInfo || raw.user || {};
  const id = raw.id || raw.commentId || '';
  const nick = userInfo.nickName || userInfo.nickname || '';
  const uid = userInfo.userId || '';
  const interact = raw.interactInfo || {};
  const subComments = Array.isArray(raw.subComments) ? raw.subComments : [];
  return {
    id,
    noteId,
    author: {
      id: uid,
      nickname: nick,
      url: uid ? `${HOME_URL}/user/profile/${uid}` : '',
    },
    content: raw.content || '',
    stats: {
      likes: parseInt(interact.likedCount || '0', 10) || 0,
      subComments: subComments.length,
    },
    subComments: subComments.map((c) => mapXhsComment(c, noteId)).filter(Boolean),
    createdAt: raw.createTime ? new Date(parseInt(raw.createTime, 10)).toISOString() : null,
    ipLocation: raw.ipLocation || null,
    url: `${HOME_URL}/explore/${noteId}?comment=${id}`,
  };
}

async function comments(args) {
  const { noteId, xsecToken: tokenArg, xsecSource = 'pc_search' } = args || {};

  if (!noteId) {
    return {
      ok: false, authStatus: 'anonymous', data: null,
      error: 'MISSING_ARG', hint: 'noteId is required.', action: 'abort',
    };
  }

  // Resolve xsecToken
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

  // Login probe
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
      hint: 'Comments need a logged-in session.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  // Read comments from INITIAL_STATE.note.noteDetailMap[noteId].comments
  const raw = await page.eval((targetNoteId) => {
    const s = window.__INITIAL_STATE__;
    if (!s || !s.note) return { ok: false, reason: 'no_state' };
    const dm = s.note.noteDetailMap;
    const realKey = Object.keys(dm).find((k) => k && k.length > 5);
    const entry = realKey ? dm[realKey] : null;
    if (!entry) return { ok: false, reason: 'no_entry' };
    const noteRef = entry.note;
    const data = noteRef ? (noteRef._value !== undefined ? noteRef._value : noteRef) : null;
    if (!data) return { ok: false, reason: 'no_data' };
    const comments = data.comments;
    const commentList = comments && comments._value !== undefined ? comments._value : (comments || []);
    return {
      ok: true,
      noteId: data.noteId || realKey,
      realKey,
      comments: Array.isArray(commentList) ? commentList : [],
      totalCount: data.commentCount || (Array.isArray(commentList) ? commentList.length : 0),
    };
  }, noteId);

  if (!raw.ok) {
    return {
      ok: false, authStatus: 'auth_read', data: null,
      error: 'NOT_FOUND',
      hint: `Could not read comments for noteId ${noteId}: ${raw.reason}.`,
      action: 'abort',
      recommendedNextActions: [{ adapter: 'post-detail', args: { noteId, xsecToken }, why: 'Re-validate the note.' }],
    };
  }

  const list = raw.comments.map((c) => mapXhsComment(c, raw.noteId)).filter(Boolean);

  return {
    ok: true,
    authStatus: 'auth_read',
    data: list,
    constraints: {
      requestedConstraints: { noteId },
      executedConstraints:   { noteId, realKey: raw.realKey },
      deferredConstraints:   {},
    },
    pagination: {
      page: 1,
      pageSize: list.length,
      hasMore: list.length < raw.totalCount,
      cursor: '',
      nextArgs: list.length < raw.totalCount ? { noteId, xsecToken, page: 2 } : null,
    },
    recommendedNextActions: [
      { adapter: 'comment-post', args: { noteId, xsecToken, content: '', confirm: true }, why: 'Reply to this note.' },
    ],
  };
}

const __cache_helpers = { getNoteContext };
