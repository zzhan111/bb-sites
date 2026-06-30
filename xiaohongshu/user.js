/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/user — social-media P0 adapter (consume / read)
 *
 * Read a user's profile (nickname, redId, stats, ipLocation).
 *
 * Two paths:
 *   - userId == "me" (or omitted) → read INITIAL_STATE.user.userInfo._value
 *     (the SPA always includes the current user's info).
 *   - userId == other → navigate to /user/profile/<userId>; the SPA loads
 *     INITIAL_STATE.user.userInfo into the same path (XHS reuses userInfo
 *     for both self and other).
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §5 (User object)
 */

/* @meta
{
  "name": "xiaohongshu/user",
  "title": "查看小红书用户资料",
  "description": "Read a Xiaohongshu user's profile. userId defaults to 'me' (the logged-in user). Returns nickname, redId, desc, ipLocation, stats (fans/follows/interaction).",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": true,
  "prerequisites": "需先登录 xiaohongshu.com",
  "args": [
    {
      "name": "userId",
      "type": "string",
      "required": false,
      "desc": "User id. Default 'me' (the logged-in user)."
    }
  ],
  "example": "bb-browser site xiaohongshu/user --json",
  "capabilities": [
    "read",
    "network"
  ],
  "accessTier": "auth_read",
  "intent": "consume"
}
*/

const HOME_URL = 'https://www.xiaohongshu.com';

async function user(args) {
  const userId = (args && args.userId) || 'me';

  // ----- 1. Navigate -----
  const targetUrl = userId === 'me'
    ? `${HOME_URL}/`
    : `${HOME_URL}/user/profile/${encodeURIComponent(userId)}`;
  const page = await bb.goto(targetUrl, { waitUntil: 'networkidle' });

  // ----- 2. Login probe + read userInfo -----
  const probe = await page.eval(async (target) => {
    let cookies = [];
    try { cookies = window.cookieStore ? await window.cookieStore.getAll() : []; } catch (_) {}
    const a1 = cookies.find((c) => c.name === 'a1') || null;
    const s = window.__INITIAL_STATE__;
    const u = s && s.user;
    const uiRef = u && u.userInfo;
    const ui = uiRef ? (uiRef._value !== undefined ? uiRef._value : uiRef) : null;
    const currentUid = ui ? ui.userId : null;

    // For 'me', accept any logged-in user. For other, verify userInfo.userId matches.
    const matchesTarget = target === 'me' || currentUid === target;
    return {
      a1Present: !!a1,
      userId: currentUid,
      matchesTarget,
      ui: ui ? {
        userId: ui.userId,
        nickname: ui.nickName || ui.nickname,
        redId: ui.redId,
        desc: ui.desc || '',
        ipLocation: ui.ipLocation || null,
        gender: ui.gender || 'unknown',
        stats: {
          fans: parseInt(ui.fans || '0', 10) || 0,
          follows: parseInt(ui.follows || '0', 10) || 0,
          interaction: parseInt(ui.interaction || '0', 10) || 0,
          notes: parseInt(ui.notes || '0', 10) || 0,
        },
        avatar: ui.image || ui.avatar || null,
      } : null,
    };
  }, userId);

  if (!probe.userId) {
    return {
      ok: false,
      authStatus: 'anonymous',
      data: null,
      error: 'LOGIN_REQUIRED',
      hint: 'Profile read needs a logged-in session.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  if (!probe.matchesTarget) {
    return {
      ok: false,
      authStatus: 'auth_read',
      data: null,
      error: 'NOT_FOUND',
      hint: `userId ${userId} did not match the profile loaded by the SPA (got ${probe.userId}).`,
      action: 'abort',
      recommendedNextActions: [
        { adapter: 'search', args: { keyword: userId }, why: 'Search for the user by name/keyword.' },
      ],
    };
  }

  if (!probe.ui) {
    return {
      ok: false,
      authStatus: 'auth_read',
      data: null,
      error: 'NOT_FOUND',
      hint: 'Profile data not present in INITIAL_STATE.user.userInfo.',
      action: 'abort',
      recommendedNextActions: [],
    };
  }

  return {
    ok: true,
    authStatus: 'auth_read',
    data: probe.ui,
    recommendedNextActions: [
      { adapter: 'user-notes', args: { userId: probe.ui.userId, whose: 'other', whichList: 'published' }, why: 'Read this user\'s published notes.' },
      { adapter: 'follow', args: { userId: probe.ui.userId, confirm: true }, why: 'Follow this user.' },
    ],
  };
}
