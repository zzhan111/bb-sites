/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 药帮忙 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "ybm/cart-add",
  "title": "加入药帮忙购物车",
  "description": "Add a product (by skuId) to shopping cart on ybm100.com (药帮忙)",
  "domain": "www.ybm100.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": false,
  "prerequisites": "需先登录 ybm100.com",
  "args": {
    "skuId": {
      "required": true,
      "description": "SKU/product ID to add to cart"
    },
    "quantity": {
      "required": false,
      "description": "Quantity to add (default 1)"
    },
    "shopCode": {
      "required": false,
      "description": "Shop code (from product info)"
    },
    "orgId": {
      "required": false,
      "description": "Organization ID (from product info)"
    }
  },
  "example": "bb-browser site ybm/cart-add --skuId 324241070 --quantity 1 --json",
  "capabilities": [
    "network",
    "writable"
  ]
}
*/

const HOME_URL = 'https://www.ybm100.com/new/';
const CART_CHANGE_API = 'https://www.ybm100.com/new-front/cart/change-cart';

async function(args) {
  const skuId = args?.skuId ?? '';
  const quantity = parseInt(args?.quantity) || 1;
  const shopCode = args?.shopCode ?? '';
  const orgId = args?.orgId ?? '';

  if (!skuId) {
    return {
      success: false,
      error: 'Missing required argument: skuId',
      hint: 'Provide a skuId from search or product results.',
      action: 'bb-browser site ybm/cart-add --skuId <SKU_ID> --quantity 1',
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
    const body = {
      skuId: Number(skuId),
      amount: quantity,
      opType: 1
    };
    if (shopCode) body.shopCode = shopCode;
    if (orgId) body.orgId = orgId;

    const response = await fetch(CART_CHANGE_API, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Referer': HOME_URL
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch(e) { payload = null; }

    if (!response.ok || !payload?.success) {
      return {
        success: false,
        error: payload?.msg || `HTTP ${response.status}`,
        hint: payload?.msg || 'Failed to add item to cart.',
        action: `bb-browser site ybm/cart-add --skuId ${skuId} --quantity 1`,
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
        skuId: payload.data?.skuId || skuId,
        quantity: payload.data?.qty || quantity,
        totalAmount: payload.data?.totalAmount || 0,
        price: payload.data?.price || ''
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
          adapter: 'ybm/checkout-preview',
          args: {},
          reason: 'Proceed to checkout'
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
