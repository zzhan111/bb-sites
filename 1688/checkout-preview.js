/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/checkout-preview",
  "title": "预览 1688 结算订单(不下单)",
  "description": "Preview checkout order on 1688.com. Does NOT submit the order.",
  "domain": "buy.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 1688.com",
  "args": {},
  "example": "bb-browser site 1688/checkout-preview --json",
  "capabilities": [
    "network",
    "dom"
  ]
}
*/

const CART_URL = 'https://cart.1688.com/';
const HOME_URL = 'https://www.1688.com/';

async function checkoutPreview(args) {
  if (!location.hostname.includes('1688.com')) {
    await bb.goto(CART_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  try {
    if (!window.lib || !window.lib.mtop) {
      return {
        success: false,
        error: 'MTOP framework not loaded',
        hint: 'Navigate to a 1688.com page first to load MTOP.',
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
        api: 'mtop.cbu.pc.web.cartsvr.settle',
        v: '1.0',
        data: JSON.stringify({}),
        success: function(res) { resolve({ success: true, data: res }); },
        failure: function(err) {
          // Try alternative API
          window.lib.mtop.request({
            api: 'mtop.cbu.trade.settlement.preview',
            v: '1.0',
            data: JSON.stringify({}),
            success: function(res2) { resolve({ success: true, data: res2 }); },
            failure: function(err2) { resolve({ success: false, error: err2?.ret?.[0] || err?.ret?.[0] || 'Settlement preview failed' }); }
          });
        }
      });
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        hint: 'Failed to load checkout preview. Make sure your cart has items.',
        action: `bb-browser site 1688/cart-list`,
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
        { type: 'action', adapter: '1688/cart-list', args: {}, reason: 'Review cart items' },
        { type: 'action', adapter: '1688/cart-add', args: { offerId: '<offerId>', quantity: 1 }, reason: 'Add more items' }
      ],
      hints: []
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Failed to load checkout preview.',
      action: `bb-browser open ${HOME_URL}`,
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}

module.exports = { checkoutPreview };
