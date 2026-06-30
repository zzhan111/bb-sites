/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/search — social-media P0 adapter (discover / read / list)
 *
 * Search Xiaohongshu notes. Strategy: navigate to /search_result?keyword=...
 * (XHS SPA loads + populates Vuex store with the result list), then read from
 * `window.__INITIAL_STATE__.search.feeds._value` — a 44-element array of note
 * summaries that XHS already paid the API cost to populate.
 *
 * This bypasses all signing/cookie complications because we're reading what
 * XHS already fetched for us via its own UI.
 *
 * FIX LOG (SM-2.5):
 *   - The xhs-cli SKILL.md claims xhs-cli uses POST /api/sns/web/v1/search/notes
 *     directly. Reproducing that from the MCP browser triggers XHS code 300011
 *     (anti-automation / 风控) because we can't synthesize the full 5-header
 *     signature (x-s/x-s-common/x-t/x-b3-traceid/x-xray-traceid) reliably.
 *   - The SPA-rendered path is BOTH safer (we use XHS's own UI request) AND
 *     better aligned with the contract's "agent is the primary user" principle
 *     — the agent rides the user's existing browser session, never impersonating.
 *   - Note schema uses camelCase (noteCard / interactInfo / likedCount), not the
 *     snake_case the xhs-cli SKILL.md assumed. xhs-cli recon is stale.
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §10.1
 */

/* @meta
{
  "name": "xiaohongshu/search",
  "title": "搜索小红书笔记",
  "description": "Search Xiaohongshu notes by keyword/topic/hashtag. Strategy: navigate to XHS search_result page; XHS SPA populates Vuex store; adapter reads from window.__INITIAL_STATE__.search.feeds._value. No direct API call (avoids anti-automation).",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": true,
  "prerequisites": "需先登录 xiaohongshu.com",
  "args": [
    {
      "name": "keyword",
      "type": "string",
      "required": true,
      "desc": "Search term, topic name, or #hashtag"
    },
    {
      "name": "sort",
      "type": "enum",
      "values": [
        "general",
        "latest"
      ],
      "default": "general"
    },
    {
      "name": "type",
      "type": "enum",
      "values": [
        "image",
        "video"
      ]
    }
  ],
  "example": "bb-browser site xiaohongshu/search --keyword '咖啡推荐' --json",
  "capabilities": [
    "read",
    "list",
    "network"
  ],
  "accessTier": "auth_read",
  "intent": "discover"
}
*/

const HOME_URL = 'https://www.xiaohongshu.com';

// Module-scope xsecToken cache (populated by search, consulted by detail/like).
const noteContextCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheNoteContext(note) {
  if (note && note.id && note.xsecToken) {
    noteContextCache.set(note.id, {
      xsecToken: note.xsecToken,
      source: 'pc_search',
      fetchedAt: Date.now(),
    });
  }
}

function getNoteContext(noteId) {
  const ctx = noteContextCache.get(noteId);
  if (!ctx) return null;
  if (Date.now() - ctx.fetchedAt > CACHE_TTL_MS) {
    noteContextCache.delete(noteId);
    return null;
  }
  return ctx;
}

// SM-2.5 fix: real XHS schema is camelCase. Map XHS Vuex feed item -> contract Note.
function mapXhsFeedItem(item) {
  if (!item) return null;
  const nc = item.noteCard || {};
  const user = nc.user || {};
  const interact = nc.interactInfo || {};
  // XHS uses BOTH 'nickName' (camelCase) and 'nickname' — prefer camelCase.
  const authorNick = user.nickName || user.nickname || '';
  const authorId = user.userId || '';
  return {
    id: item.id || '',
    url: `${HOME_URL}/explore/${item.id || ''}?xsec_token=${item.xsecToken || ''}`,
    type: nc.type === 'video' ? 'video' : 'image',
    title: nc.displayTitle || nc.title || '',
    desc: '',  // list adapters omit full desc per contract §10.1
    author: {
      id: authorId,
      nickname: authorNick,
      url: authorId ? `${HOME_URL}/user/profile/${authorId}` : '',
    },
    tags: [],  // not exposed on feed items
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
    xsecToken: item.xsecToken || '',  // PER-NOTE TOKEN — top-level on feed item.
    scrapedAt: new Date().toISOString(),
    _source: 'pc_search',
  };
}

async function search(args) {
  const { keyword, sort = 'general', type } = args || {};

  // ----- 1. Arg validation -----
  if (!keyword || typeof keyword !== 'string') {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: null,
      error: 'MISSING_ARG',
      hint: 'keyword is required.',
      action: 'abort',
    };
  }

  // ----- 2. Navigate to XHS search page — SPA populates Vuex store -----
  const searchUrl = `${HOME_URL}/search_result?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed&type=${type === 'video' ? 'video' : (type === 'image' ? 'image' : '51')}`;
  const page = await bb.goto(searchUrl, { waitUntil: 'networkidle' });

  // ----- 3. Login check via cookieStore + Vue ref (mirrors auth adapter) -----
  const probe = await page.eval(async () => {
    let cookies = [];
    try { cookies = window.cookieStore ? await window.cookieStore.getAll() : []; } catch (_) {}
    const a1 = cookies.find((c) => c.name === 'a1') || null;
    const s = window.__INITIAL_STATE__;
    const u = s && s.user;
    const uiRef = u && u.userInfo;
    const ui = uiRef ? (uiRef._value !== undefined ? uiRef._value : uiRef) : null;
    return {
      a1Present: !!a1,
      userId: ui ? ui.userId : null,
      feedsCount: (() => {
        try {
          const sf = s && s.search;
          if (!sf) return 0;
          const feedsRef = sf.feeds;
          const arr = feedsRef && feedsRef._value !== undefined ? feedsRef._value : (feedsRef || []);
          return Array.isArray(arr) ? arr.length : 0;
        } catch (_) { return 0; }
      })(),
    };
  });

  if (!probe.userId) {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: null,
      error: 'LOGIN_REQUIRED',
      hint: 'Search needs a logged-in session. Run `auth`, then hand control to the human to log in.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  // ----- 4. Read results from Vuex store (XHS already paid the API cost) -----
  let rawFeeds;
  try {
    rawFeeds = await page.eval(() => {
      const sf = window.__INITIAL_STATE__.search;
      if (!sf) return [];
      const feedsRef = sf.feeds;
      const arr = feedsRef && feedsRef._value !== undefined ? feedsRef._value : (feedsRef || []);
      return Array.isArray(arr) ? arr : [];
    });
  } catch (e) {
    return {
      ok: false,
      authStatus: 'auth_read',
      data: null,
      error: 'SIGNATURE_FAILED',
      hint: `Could not read XHS Vuex store: ${e.message}. The search page may not have loaded.`,
      action: 'refresh_and_retry',
      recommendedNextActions: [],
    };
  }

  if (!rawFeeds.length) {
    return {
      ok: false,
      authStatus: 'auth_read',
      data: null,
      error: 'NOT_FOUND',
      hint: `No results in Vuex store for keyword "${keyword}". Try a different keyword or check the XHS page loaded.`,
      action: 'abort',
      recommendedNextActions: [
        { adapter: 'search', args: { keyword: '推荐' }, why: 'Try a common keyword.' },
      ],
    };
  }

  // ----- 5. Filter + map -----
  const filtered = type
    ? rawFeeds.filter((f) => (f.noteCard && f.noteCard.type) === (type === 'video' ? 'video' : 'normal'))
    : rawFeeds;
  const notes = filtered.map(mapXhsFeedItem).filter(Boolean);
  notes.forEach(cacheNoteContext);

  // ----- 6. Constraints + pagination + next actions -----
  const hasMore = notes.length >= 20;
  return {
    ok: true,
    authStatus: 'auth_read',
    data: notes,
    constraints: {
      requestedConstraints: { keyword, sort, type: type || null },
      executedConstraints:   { keyword, sort, type: type || 'all' },
      deferredConstraints:   {},
    },
    pagination: {
      page: 1,
      pageSize: notes.length,
      hasMore,
      cursor: '',
      nextArgs: hasMore ? { keyword, sort, type } : null,
    },
    recommendedNextActions: notes.slice(0, 3).map((n) => ({
      adapter: 'post-detail',
      args: { noteId: n.id, xsecToken: n.xsecToken },
      why: `View full content of "${n.title || n.id}".`,
    })),
  };
}

// Export helpers so post-detail and like adapters can share the cache.
const __cache_helpers = { getNoteContext, cacheNoteContext };
