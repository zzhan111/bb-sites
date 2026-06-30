/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 小红书 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/**
 * xiaohongshu/post-create — social-media P0 adapter (create / write)
 *
 * Create a new post (text-only is supported by this adapter; image/video
 * upload requires binary file handling which is currently out of scope — for
 * media posts, use the bb-browser UI directly with this adapter as a thin
 * orchestrator that opens the create dialog and fills text fields).
 *
 * Strategy: navigate to the creator entry (`/creator/home` or via the
 * 「发布」nav button). XHS SPA opens a create modal. Fill in title + content
 * via SPA-edit on contenteditable fields. Click 发布 (publish).
 *
 * SAFETY: Creating a post is irreversible from the user's account perspective
 * (the post is public, indexed by search engines, and visible to followers).
 * The contract mandates `confirm: true`. XHS also surfaces the post in the
 * creator's profile immediately. Use the `post-delete` adapter (P1) to remove
 * it after publish if needed.
 *
 * Conforms to: docs/claude/contracts/social-media/v1.md §10.3 (WriteReceipt)
 */

/* @meta
{
  "name": "xiaohongshu/post-create",
  "title": "发布小红书图文笔记",
  "description": "Create a new Xiaohongshu post (text content). Image/video upload out of scope (use bb-browser UI for media). Requires confirm=true. Returns WriteReceipt with resultId=noteId.",
  "domain": "social-media",
  "category": "社交",
  "risk": "high",
  "readOnly": false,
  "prerequisites": "需先登录 xiaohongshu.com",
  "args": [
    {
      "name": "title",
      "type": "string",
      "required": true,
      "desc": "Post title. XHS limit ~20 chars."
    },
    {
      "name": "content",
      "type": "string",
      "required": true,
      "desc": "Post body text. XHS limit ~1000 chars."
    },
    {
      "name": "tags",
      "type": "array",
      "items": "string",
      "required": false,
      "desc": "Optional hashtag names."
    },
    {
      "name": "confirm",
      "type": "boolean",
      "required": true
    }
  ],
  "example": "bb-browser site xiaohongshu/post-create --title '推荐一个Skill' --content '...' --confirm true --json",
  "capabilities": [
    "write",
    "network"
  ],
  "accessTier": "auth_write",
  "intent": "create"
}
*/

const HOME_URL = 'https://www.xiaohongshu.com';

