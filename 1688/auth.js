/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/auth",
  "title": "检查 1688 登录状态",
  "description": "Check login state on 1688.com (阿里巴巴1688). Returns member info if authenticated.",
  "domain": "www.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 1688.com",
  "args": {},
  "example": "bb-browser site 1688/auth --json",
  "capabilities": [
    "network",
    "dom"
  ]
}
*/

const HOME_URL = 'https://www.1688.com/';

async function auth(args) {
  if (!location.hostname.includes('1688.com')) {
    await bb.goto(HOME_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  try {
    // Check login state by looking at page elements and cookies
    const hasMtop = !!(window.lib && window.lib.mtop);

    // Check page for login indicators
    const loginEl = document.querySelector('.login-info, [class*="login"], [id*="login"], [class*="user"], [id*="user"]');
    const nickEl = document.querySelector('[class*="nick"], [class*="name"], #nickname, [id*="nick"]');

    const cookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
    const hasToken = cookies.some(c => /_m_h5_tk|_tb_token_|unb|cookie2|cookie17|isg/.test(c));

    const nickText = (nickEl || loginEl)?.textContent?.trim() || '';
    const isLoggedIn = hasToken && nickText.length > 0;

    if (!isLoggedIn) {
      return {
        success: false,
        error: 'Not authenticated on 1688.com',
        hint: 'You need to log in to 1688.com first. Visit the site and sign in.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    // Try MTOP to get user info
    let userInfo = { nick: nickText };
    if (hasMtop) {
      try {
        const res = await new Promise((resolve, reject) => {
          window.lib.mtop.request({
            api: 'mtop.cbu.pc.web.api.pop.querypreference',
            v: '1.0',
            data: JSON.stringify({}),
            success: r => resolve(r),
            failure: e => reject(e)
          });
        });
        userInfo.raw = res;
      } catch(e) {
        userInfo.mtopError = e?.ret?.[0] || e.message;
      }
    }

    return {
      success: true,
      input: args,
      url: HOME_URL,
      data: {
        authenticated: true,
        nick: nickText,
        hasMtop,
        token: hasToken ? 'valid' : 'missing'
      },
      pagination: null,
      recommendedNextActions: [
        { type: 'action', adapter: '1688/search', args: { keyword: '<商品关键词>' }, reason: 'Search for products' },
        { type: 'action', adapter: '1688/cart-list', args: {}, reason: 'View your purchase cart' },
        { type: 'action', adapter: '1688/order-list', args: {}, reason: 'View your orders' }
      ],
      hints: hasMtop ? [] : ['MTOP framework not loaded on this page. Navigate to a 1688 subdomain first.']
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Failed to check login state.',
      action: `bb-browser open ${HOME_URL}`,
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}

module.exports = { auth };
