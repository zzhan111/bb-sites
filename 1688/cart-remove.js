/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/cart-remove",
  "title": "从 1688 购物车移除商品",
  "description": "Remove an item from shopping cart on 1688.com",
  "domain": "cart.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": false,
  "prerequisites": "需先登录 1688.com",
  "args": {
    "cartLineId": {
      "required": true,
      "description": "Cart line item ID to remove"
    }
  },
  "example": "bb-browser site 1688/cart-remove --cartLineId <CART_LINE_ID> --json",
  "capabilities": [
    "network",
    "dom",
    "writable"
  ]
}
*/

const CART_URL = 'https://cart.1688.com/';
const HOME_URL = 'https://www.1688.com/';

async function cartRemove(args) {
  const cartLineId = args?.cartLineId ?? '';

  if (!cartLineId) {
    return {
      success: false,
      error: 'cartLineId is required',
      hint: 'Provide a cart line item ID from cart-list results.',
      action: 'bb-browser site 1688/cart-remove --cartLineId <CART_LINE_ID>',
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }

  if (!location.hostname.includes('1688.com')) {
    await bb.goto(HOME_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  try {
    if (!window.lib || !window.lib.mtop) {
      return {
        success: false,
        error: 'MTOP framework not loaded',
        hint: 'Navigate to a 1688.com page first.',
        action: `bb-browser open ${CART_URL}`,
        input: args,
        url: CART_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const result = await new Promise((resolve) => {
      window.lib.mtop.request({
        api: 'mtop.cbu.pc.web.cartsvr.delete',
        v: '1.0',
        data: JSON.stringify({ cartLineId }),
        success: function(res) { resolve({ success: true, data: res }); },
        failure: function(err) { resolve({ success: false, error: err?.ret?.[0] || err?.message || 'Failed to remove' }); }
      });
    });

    return {
      success: result.success,
      input: args,
      url: CART_URL,
      data: result.data || null,
      pagination: null,
      recommendedNextActions: [
        { type: 'action', adapter: '1688/cart-list', args: {}, reason: 'View updated cart' }
      ],
      hints: []
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Failed to remove item from cart.',
      action: `bb-browser open ${HOME_URL}`,
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}

module.exports = { cartRemove };
