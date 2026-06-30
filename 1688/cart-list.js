/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/cart-list",
  "title": "查看 1688 购物车",
  "description": "Get shopping cart contents and totals on 1688.com",
  "domain": "cart.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 1688.com",
  "args": {},
  "example": "bb-browser site 1688/cart-list --json",
  "capabilities": [
    "network",
    "dom"
  ]
}
*/

const CART_URL = 'https://cart.1688.com/';
const HOME_URL = 'https://www.1688.com/';

async function cartList(args) {
  if (!location.hostname.includes('cart.1688.com')) {
    await bb.goto(CART_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 4000));
  }

  try {
    if (!window.lib || !window.lib.mtop) {
      return {
        success: false,
        error: 'MTOP framework not loaded on cart.1688.com',
        hint: 'Navigate to cart.1688.com first to load the MTOP framework.',
        action: `bb-browser open ${CART_URL}`,
        input: args,
        url: CART_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    // Try several cart API names
    const cartResult = await new Promise((resolve) => {
      const apis = [
        { api: 'mtop.cbu.pc.web.cartsvr.service.querycarts', v: '1.0', data: '{}' },
        { api: 'mtop.cbu.pc.cartsvr.cartlist', v: '1.0', data: '{}' },
        { api: 'mtop.cbu.web.cartsvr.query', v: '1.0', data: '{}' }
      ];

      let done = false;
      apis.forEach(({ api, v, data }) => {
        if (done) return;
        try {
          window.lib.mtop.request({
            api, v, data,
            success: function(res) { if (!done) { done = true; resolve({ success: true, data: res, api }); } },
            failure: function(err) { /* try next */ }
          });
        } catch(e) {}
      });
      setTimeout(() => { if (!done) resolve({ success: false, error: 'All cart APIs failed' }); }, 5000);
    });

    if (!cartResult.success) {
      return {
        success: false,
        error: cartResult.error || 'Unable to load cart data',
        hint: 'Make sure you are logged in and have items in your 1688 cart.',
        action: `bb-browser open ${CART_URL}`,
        input: args,
        url: CART_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const cartData = cartResult.data;

    return {
      success: true,
      input: args,
      url: CART_URL,
      requestedConstraints: [{ key: 'cart', value: 'all', source: 'adapter' }],
      executedConstraints: [{ key: 'cart', value: 'all', source: 'adapter' }],
      deferredConstraints: [],
      data: cartData,
      pagination: null,
      recommendedNextActions: [
        { type: 'action', adapter: '1688/cart-add', args: { offerId: '<from search>', quantity: 1 }, reason: 'Add an item to cart' },
        { type: 'action', adapter: '1688/checkout-preview', args: {}, reason: 'Preview checkout' }
      ],
      hints: []
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Failed to load cart.',
      action: `bb-browser open ${CART_URL}`,
      input: args,
      url: CART_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}

module.exports = { cartList };
