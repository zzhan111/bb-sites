/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/user-notes — social-media P0 adapter (consume / read / list)
 *
 * Read a user's notes by collection type (published / liked / favorited).
 *
 * Three sub-lists mapped from xhs-cli:
 *   - whichList=published → INITIAL_STATE.user.notes (own notes)
 *                            + /user/profile/<id> page → INITIAL_STATE.user.userInfo.notes
 *   - whichList=liked     → INITIAL_STATE.user.likedNotes (own likes)
 *                            + /user/liked page
 *   - whichList=favorited → INITIAL_STATE.user.collectedNotes (own favorites)
 *                            + /user/collected page
 *
 * `whose=me` reads from current user's stores (always available after login).
 * `whose=other` navigates to a user profile and reads their `userInfo.notes` count;
 *   the actual list of *someone else's* notes requires /api/sns/web/v1/user_posted
 *   which XHS does NOT expose in INITIAL_STATE — adapter returns NOT_FOUND for that
 *   path until we add an API-driven variant.
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §4 (user-notes)
 */

/* @meta
{
  "name": "xiaohongshu/user-notes",
  "title": "查看小红书用户笔记列表",
  "description": "Read a user's notes by sub-list. whose=me|other, whichList=published|liked|favorited. Reads from INITIAL_STATE.user.{notes,likedNotes,collectedNotes} when whose=me.",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": true,
  "prerequisites": "需先登录 xiaohongshu.com",
  "args": [
    {
      "name": "whose",
      "type": "enum",
      "values": [
        "me",
        "other"
      ],
      "default": "me"
    },
    {
      "name": "whichList",
      "type": "enum",
      "values": [
        "published",
        "liked",
        "favorited"
      ],
      "default": "published"
    },
    {
      "name": "userId",
      "type": "string",
      "required": false,
      "desc": "Required when whose=other."
    }
  ],
  "example": "bb-browser site xiaohongshu/user-notes --whose me --whichList favorited --json",
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

function cacheNoteContext(note) {
  if (note && note.id && note.xsecToken) {
    noteContextCache.set(note.id, {
      xsecToken: note.xsecToken,
      source: 'pc_user_notes',
      fetchedAt: Date.now(),
    });
  }
}

function mapXhsFeedItem(item) {
  if (!item) return null;
  const nc = item.noteCard || {};
  const user = nc.user || {};
  const interact = nc.interactInfo || {};
  return {
    id: item.id || '',
    url: `${HOME_URL}/explore/${item.id || ''}?xsec_token=${item.xsecToken || ''}`,
    type: nc.type === 'video' ? 'video' : 'image',
    title: nc.displayTitle || nc.title || '',
    desc: '',
    author: {
      id: user.userId || '',
      nickname: user.nickName || user.nickname || '',
      url: user.userId ? `${HOME_URL}/user/profile/${user.userId}` : '',
    },
    tags: [],
    topics: [],
    stats: {
      likes: parseInt(interact.likedCount || '0', 10) || 0,
      likesLabel: String(interact.likedCount || '0'),
      collections: parseInt(interact.collectedCount || '0', 10) || 0,
      comments: parseInt(interact.commentCount || '0', 10) || 0,
      shares: parseInt(interact.sharedCount || '0', 10) || 0,
    },
    mediaCount: Array.isArray(nc.imageList) ? nc.imageList.length : (nc.cover ? 1 : 0),
    publishedAt: null,
    xsecToken: item.xsecToken || '',
    scrapedAt: new Date().toISOString(),
    _source: 'pc_user_notes',
  };
}

async function userNotes(args) {
  const { whose = 'me', whichList = 'published', userId } = args || {};

  if (whose === 'other' && !userId) {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: null,
      error: 'MISSING_ARG',
      hint: 'userId is required when whose=other.',
      action: 'abort',
    };
  }

  // Map whichList to URL + INITIAL_STATE key.
  const pathMap = {
    published: { url: '/user/notes', key: 'notes' },
    liked:     { url: '/user/liked',  key: 'likedNotes' },
    favorited: { url: '/user/collected', key: 'collectedNotes' },
  };
  const target = pathMap[whichList];
  if (!target) {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: null,
      error: 'MISSING_ARG',
      hint: `Invalid whichList: ${whichList}. Use one of: published|liked|favorited.`,
      action: 'abort',
    };
  }

  // Navigate to the relevant user-content page (only "me" works without API).
  let url;
  if (whose === 'me') {
    url = `${HOME_URL}${target.url}`;
  } else {
    // For whose=other, navigate to profile; the list data isn't in INITIAL_STATE for others.
    url = `${HOME_URL}/user/profile/${encodeURIComponent(userId)}`;
  }

  const page = await bb.goto(url, { waitUntil: 'networkidle' });

  // Login probe
  const probe = await page.eval(async () => {
    let cookies = [];
    try { cookies = window.cookieStore ? await window.cookieStore.getAll() : []; } catch (_) {}
    const s = window.__INITIAL_STATE__;
    const u = s && s.user;
    const ui = u && u.userInfo ? (u.userInfo._value !== undefined ? u.userInfo._value : u.userInfo) : null;
    return {
      a1: !!cookies.find((c) => c.name === 'a1'),
      userId: ui ? ui.userId : null,
    };
  });
  if (!probe.userId) {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: null,
      error: 'LOGIN_REQUIRED',
      hint: 'user-notes needs a logged-in session.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  if (whose === 'other') {
    // For other users, XHS SPA only loads profile summary, not full note lists.
    // We return the user's note count from userInfo.notes as a soft signal.
    const profile = await page.eval(() => {
      const u = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.user;
      const ui = u && u.userInfo ? (u.userInfo._value !== undefined ? u.userInfo._value : u.userInfo) : null;
      return ui ? { userId: ui.userId, nickname: ui.nickName || ui.nickname, notes: parseInt(ui.notes || '0', 10) || 0 } : null;
    });
    return {
      ok: false,
      authStatus: 'auth_read',
      data: profile,
      error: 'NOT_FOUND',
      hint: `whose=other+whichList=${whichList} requires direct API access (XHS does not expose /user_posted response in INITIAL_STATE for other users). Note count for userId ${userId} is ${profile ? profile.notes : '?'}.`,
      action: 'abort',
      recommendedNextActions: [
        { adapter: 'user', args: { userId }, why: 'See full profile with stats.' },
      ],
    };
  }

  // ----- Read the sub-list from INITIAL_STATE.user -----
  const rawFeeds = await page.eval((key) => {
    const u = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.user;
    if (!u) return [];
    const ref = u[key];
    const arr = ref && ref._value !== undefined ? ref._value : ref;
    return Array.isArray(arr) ? arr : [];
  }, target.key);

  if (!rawFeeds.length) {
    return {
      ok: false,
      authStatus: 'auth_read',
      data: null,
      error: 'NOT_FOUND',
      hint: `No notes found in INITIAL_STATE.user.${target.key} for whichList=${whichList}.`,
      action: 'abort',
      recommendedNextActions: [
        { adapter: 'user-notes', args: { whose: 'me', whichList: 'published' }, why: 'Try published list.' },
      ],
    };
  }

  const notes = rawFeeds.map(mapXhsFeedItem).filter(Boolean);
  notes.forEach(cacheNoteContext);

  return {
    ok: true,
    authStatus: 'auth_read',
    data: notes,
    constraints: {
      requestedConstraints: { whose, whichList, userId: userId || 'me' },
      executedConstraints:   { whose, whichList, userId: probe.userId },
      deferredConstraints:   {},
    },
    pagination: {
      page: 1,
      pageSize: notes.length,
      hasMore: notes.length >= 20,
      cursor: '',
      nextArgs: notes.length >= 20 ? { whose, whichList, userId } : null,
    },
    recommendedNextActions: notes.slice(0, 3).map((n) => ({
      adapter: 'post-detail',
      args: { noteId: n.id, xsecToken: n.xsecToken },
      why: `View full content of "${n.title || n.id}".`,
    })),
  };
}

const __cache_helpers = { cacheNoteContext };
