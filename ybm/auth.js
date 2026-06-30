/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 药帮忙 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "ybm/auth",
  "title": "检查药帮忙登录状态",
  "description": "Check login state on ybm100.com (药帮忙). Returns merchant info if authenticated.",
  "domain": "www.ybm100.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 ybm100.com",
  "args": {},
  "example": "bb-browser site ybm/auth --json",
  "capabilities": [
    "network"
  ]
}
*/

const HOME_URL = 'https://www.ybm100.com/new/';
const HEADER_DATA_URL = 'https://www.ybm100.com/new-front/index/header-data';

async function(args) {
  // Navigate to home page if needed
  if (!location.hostname.includes('ybm100.com')) {
    await bb.goto(HOME_URL, { waitUntil: 'networkidle' });
  }

  try {
    const response = await fetch(HEADER_DATA_URL, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Referer': HOME_URL
      }
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        hint: 'Request failed. The site may be down or your session expired.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const payload = await response.json();

    if (!payload.success || !payload.data?.merchant) {
      return {
        success: false,
        error: 'Not authenticated',
        hint: 'You need to log in to ybm100.com first.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const merchant = payload.data.merchant;

    return {
      success: true,
      input: args,
      url: HOME_URL,
      data: {
        authenticated: true,
        accountId: merchant.accountId,
        merchantId: merchant.merchantId,
        realName: merchant.realName,
        nickname: merchant.nickname,
        mobile: merchant.mobile,
        businessType: merchant.businessTypeName,
        province: merchant.province,
        city: merchant.city,
        district: merchant.district,
        address: merchant.address,
        licenseStatus: merchant.licenseStatus,
        cartCount: payload.data.merchantCartCount || 0
      },
      pagination: null,
      recommendedNextActions: [
        {
          type: 'action',
          adapter: 'ybm/search',
          args: { keyword: '<药品名称>' },
          reason: 'Search for products by keyword'
        },
        {
          type: 'action',
          adapter: 'ybm/cart-list',
          args: {},
          reason: 'View your shopping cart'
        },
        {
          type: 'action',
          adapter: 'ybm/order-list',
          args: {},
          reason: 'View your order history'
        }
      ],
      hints: []
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Network request failed. Check your connection or login state.',
      action: `bb-browser open ${HOME_URL}`,
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}
