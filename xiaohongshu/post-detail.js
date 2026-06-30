/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/post-detail — social-media P0 adapter (consume / read / single)
 *
 * Fetch a single Xiaohongshu note's full content. Strategy: navigate directly
 * to the note's `/explore/<id>?xsec_token=<token>&xsec_source=pc_search` URL
 * (which is what XHS web UI emits when you click a search result). XHS SPA
 * loads, and the detail data lands in `INITIAL_STATE.note.noteDetailMap[noteId]`.
 *
 * Without the `xsec_token` URL param, XHS redirects `/explore/<id>` → `/explore`
 * (the home feed). The token must come from a prior `search` call.
 *
 * FIX LOG (SM-2.5):
 *   - Bug #14: navigating to `/explore/<id>` WITHOUT the xsec_token URL param
 *     silently redirects to `/explore`. Must include both `xsec_token` AND
 *     `xsec_source=pc_search` in the URL.
 *   - Real data path: `INITIAL_STATE.note.noteDetailMap[<noteId>].note._value`
 *     (real 24-char noteId, NOT a Vue ref wrapper at this level — though the
 *     parent `currentNoteId` IS a Vue ref).
 *   - Field schema: `noteCard` is replaced by `.note` at this level, with
 *     `title`, `desc` (full), `tagList` (with `type: "topic"` subitems),
 *     `interactInfo.likedCount`, etc.
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §10.2
 */

/* @meta
{
  "name": "xiaohongshu/post-detail",
  "title": "获取小红书笔记详情",
  "description": "Fetch a single Xiaohongshu note's full content (title, full desc, tags, author, stats). Requires the per-note xsecToken from a prior search/feed call. Navigates to /explore/<id>?xsec_token=<token>&xsec_source=pc_search and reads INITIAL_STATE.note.noteDetailMap[noteId].",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": true,
  "prerequisites": "需先登录 xiaohongshu.com,需笔记 xsecToken",
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
      "desc": "Per-note access token. Falls back to the cache populated by search."
    },
    {
      "name": "xsecSource",
      "type": "enum",
      "values": [
        "pc_search",
        "pc_feed",
        "pc_explore"
      ],
      "default": "pc_search",
      "desc": "Origin of the xsec token (matters for token rotation)"
    }
  ],
  "example": "bb-browser site xiaohongshu/post-detail --noteId '69f5d0bc0000000035033f20' --json",
  "capabilities": [
    "read",
    "network"
  ],
  "accessTier": "auth_read",
  "intent": "consume"
}
*/

const HOME_URL = 'https://www.xiaohongshu.com';

// xsecToken cache shared with search.js (module-scope, persists across adapter calls in the same MCP session).
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

function setNoteContext(noteId, ctx) {
  if (noteId && ctx && ctx.xsecToken) {
    noteContextCache.set(noteId, { ...ctx, fetchedAt: Date.now() });
  }
}

