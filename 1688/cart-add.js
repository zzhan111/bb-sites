/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/cart-add",
  "title": "加入 1688 购物车",
  "description": "Add an item to shopping cart on 1688.com",
  "domain": "cart.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": false,
  "prerequisites": "需先登录 1688.com",
  "args": {
    "offerId": {
      "required": true,
      "description": "Product offer ID to add to cart"
    },
    "quantity": {
      "required": false,
      "description": "Quantity to add (default 1)"
    },
    "skuId": {
      "required": false,
      "description": "SKU ID if the product has variants"
    }
  },
  "example": "bb-browser site 1688/cart-add --offerId 1234567890 --quantity 1 --json",
  "capabilities": [
    "network",
    "dom",
    "writable"
  ]
}
*/

const CART_URL = 'https://cart.1688.com/';
const HOME_URL = 'https://www.1688.com/';

async function cartAdd(args) {
  const offerId = args?.offerId ?? '';
  const quantity = parseInt(args?.quantity) || 1;
  const skuId = args?.skuId ?? '';

  if (!offerId) {
    return {
      success: false,
      error: 'offerId is required',
      hint: 'Provide an offer ID from search results.',
      action: 'bb-browser site 1688/cart-add --offerId <OFFER_ID> --quantity 1',
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
        hint: 'Navigate to cart.1688.com or www.1688.com first.',
        action: `bb-browser open ${CART_URL}`,
        input: args,
        url: CART_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const result = await new Promise((resolve) => {
      const apis = [
        {
          api: 'mtop.cbu.cartsvr.search.addtocart',
          v: '1.0',
          data: JSON.stringify({ offerId, quantity, specId: skuId || undefined })
        },
        {
          api: 'mtop.cbu.pc.web.cartsvr.addtocart',
          v: '1.0',
          data: JSON.stringify({ offerId, quantity })
        }
      ];

      let done = false;
      apis.forEach(({ api, v, data }) => {
        if (done) return;
        try {
          window.lib.mtop.request({
            api, v, data,
            success: function(res) { if (!done) { done = true; resolve({ success: true, data: res }); } },
            failure: function(err) { /* try next */ }
          });
        } catch(e) {}
      });
      setTimeout(() => { if (!done) resolve({ success: false, error: 'All cart-add APIs failed' }); }, 5000);
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Failed to add item to cart',
        hint: 'Check the offer ID and try again.',
        action: `bb-browser site 1688/cart-add --offerId ${offerId} --quantity ${quantity}`,
        input: args,
        url: CART_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    return {
      success: true,
      input: args,
      url: CART_URL,
      data: result.data,
      pagination: null,
      recommendedNextActions: [
        { type: 'action', adapter: '1688/cart-list', args: {}, reason: 'View updated cart' },
        { type: 'action', adapter: '1688/checkout-preview', args: {}, reason: 'Preview checkout' }
      ],
      hints: []
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Failed to add item to cart.',
      action: `bb-browser open ${HOME_URL}`,
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}

module.exports = { cartAdd };