async function postCreate(args) {
  const { title, content, tags = [], confirm = false } = args || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return { ok: false, authStatus: 'anonymous', data: null, error: 'MISSING_ARG', hint: 'title is required.', action: 'abort' };
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return { ok: false, authStatus: 'anonymous', data: null, error: 'MISSING_ARG', hint: 'content is required.', action: 'abort' };
  }
  if (confirm !== true) {
    return {
      ok: false, authStatus: 'anonymous', data: null,
      error: 'MISSING_ARG',
      hint: 'Creating a post is irreversible (public, indexed, visible to followers). Pass --confirm true.',
      action: 'abort',
      recommendedNextActions: [],
    };
  }

  // Navigate to creator entry. XHS uses either /creator/home or a modal triggered by 「发布」 nav.
  // /creator/home is the most stable URL — triggers the create flow on load.
  const page = await bb.goto(`${HOME_URL}/creator/home`, { waitUntil: 'networkidle' });

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
      hint: 'Post creation requires login.',
      action: 'stop_and_wait_for_human',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Check login state.' }],
    };
  }

  // Wait for the create modal/dialog to appear.
  // XHS renders a modal with the title input + content editable. We poll for a contenteditable.
  let dialogReady = false;
  for (let i = 0; i < 10; i++) {
    dialogReady = await page.eval(() => {
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      const inputs = Array.from(document.querySelectorAll('input[type="text"], textarea'));
      return editables.length > 0 || inputs.length > 1;
    });
    if (dialogReady) break;
    await page.wait(500);
  }
  if (!dialogReady) {
    return {
      ok: false, authStatus: 'auth_write', data: null,
      error: 'NOT_FOUND',
      hint: 'Create dialog did not appear. The post flow may have changed or the account may not have publishing permission.',
      action: 'abort',
      recommendedNextActions: [{ adapter: 'auth', args: {}, why: 'Verify login state.' }],
    };
  }

  // Fill title (input) + content (contenteditable).
  // XHS has multiple inputs on the page (search box etc); pick the one inside the create dialog.
  let fillError = null;
  try {
    const fillResult = await page.eval((t, c) => {
      // Title input: usually the first input after the create modal opens. Filter out nav search.
      const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
      // The create modal title input is typically placeholder-bearing.
      const titleInput = inputs.find((i) => {
        const ph = (i.placeholder || '').toLowerCase();
        return ph.includes('标题') || ph.includes('title') || ph === '请输入标题';
      }) || inputs[inputs.length - 1];  // fallback to last input
      if (titleInput) {
        titleInput.focus();
        titleInput.value = t;
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Content: contenteditable div
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      // Filter to one inside the create modal (visible, large).
      const contentEditable = editables.find((e) => e.offsetParent !== null && e.offsetHeight > 50);
      if (contentEditable) {
        contentEditable.focus();
        contentEditable.innerText = c;
        contentEditable.dispatchEvent(new InputEvent('input', { bubbles: true, data: c }));
      } else if (editables[0]) {
        editables[0].focus();
        editables[0].innerText = c;
        editables[0].dispatchEvent(new InputEvent('input', { bubbles: true, data: c }));
      }
      return {
        titleFilled: !!titleInput,
        contentFilled: !!contentEditable || editables.length > 0,
      };
    }, title, content);

    if (!fillResult.titleFilled || !fillResult.contentFilled) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'WRITE_FAILED',
        hint: `Form fill failed: titleFilled=${fillResult.titleFilled}, contentFilled=${fillResult.contentFilled}. The post dialog structure may have changed.`,
        action: 'retry_or_abort',
        recommendedNextActions: [],
      };
    }

    // Click publish. Button text is typically "发布" (publish).
    const clicked = await page.eval(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const pubBtn = btns.find((b) => (b.textContent || '').trim() === '发布');
      if (!pubBtn) return { ok: false, reason: 'no_publish_button' };
      try { pubBtn.click(); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
    });
    if (!clicked.ok) {
      return {
        ok: false, authStatus: 'auth_write', data: null,
        error: 'WRITE_FAILED',
        hint: `Publish click failed: ${clicked.reason}.`,
        action: 'retry_or_abort',
        recommendedNextActions: [],
      };
    }

    // Wait for the publish to complete. XHS typically shows a success toast and may redirect.
    await page.wait(3000);

    // Try to read the new noteId from INITIAL_STATE.creator / publishedNoteMap.
    // xhs-cli has CreatorEndpointsMixin.search_topics etc. The post-creation response is
    // captured in the Vuex store at INITIAL_STATE.creator.publishedNote or similar.
    const newNoteId = await page.eval(() => {
      const c = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.creator;
      if (!c) return null;
      const inner = c._value !== undefined ? c._value : c;
      if (inner.publishedNoteId) return inner.publishedNoteId;
      if (inner.lastPublishedId) return inner.lastPublishedId;
      // Sometimes the redirect URL contains the noteId.
      const m = (location.pathname || '').match(/\/explore\/([0-9a-f]{16,})/);
      if (m) return m[1];
      return null;
    });

    if (!newNoteId) {
      // Post likely succeeded but we couldn't read the ID. Return success without resultId.
      return {
        ok: true, authStatus: 'auth_write',
        data: {
          action: 'post',
          targetId: '',
          resultId: '',
          undoable: true,
          undoAdapter: 'xiaohongshu/post-delete (P1, requires resultId)',
          undoHint: 'Use post-delete (P1) once you have the resultId. Check your profile for the new post.',
          url: `${HOME_URL}/`,
        },
        recommendedNextActions: [
          { adapter: 'user-notes', args: { whose: 'me', whichList: 'published' }, why: 'Verify your latest published post.' },
        ],
      };
    }

    return {
      ok: true, authStatus: 'auth_write',
      data: {
        action: 'post',
        targetId: newNoteId,
        resultId: newNoteId,
        undoable: true,
        undoAdapter: `xiaohongshu/post-delete --noteId ${newNoteId} --confirm true`,
        undoHint: 'Use post-delete (P1) to remove.',
        url: `${HOME_URL}/explore/${newNoteId}`,
      },
      recommendedNextActions: [
        { adapter: 'post-detail', args: { noteId: newNoteId }, why: 'View the published post.' },
      ],
    };
  } catch (e) {
    fillError = e.message;
  }

  return {
    ok: false, authStatus: 'auth_write', data: null,
    error: 'WRITE_FAILED',
    hint: `Post create flow failed: ${fillError}.`,
    action: 'retry_or_abort',
    recommendedNextActions: [],
  };
}
