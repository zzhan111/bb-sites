/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/follow — social-media P0 adapter (engage / write)
 *
 * Follow (or unfollow with --undo) a user. Strategy: navigate to /user/profile/<userId>;
 * XHS profile page exposes a "关注" (Follow) button at the top, which toggles
 * between "关注" and "已关注" / "互相关注". SPA-click toggles it.
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §10.3 (WriteReceipt)
 */

/* @meta
{
  "name": "xiaohongshu/follow",
  "title": "关注/取消关注小红书用户",
  "description": "Follow (or unfollow with --undo) a Xiaohongshu user. Navigates to /user/profile/<userId> and SPA-clicks the 关注 button. Requires confirm=true. Returns WriteReceipt.",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": false,
  "prerequisites": "需先登录 xiaohongshu.com",
  "args": [
    {
      "name": "userId",
      "type": "string",
      "required": true
    },
    {
      "name": "undo",
      "type": "boolean",
      "default": false
    },
    {
      "name": "confirm",
      "type": "boolean",
      "required": true
    }
  ],
  "example": "bb-browser site xiaohongshu/follow --userId '5c55880f0000000012004d14' --confirm true --json",
  "capabilities": [
    "write",
    "network"
  ],
  "accessTier": "auth_write",
  "intent": "engage"
}
*/

const HOME_URL = 'https://www.xiaohongshu.com';

async function follow(args) {
  const { userId, undo = false, confirm = false } = args || {};

  if (!userId) {
    return { ok: false, authStatus: 'anonymous', data: null, error: 'MISSING_ARG', hint: 'userId is required.', action: 'abort' };
  }
  if (confirm !== true) {
    return {
      ok: false, authStatus: 'anonymous', data: null,
      error: 'MISSING_ARG',
      hint: 'Following is a real public action. Pass --confirm true.',
      action: 'abort',
      recommendedNextActions: [{ adapter: 'user', args: { userId }, why: 'Re-read profile before following.' }],
    };
  }

  const url = `${HOME_URL}/user/profile/${encodeURIComponent(userId)}`;
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
      hint: 'Following requires login.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  // Cannot follow yourself.
  if (probe.userId === userId) {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'CONTENT_REJECTED',
      hint: 'Cannot follow yourself.',
      action: 'abort',
      recommendedNextActions: [],
    };
  }

  // SPA-click on the follow button.
  let beforeLabel, afterLabel;
  try {
    const before = await page.eval(() => {
      const candidates = Array.from(document.querySelectorAll('button, span, div'));
      const btn = candidates.find((el) => {
        const t = (el.textContent || '').trim();
        return t === '关注' || t === '已关注' || t === '互相关注' || t === '关注 TA' || t === '+ 关注';
      });
      if (!btn) return { found: false };
      return { found: true, label: (btn.textContent || '').trim() };
    });
    if (!before.found) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'NOT_FOUND',
        hint: 'Could not find the follow button on the profile page.',
        action: 'abort',
        recommendedNextActions: [{ adapter: 'user', args: { userId }, why: 'Re-fetch the profile.' }],
      };
    }
    beforeLabel = before.label;

    const clicked = await page.eval(() => {
      const candidates = Array.from(document.querySelectorAll('button, span, div'));
      const btn = candidates.find((el) => {
        const t = (el.textContent || '').trim();
        return t === '关注' || t === '已关注' || t === '互相关注' || t === '关注 TA' || t === '+ 关注';
      });
      if (!btn) return { ok: false, reason: 'no_button' };
      try { btn.click(); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
    });
    if (!clicked.ok) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'WRITE_FAILED', hint: `Follow click failed: ${clicked.reason}.`,
        action: 'retry_or_abort', recommendedNextActions: [],
      };
    }

    await page.wait(1000);

    const after = await page.eval(() => {
      const candidates = Array.from(document.querySelectorAll('button, span, div'));
      const btn = candidates.find((el) => {
        const t = (el.textContent || '').trim();
        return t === '关注' || t === '已关注' || t === '互相关注' || t === '关注 TA' || t === '+ 关注';
      });
      return { label: btn ? (btn.textContent || '').trim() : null };
    });
    afterLabel = after.label;
  } catch (e) {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'WRITE_FAILED',
      hint: `Follow flow failed: ${e.message}`,
      action: 'retry_or_abort', recommendedNextActions: [],
    };
  }

  // Determine the effective action: if undo=true and we went from '已关注'→'关注', that's unfollow;
  // if undo=false and we went from '关注'→'已关注', that's follow.
  const becameFollowing = beforeLabel !== '已关注' && afterLabel === '已关注';
  const becameUnfollowing = beforeLabel === '已关注' && afterLabel === '关注';
  const effectiveAction = undo ? (becameUnfollowing ? 'unfollow' : 'noop') : (becameFollowing ? 'follow' : 'noop');

  if (effectiveAction === 'noop') {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'WRITE_FAILED',
      hint: `Button state did not change: before='${beforeLabel}', after='${afterLabel}'. The site may have throttled the action.`,
      action: 'backoff_and_retry',
      recommendedNextActions: [],
    };
  }

  return {
    ok: true, authStatus: 'auth_write',
    data: {
      action: effectiveAction,
      targetId: userId,
      resultId: '',
      undoable: true,
      undoAdapter: `xiaohongshu/follow --userId ${userId} --undo true --confirm true`,
      undoHint: 'Re-run with --undo true to unfollow.',
      url: `${HOME_URL}/user/profile/${userId}`,
      beforeLabel, afterLabel,
    },
    recommendedNextActions: [
      { adapter: 'follow', args: { userId, undo: !undo, confirm: true }, why: 'Undo this action.' },
      { adapter: 'user-notes', args: { whose: 'other', whichList: 'published', userId }, why: 'Read their latest notes.' },
    ],
  };
}
