/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 药帮忙 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "ybm/checkout-preview",
  "title": "预览药帮忙结算订单(不下单)",
  "description": "Preview order with pricing, shipping, and item details on ybm100.com (药帮忙). Does NOT submit.",
  "domain": "www.ybm100.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 ybm100.com",
  "args": {},
  "example": "bb-browser site ybm/checkout-preview --json",
  "capabilities": [
    "network"
  ]
}
*/

const HOME_URL = 'https://www.ybm100.com/new/';
const SETTLE_API = 'https://www.ybm100.com/new-front/order/settle';

async function(args) {
  if (!location.hostname.includes('ybm100.com')) {
    await bb.goto(HOME_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  try {
    const response = await fetch(SETTLE_API, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Referer': HOME_URL
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        hint: 'Checkout preview API failed. Your session may have expired or cart is empty.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const payload = await response.json();
    if (!payload.success || payload.code !== 200) {
      return {
        success: false,
        error: payload.msg || 'Checkout preview failed',
        hint: 'Unable to load checkout. Make sure your cart has items selected.',
        action: 'bb-browser site ybm/cart-list',
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const settle = payload.data?.orderSettle;
    if (!settle) {
      return {
        success: false,
        error: 'No order settlement data',
        hint: 'Cart may be empty. Search and add items first.',
        action: 'bb-browser site ybm/search --keyword <药品名称>',
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    // Build items from companys
    const items = [];
    const companies = settle.companys || [];
    companies.forEach(company => {
      const shops = company.shops || [];
      shops.forEach(shop => {
        const groups = shop.shoppingGroupFrontDtos || [];
        groups.forEach(group => {
          const sorted = group.sorted || [];
          sorted.forEach(si => {
            const item = si.item;
            if (!item) return;
            items.push({
              name: item.name || '',
              skuId: item.skuId || item.id,
              price: `¥${item.price || 0}`,
              priceValue: item.price || 0,
              quantity: item.amount || 0,
              subtotal: item.subtotal || 0,
              image: item.imageUrl || ''
            });
          });
        });
      });
    });

    return {
      success: true,
      input: args,
      url: `${HOME_URL}base/cart`,
      requestedConstraints: [],
      executedConstraints: [],
      deferredConstraints: [],
      data: {
        summary: {
          totalKind: settle.productVarietyNum || 0,
          totalQuantity: settle.productTotalNum || 0,
          totalPrice: `¥${(settle.payAmount || settle.totalAmount || 0).toFixed(2)}`,
          totalPriceValue: settle.payAmount || settle.totalAmount || 0,
          discountAmount: settle.discountAmount || settle.promoTotalAmt || 0,
          freightTotal: settle.freightTotalAmt || 0,
          payAmount: settle.payAmount || 0
        },
        companies: companies.map(c => ({
          companyName: c.companyName,
          productVarietyNum: c.productVarietyNum,
          productTotalNum: c.productTotalNum,
          totalAmount: c.totalAmount,
          freightTips: c.freightTips,
          freeFreightDiffAmount: c.freeFreightDiffAmount,
          payAmount: c.payAmount
        })),
        items,
        settleMeta: {
          hasCoupon: !settle.isHideCoupon,
          voucherTip: settle.voucherTip,
          freightTips: settle.freightTips,
          balanceAmount: settle.balanceAmount,
          availBalanceAmt: settle.availBalanceAmt
        }
      },
      pagination: null,
      recommendedNextActions: [
        {
          type: 'action',
          adapter: 'ybm/cart-list',
          args: {},
          reason: 'Review cart before checkout'
        },
        {
          type: 'action',
          adapter: 'ybm/cart-add',
          args: { skuId: '<productId>', quantity: 1 },
          reason: 'Add more items to cart'
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
