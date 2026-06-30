/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/notifications — social-media P0 adapter (consume / read / list)
 *
 * Read the notification feed (mentions, likes, new followers).
 *
 * Data path: navigate to /notification; XHS SPA loads INITIAL_STATE.notification
 * with message lists (mentions/likes/connections).
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §4
 */

/* @meta
{
  "name": "xiaohongshu/notifications",
  "title": "读取小红书通知消息",
  "description": "Read the notification feed (mentions/likes/connections). Navigates to /notification; reads from INITIAL_STATE.notification.<messages|messagesMap>.",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": true,
  "prerequisites": "需先登录 xiaohongshu.com",
  "args": [
    {
      "name": "tab",
      "type": "enum",
      "values": [
        "all",
        "mentions",
        "likes",
        "connections"
      ],
      "default": "all"
    }
  ],
  "example": "bb-browser site xiaohongshu/notifications --json",
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

function mapXhsNotification(raw) {
  if (!raw) return null;
  const user = raw.userInfo || raw.user || {};
  const target = raw.targetNote || raw.targetUser || {};
  return {
    id: raw.id || raw.noticeId || '',
    type: raw.type || raw.noticeType || 'unknown',
    content: raw.content || raw.title || '',
    actor: {
      id: user.userId || '',
      nickname: user.nickName || user.nickname || '',
      url: user.userId ? `${HOME_URL}/user/profile/${user.userId}` : '',
    },
    target: target.id ? {
      id: target.id,
      type: target.type || 'note',
      title: target.title || '',
      url: target.url || `${HOME_URL}/explore/${target.id}`,
    } : null,
    createdAt: raw.createTime ? new Date(parseInt(raw.createTime, 10)).toISOString() : null,
    read: !!raw.read,
  };
}

async function notifications(args) {
  const { tab = 'all' } = args || {};

  const page = await bb.goto(`${HOME_URL}/notification`, { waitUntil: 'networkidle' });

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
      hint: 'Notifications need a logged-in session.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  // Read notifications from INITIAL_STATE.notification
  const raw = await page.eval((t) => {
    const n = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.notification;
    if (!n) return { ok: false, reason: 'no_state', tabs: [] };
    const inner = n._value !== undefined ? n._value : n;
    const tabKeyMap = {
      all:        ['all', 'messages', 'mentions', 'likes', 'connections'],
      mentions:   ['mentions', 'all'],
      likes:      ['likes', 'all'],
      connections:['connections', 'all'],
    };
    const candidates = tabKeyMap[t] || ['all'];
    const foundTabs = [];
    for (const k of candidates) {
      const v = inner[k];
      if (v == null) continue;
      const arr = v._value !== undefined ? v._value : v;
      if (Array.isArray(arr) && arr.length) {
        foundTabs.push({ tab: k, count: arr.length });
      }
    }
    // Pull the first non-empty tab.
    for (const k of candidates) {
      const v = inner[k];
      if (v == null) continue;
      const arr = v._value !== undefined ? v._value : v;
      if (Array.isArray(arr)) return { ok: true, tab: k, items: arr };
    }
    // Try the allMessages / messageList / nested shapes.
    if (inner.messages) {
      const m = inner.messages;
      const arr = m._value !== undefined ? m._value : m;
      if (Array.isArray(arr)) return { ok: true, tab: 'messages', items: arr };
    }
    if (inner.messageMap) {
      const flat = [];
      for (const v of Object.values(inner.messageMap)) {
        const arr = v && v._value !== undefined ? v._value : v;
        if (Array.isArray(arr)) flat.push(...arr);
      }
      if (flat.length) return { ok: true, tab: 'messageMap', items: flat };
    }
    return { ok: false, reason: 'no_items', tabs: foundTabs };
  }, tab);

  if (!raw.ok) {
    return {
      ok: false, authStatus: 'auth_read', data: null,
      error: 'NOT_FOUND',
      hint: `No notifications found in INITIAL_STATE.notification. Available tabs: ${raw.tabs ? raw.tabs.map(t => t.tab).join(',') : 'none'}.`,
      action: 'abort',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  const items = raw.items.map(mapXhsNotification).filter(Boolean);

  return {
    ok: true, authStatus: 'auth_read', data: items,
    constraints: {
      requestedConstraints: { tab },
      executedConstraints:   { tab: raw.tab },
      deferredConstraints:   {},
    },
    pagination: {
      page: 1,
      pageSize: items.length,
      hasMore: items.length >= 20,
      cursor: '',
      nextArgs: items.length >= 20 ? { tab } : null,
    },
    recommendedNextActions: [
      { adapter: 'unread', args: {}, why: 'See unread counts.' },
    ],
  };
}