async function postDetail(args) {
  const { noteId, xsecToken: tokenArg, xsecSource = 'pc_search' } = args || {};

  // ----- 1. Validate -----
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

  // ----- 2. Resolve xsecToken (explicit arg > cache) -----
  let xsecToken = tokenArg || '';
  let tokenSource = tokenArg ? 'arg' : 'none';
  if (!xsecToken) {
    const ctx = getNoteContext(noteId);
    if (ctx) {
      xsecToken = ctx.xsecToken;
      tokenSource = `cache(${ctx.source || 'unknown'})`;
    }
  }
  if (!xsecToken) {
    return {
      ok: false,
      authStatus: 'auth_read',
      data: null,
      error: 'PERMISSION_DENIED',
      hint: `No xsecToken for noteId ${noteId}. Run 'search' or 'feed' first to obtain one.`,
      action: 'abort',
      recommendedNextActions: [
        { adapter: 'search', args: { keyword: '' }, why: 'Obtain note list with tokens.' },
        { adapter: 'feed', args: { source: 'recommendation' }, why: 'Or browse feed for tokens.' },
      ],
    };
  }

  // ----- 3. Navigate with xsec_token URL params (without them, XHS redirects to /explore) -----
  const url = `${HOME_URL}/explore/${encodeURIComponent(noteId)}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${encodeURIComponent(xsecSource)}&source=web_explore_feed`;
  const page = await bb.goto(url, { waitUntil: 'networkidle' });

  // ----- 4. Login probe (via cookieStore + Vue ref — mirrors auth.js) -----
  const probe = await page.eval(async () => {
    let cookies = [];
    try { cookies = window.cookieStore ? await window.cookieStore.getAll() : []; } catch (_) {}
    const a1 = cookies.find((c) => c.name === 'a1') || null;
    const s = window.__INITIAL_STATE__;
    const u = s && s.user;
    const uiRef = u && u.userInfo;
    const ui = uiRef ? (uiRef._value !== undefined ? uiRef._value : uiRef) : null;
    return { a1Present: !!a1, userId: ui ? ui.userId : null };
  });
  if (!probe.userId) {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: null,
      error: 'LOGIN_REQUIRED',
      hint: 'Detail view needs a logged-in session. Hand control to the human.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  // ----- 5. Read from INITIAL_STATE.note.noteDetailMap -----
  let raw;
  try {
    raw = await page.eval((targetNoteId) => {
      const s = window.__INITIAL_STATE__;
      if (!s || !s.note) return { error: 'no_note_state', url: location.href };
      const n = s.note;
      const dm = n.noteDetailMap;
      const cniVal = n.currentNoteId && n.currentNoteId._value !== undefined ? n.currentNoteId._value : null;
      // The real entry is keyed by the note's 24-char id, NOT by 'undefined' or ''.
      const realKey = Object.keys(dm).find((k) => k && k.length > 5);
      const entry = realKey ? dm[realKey] : null;
      const noteRef = entry && entry.note;
      const data = noteRef ? (noteRef._value !== undefined ? noteRef._value : noteRef) : null;
      if (!data) return { error: 'no_note_data', cniVal, realKey, keys: Object.keys(dm) };
      return {
        cniVal,
        realKey,
        title: data.title || '',
        desc: data.desc || '',
        noteId: data.noteId || realKey,
        type: data.type || 'normal',
        user: data.user ? { userId: data.user.userId, nickname: data.user.nickName || data.user.nickname, redId: data.user.redId, ipLocation: data.user.ipLocation } : null,
        tagList: Array.isArray(data.tagList) ? data.tagList : [],
        topicList: Array.isArray(data.topicList) ? data.topicList : [],
        interactInfo: data.interactInfo || {},
        time: data.time || null,
        lastUpdateTime: data.lastUpdateTime || null,
        imageList: Array.isArray(data.imageList) ? data.imageList : (Array.isArray(data.cover) ? data.cover : []),
        video: data.video || null,
      };
    }, noteId);
  } catch (e) {
    return {
      ok: false,
      authStatus: 'auth_read',
      data: null,
      error: 'SIGNATURE_FAILED',
      hint: `Could not read note state: ${e.message}.`,
      action: 'refresh_and_retry',
      recommendedNextActions: [],
    };
  }

  if (raw.error) {
    // If URL redirected to /explore without the noteId, the xsec_token was rejected.
    if (raw.cniVal === null || raw.realKey !== noteId) {
      return {
        ok: false,
        authStatus: 'auth_read',
        data: null,
        error: 'NOT_FOUND',
        hint: `noteId ${noteId} not found in INITIAL_STATE after navigation. The xsec_token may have expired or rotated. URL ended up at: ${raw.url || 'unknown'}.`,
        action: 'abort',
        recommendedNextActions: [
          { adapter: 'search', args: { keyword: '' }, why: 'Refresh xsecToken by running search again.' },
        ],
      };
    }
    return {
      ok: false,
      authStatus: 'auth_read',
      data: null,
      error: 'NOT_FOUND',
      hint: `Note state missing: ${raw.error}.`,
      action: 'abort',
      recommendedNextActions: [],
    };
  }

  // ----- 6. Map to contract Note (full shape) -----
  const user = raw.user || {};
  const interact = raw.interactInfo || {};
  const note = {
    id: raw.noteId || noteId,
    url: `${HOME_URL}/explore/${raw.noteId || noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${xsecSource}`,
    type: raw.type === 'video' ? 'video' : 'image',
    title: raw.title || '',
    desc: raw.desc || '',  // FULL desc — only available on detail
    author: {
      id: user.userId || '',
      nickname: user.nickname || '',
      url: user.userId ? `${HOME_URL}/user/profile/${user.userId}` : '',
    },
    tags: Array.isArray(raw.tagList)
      ? raw.tagList.map((t) => (typeof t === 'object' && t ? t.name : t)).filter(Boolean)
      : [],
    topics: Array.isArray(raw.topicList)
      ? raw.topicList.map((t) => ({ id: t.id || '', name: t.name || '' }))
      : [],
    stats: {
      likes: parseInt(interact.likedCount || '0', 10) || 0,
      likesLabel: String(interact.likedCount || '0'),
      collections: parseInt(interact.collectedCount || '0', 10) || 0,
      comments: parseInt(interact.commentCount || '0', 10) || 0,
      shares: parseInt(interact.sharedCount || '0', 10) || 0,
    },
    mediaCount: Array.isArray(raw.imageList) ? raw.imageList.length : (raw.video ? 1 : 0),
    publishedAt: raw.time ? new Date(raw.time).toISOString() : null,
    xsecToken,  // echo back
    scrapedAt: new Date().toISOString(),
  };

  // Refresh cache with the token we used.
  setNoteContext(note.id, { xsecToken, source: xsecSource });

  return {
    ok: true,
    authStatus: 'auth_read',
    data: note,
    recommendedNextActions: [
      { adapter: 'comments', args: { noteId: note.id, xsecToken }, why: 'Read engagement on this post.' },
      { adapter: 'like', args: { noteId: note.id, xsecToken, confirm: true }, why: 'Like this post.' },
      { adapter: 'favorite', args: { noteId: note.id, xsecToken, confirm: true }, why: 'Bookmark this post.' },
    ],
  };
}

const __cache_helpers = { getNoteContext, setNoteContext };
