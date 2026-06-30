/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/feed — social-media P0 adapter (discover / read / list)
 *
 * Reads Xiaohongshu's home feed (algorithmic recommendation / hot / category /
 * following). Strategy: navigate to the home page; XHS SPA populates
 * `INITIAL_STATE.feed._value` (and per-source variants) with the feed array.
 * Adapter reads from the SPA's already-fetched data instead of re-querying.
 *
 * `source` arg selects which sub-feed to read:
 *   - "recommendation" — INITIAL_STATE.feed.feeds (default home feed)
 *   - "hot"            — INITIAL_STATE.feed.hotFeeds (trending list)
 *   - "category"       — INITIAL_STATE.feed.categoryFeeds (per-category)
 *   - "following"      — INITIAL_STATE.feed.followingFeeds (your follows)
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §4
 */

/* @meta
{
  "name": "xiaohongshu/feed",
  "title": "读取小红书首页推荐流",
  "description": "Read Xiaohongshu's home feed. source arg: recommendation|hot|category|following. Reads from INITIAL_STATE.feed._value/<subKey> populated by XHS SPA.",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": true,
  "prerequisites": "需先登录 xiaohongshu.com",
  "args": [
    {
      "name": "source",
      "type": "enum",
      "values": [
        "recommendation",
        "hot",
        "category",
        "following"
      ],
      "default": "recommendation"
    },
    {
      "name": "category",
      "type": "string",
      "required": false,
      "desc": "Category id (only for source=category). See adapter description for valid values."
    }
  ],
  "example": "bb-browser site xiaohongshu/feed --source hot --json",
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

const noteContextCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheNoteContext(note) {
  if (note && note.id && note.xsecToken) {
    noteContextCache.set(note.id, {
      xsecToken: note.xsecToken,
      source: 'pc_feed',
      fetchedAt: Date.now(),
    });
  }
}

// Map XHS feed item -> contract Note (same shape as search.js mapXhsFeedItem).
function mapXhsFeedItem(item) {
  if (!item) return null;
  const nc = item.noteCard || {};
  const user = nc.user || {};
  const interact = nc.interactInfo || {};
  const authorNick = user.nickName || user.nickname || '';
  const authorId = user.userId || '';
  return {
    id: item.id || '',
    url: `${HOME_URL}/explore/${item.id || ''}?xsec_token=${item.xsecToken || ''}`,
    type: nc.type === 'video' ? 'video' : 'image',
    title: nc.displayTitle || nc.title || '',
    desc: '',
    author: {
      id: authorId,
      nickname: authorNick,
      url: authorId ? `${HOME_URL}/user/profile/${authorId}` : '',
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
    _source: 'pc_feed',
  };
}

async function feed(args) {
  const { source = 'recommendation', category } = args || {};

  // ----- 1. Navigate to the feed page -----
  // Different sources use different URLs:
  //   recommendation → /
  //   hot            → /explore?channel=homefeed_recommend (or similar)
  //   category       → /explore?categoryId=...
  //   following      → /following or /explore?channel=...
  const targetUrl = (() => {
    switch (source) {
      case 'hot': return `${HOME_URL}/explore?channel=homefeed_hot`;
      case 'category': return `${HOME_URL}/explore?category_id=${encodeURIComponent(category || '')}`;
      case 'following': return `${HOME_URL}/following`;
      case 'recommendation':
      default: return `${HOME_URL}/`;
    }
  })();

  const page = await bb.goto(targetUrl, { waitUntil: 'networkidle' });

  // ----- 2. Login check -----
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
      hint: 'Feed needs a logged-in session.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  // ----- 3. Read feeds from INITIAL_STATE.feed -----
  // Each source maps to a different key in `feed.*`. Try them in order, falling back.
  const rawFeeds = await page.eval((src) => {
    const s = window.__INITIAL_STATE__;
    if (!s || !s.feed) return [];
    const f = s.feed;
    const keyMap = {
      recommendation: ['feeds', 'recommendFeeds'],
      hot: ['hotFeeds', 'feeds'],
      category: ['categoryFeeds', 'feeds'],
      following: ['followingFeeds', 'feeds'],
    };
    const candidates = keyMap[src] || ['feeds'];
    for (const k of candidates) {
      const v = f[k];
      if (v == null) continue;
      // Unwrap Vue ref if present.
      const arr = v._value !== undefined ? v._value : v;
      if (Array.isArray(arr) && arr.length) return arr;
      if (typeof arr === 'object' && arr !== null) {
        // Sometimes feed is nested by category — return first non-empty sub-array.
        for (const sub of Object.values(arr)) {
          const subArr = sub && sub._value !== undefined ? sub._value : sub;
          if (Array.isArray(subArr) && subArr.length) return subArr;
        }
      }
    }
    return [];
  }, source);

  if (!rawFeeds.length) {
    return {
      ok: false,
      authStatus: 'auth_read',
      data: null,
      error: 'NOT_FOUND',
      hint: `Feed source '${source}' returned no items. Try another source.`,
      action: 'abort',
      recommendedNextActions: [{ adapter: 'feed', args: { source: 'recommendation' }, why: 'Default feed.' }],
    };
  }

  const notes = rawFeeds.map(mapXhsFeedItem).filter(Boolean);
  notes.forEach(cacheNoteContext);

  const hasMore = notes.length >= 20;

  return {
    ok: true,
    authStatus: 'auth_read',
    data: notes,
    constraints: {
      requestedConstraints: { source, category: category || null },
      executedConstraints:   { source, category: category || 'n/a' },
      deferredConstraints:   {},
    },
    pagination: {
      page: 1,
      pageSize: notes.length,
      hasMore,
      cursor: '',
      nextArgs: hasMore ? { source, category } : null,
    },
    recommendedNextActions: notes.slice(0, 3).map((n) => ({
      adapter: 'post-detail',
      args: { noteId: n.id, xsecToken: n.xsecToken },
      why: `View full content of "${n.title || n.id}".`,
    })),
  };
}

const __cache_helpers = { cacheNoteContext };
