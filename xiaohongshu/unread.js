/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/unread — social-media P0 adapter (consume / read)
 *
 * Returns unread notification counts by tab.
 *
 * Data path: navigate to /notification; XHS SPA exposes unread counts as either
 *   - INITIAL_STATE.notification.unread  (single number)
 *   - INITIAL_STATE.notification.unreadCount
 *   - Per-tab counts in notification._value.<tab>.unreadCount
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §4
 */

/* @meta
{
  "name": "xiaohongshu/unread",
  "title": "查询小红书未读消息数",
  "description": "Return unread notification counts (total + per tab). Navigates to /notification and reads INITIAL_STATE.notification.unread(s).",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": true,
  "prerequisites": "需先登录 xiaohongshu.com",
  "args": [],
  "example": "bb-browser site xiaohongshu/unread --json",
  "capabilities": [
    "read",
    "network"
  ],
  "accessTier": "auth_read",
  "intent": "consume"
}
*/

const HOME_URL = 'https://www.xiaohongshu.com';

async function unread() {
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
      hint: 'unread needs a logged-in session.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  const counts = await page.eval(() => {
    const out = { total: 0, mentions: 0, likes: 0, connections: 0 };
    const n = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.notification;
    if (!n) return out;
    const inner = n._value !== undefined ? n._value : n;
    const tabNames = ['mentions', 'likes', 'connections'];
    // First try inner.unread total
    if (typeof inner.unread === 'number') out.total = inner.unread;
    if (typeof inner.unreadCount === 'number') out.total = inner.unreadCount;
    // Per-tab: inner.<tab>.unread or .unreadCount
    for (const t of tabNames) {
      const tab = inner[t];
      if (tab && typeof tab === 'object') {
        if (typeof tab.unread === 'number') out[t] = tab.unread;
        else if (typeof tab.unreadCount === 'number') out[t] = tab.unreadCount;
      }
    }
    // Fallback: sum from arrays' read=false counts
    if (!out.total) {
      let total = 0;
      for (const t of tabNames) {
        const tab = inner[t];
        if (tab && Array.isArray(tab)) {
          const unreadInTab = tab.filter((m) => m && !m.read).length;
          out[t] = unreadInTab;
          total += unreadInTab;
        } else if (tab && tab._value && Array.isArray(tab._value)) {
          const unreadInTab = tab._value.filter((m) => m && !m.read).length;
          out[t] = unreadInTab;
          total += unreadInTab;
        }
      }
      out.total = total;
    }
    return out;
  });

  return {
    ok: true,
    authStatus: 'auth_read',
    data: counts,
    recommendedNextActions: [
      { adapter: 'notifications', args: {}, why: 'Read unread items.' },
    ],
  };
}
