/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/auth — social-media P0 adapter (manage / read)
 *
 * Reports current login state. NO side effects. NO auto-login (AGENTS.md #5).
 *
 * FIX LOG (SM-2.5 — discovered via runtime probe against real XHS):
 *   - Bug #1: `web_session` cookie does NOT exist on real XHS. Real session
 *     identity cookies are `a1` (long-lived, ~10y) + `webId` (device
 *     fingerprint). xhs-cli's "web_session" naming is stale/wrong.
 *   - Bug #2: `document.cookie` cannot see HttpOnly cookies. Must use
 *     `cookieStore.getAll()` (Cookie Store API).
 *   - Bug #3: `window.__INITIAL_STATE__.user.userInfo` is a Vue ref, not a
 *     plain object. Real data lives at `._value`. Same for `.search.feeds`,
 *     `.note`, etc.
 *   - Bug #4: MCP browser exposes native `window.fetch`, NOT a `bb.*`
 *     abstraction. adapter runs in page context, calls fetch directly.
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md
 */

/* @meta
{
  "name": "xiaohongshu/auth",
  "title": "检查小红书登录状态",
  "description": "Report current Xiaohongshu login state. Probes cookieStore + INITIAL_STATE.user (Vue ref). No auto-login.",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": true,
  "prerequisites": "无",
  "args": [],
  "example": "bb-browser site xiaohongshu/auth",
  "capabilities": [
    "read",
    "network"
  ],
  "accessTier": "anonymous",
  "intent": "manage"
}
*/

const HOME_URL = 'https://www.xiaohongshu.com';

// SM-2.5 fix: probe session via Cookie Store API (HttpOnly-aware) + Vue ref unpack.
async function probeLogin(page) {
  // 1. Cookie Store — handles HttpOnly that document.cookie can't see.
  let cookies = [];
  try {
    cookies = await page.eval(() => window.cookieStore ? window.cookieStore.getAll() : []);
  } catch (_) {
    cookies = [];
  }
  const cookieNames = cookies.map((c) => c.name);
  const a1 = cookies.find((c) => c.name === 'a1') || null;
  const webId = cookies.find((c) => c.name === 'webId') || null;

  // 2. INITIAL_STATE — Vue ref. userInfo real data at ._value.
  let userId = null, nickname = null, redId = null;
  try {
    const userProbe = await page.eval(() => {
      const s = window.__INITIAL_STATE__;
      const u = s && s.user;
      const uiRef = u && u.userInfo;
      if (!uiRef) return null;
      const ui = uiRef._value !== undefined ? uiRef._value : uiRef;
      return { userId: ui.userId || null, nickname: ui.nickName || ui.nickname || null, redId: ui.redId || null };
    });
    if (userProbe) {
      userId = userProbe.userId;
      nickname = userProbe.nickname;
      redId = userProbe.redId;
    }
  } catch (_) {
    // page may not have __INITIAL_STATE__ loaded yet
  }

  return { cookies, cookieNames, a1, webId, userId, nickname, redId };
}

async function auth() {
  // 1. Navigate to home (or current page if already there).
  const page = await bb.goto(HOME_URL, { waitUntil: 'domcontentloaded' });

  // 2. Probe login state.
  const probe = await probeLogin(page);

  // 3. Decision tree.
  if (probe.userId) {
    return {
      ok: true,
      authStatus: 'auth_read',
      data: {
        state: 'logged_in',
        userId: probe.userId,
        nickname: probe.nickname,
        redId: probe.redId,
        a1Present: !!probe.a1,
        webIdPresent: !!probe.webId,
        cookieCount: probe.cookies.length,
        profileUrl: `${HOME_URL}/user/profile/${probe.userId}`,
      },
      recommendedNextActions: [
        { adapter: 'search', args: { keyword: '咖啡推荐' }, why: 'Discover notes by keyword.' },
        { adapter: 'feed', args: { source: 'recommendation' }, why: 'See algorithmic feed.' },
        { adapter: 'user', args: { userId: probe.userId }, why: 'Read full profile.' },
      ],
    };
  }

  // Cookie present but server did not bind a user.
  if (probe.a1 || probe.cookieNames.length > 0) {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: { state: 'cookie_only_no_user', cookieCount: probe.cookies.length, a1: !!probe.a1 },
      error: 'AUTH_EXPIRED',
      hint: 'Browser has XHS cookies but the session was rejected by the server. Hand control to the human to re-login.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [],
    };
  }

  return {
    ok: false,
    authStatus: 'anonymous',
    data: { state: 'logged_out', cookieCount: 0 },
    error: 'LOGIN_REQUIRED',
    hint: 'No XHS cookies present. Hand control to the human to log in via xiaohongshu.com web UI.',
    action: 'stop_and_wait_for_human',
    recommendedNextActions: [],
  };
}
