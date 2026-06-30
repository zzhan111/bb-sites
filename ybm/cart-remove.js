/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 药帮忙 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "ybm/cart-remove",
  "title": "从药帮忙购物车移除商品",
  "description": "Remove an item or group from shopping cart on ybm100.com (药帮忙)",
  "domain": "www.ybm100.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": false,
  "prerequisites": "需先登录 ybm100.com",
  "args": {
    "cartLineId": {
      "required": false,
      "description": "Cart line item ID to remove (skuId)"
    },
    "groupId": {
      "required": false,
      "description": "Cart group ID to remove entire group promotion"
    }
  },
  "example": "bb-browser site ybm/cart-remove --cartLineId 324241070 --json",
  "capabilities": [
    "network",
    "writable"
  ]
}
*/

const HOME_URL = 'https://www.ybm100.com/new/';
const CART_CHANGE_API = 'https://www.ybm100.com/new-front/cart/change-cart';
const CART_GROUP_CHANGE_API = 'https://www.ybm100.com/new-front/cart/group/change-cart';

async function(args) {
  const cartLineId = args?.cartLineId ?? '';
  const groupId = args?.groupId ?? '';

  if (!cartLineId && !groupId) {
    return {
      success: false,
      error: 'Missing required argument: cartLineId or groupId',
      hint: 'Provide a cartLineId (skuId) or groupId from cart-list results.',
      action: 'bb-browser site ybm/cart-remove --cartLineId <SKU_ID>',
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }

  if (!location.hostname.includes('ybm100.com')) {
    await bb.goto(HOME_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  try {
    let response;

    if (groupId) {
      // Remove entire group
      response = await fetch(CART_GROUP_CHANGE_API, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'Referer': HOME_URL
        },
        body: JSON.stringify({ groupId: Number(groupId), amount: 0 })
      });
    } else {
      // Remove individual item
      response = await fetch(CART_CHANGE_API, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'Referer': HOME_URL
        },
        body: JSON.stringify({ skuId: Number(cartLineId), amount: 0, opType: 0 })
      });
    }

    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch(e) { payload = null; }

    if (!response.ok || !payload?.success) {
      return {
        success: false,
        error: payload?.msg || `HTTP ${response.status}`,
        hint: payload?.msg || 'Failed to remove item from cart.',
        action: '',
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    return {
      success: true,
      input: args,
      url: `${HOME_URL}base/cart`,
      data: {
        removed: groupId ? `group ${groupId}` : `sku ${cartLineId}`,
        success: true
      },
      pagination: null,
      recommendedNextActions: [
        {
          type: 'action',
          adapter: 'ybm/cart-list',
          args: {},
          reason: 'View updated cart'
        },
        {
          type: 'action',
          adapter: 'ybm/search',
          args: { keyword: '<药品名称>' },
          reason: 'Search for products to add back to cart'
        }
      ],
      hints: []
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Network error. Check your connection or login state.',
      action: `bb-browser open ${HOME_URL}`,
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}
