/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 药帮忙 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "ybm/cart-list",
  "title": "查看药帮忙购物车",
  "description": "Get current shopping cart contents and totals on ybm100.com (药帮忙)",
  "domain": "www.ybm100.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 ybm100.com",
  "args": {},
  "example": "bb-browser site ybm/cart-list --json",
  "capabilities": [
    "network"
  ]
}
*/

const HOME_URL = 'https://www.ybm100.com/new/';
const CART_API = 'https://www.ybm100.com/new-front/cart/list';

async function(args) {
  if (!location.hostname.includes('ybm100.com')) {
    await bb.goto(HOME_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  try {
    const response = await fetch(CART_API, {
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
        hint: 'Cart API failed. Your session may have expired.',
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
        error: payload.msg || 'Cart request failed',
        hint: 'Unable to load cart data. Try logging in again.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const cartInfo = payload.data?.cartInfo;
    if (!cartInfo) {
      return {
        success: false,
        error: 'Cart data not found',
        hint: 'Cart is empty or response format changed.',
        action: `bb-browser site ybm/search --keyword <药品名称>`,
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    // Build cart items from company > shop > group > item structure
    const items = [];
    const companies = cartInfo.company || [];

    companies.forEach(company => {
      const shops = company.shop || [];
      shops.forEach(shop => {
        const groups = shop.shoppingGroupFrontDtos || [];
        groups.forEach(group => {
          const sorted = group.sorted || [];
          sorted.forEach(sortedItem => {
            const item = sortedItem.item;
            if (!item) return;
            const sku = item.sku || {};
            items.push({
              cartLineId: String(item.id),
              id: String(item.skuId || item.id),
              skuId: String(sku.id),
              name: item.name || sku.showName || '',
              spec: item.spec || sku.spec || '',
              manufacturer: sku.manufacturer || '',
              providerName: item.companyName || sku.companyName || shop.shopName || '',
              price: `¥${item.price || 0}`,
              priceValue: item.price || 0,
              priceUnit: item.productUnit || sku.productUnit || '',
              image: item.imageUrl || sku.imageUrl || '',
              url: `https://www.ybm100.com/new/base/product/${sku.id}`,
              quantity: item.amount || 0,
              subtotal: item.subtotal || item.price * item.amount || 0,
              minOrderQuantity: 1,
              stockStatus: item.skuStatus === 1 ? 'available' : 'out_of_stock',
              stockQuantity: sku.availableQty || null,
              shopCode: item.shopCode || shop.shopCode || '',
              shopName: shop.shopName || '',
              groupId: group.id,
              groupType: group.activityTypeText || '',
              valid: item.valid === 1
            });
          });
        });
      });
    });

    // Build summary
    const validItems = items.filter(i => i.valid);
    const totalQuantity = validItems.reduce((sum, i) => sum + i.quantity, 0);

    const summary = {
      totalKind: cartInfo.varietyNum || validItems.length,
      totalQuantity,
      totalPrice: `¥${(cartInfo.payAmount || cartInfo.totalAmount || 0).toFixed(2)}`,
      totalPriceValue: cartInfo.payAmount || cartInfo.totalAmount || 0,
      selectNum: cartInfo.selectNum || 0,
      differenceAmount: cartInfo.differenceAmount || null
    };

    const recommendedNextActions = [
      {
        type: 'action',
        adapter: 'ybm/cart-add',
        args: { skuId: '<from items[].skuId>', quantity: 1 },
        reason: 'Add a product to cart'
      },
      {
        type: 'action',
        adapter: 'ybm/checkout-preview',
        args: {},
        reason: 'Preview checkout with current cart items'
      }
    ];

    if (items.length > 0) {
      recommendedNextActions.push({
        type: 'action',
        adapter: 'ybm/cart-remove',
        args: { cartLineId: '<from items[].cartLineId>' },
        reason: 'Remove an item from cart'
      });
    }

    return {
      success: true,
      input: args,
      url: `${HOME_URL}base/cart`,
      requestedConstraints: [],
      executedConstraints: [],
      deferredConstraints: [],
      data: {
        summary,
        items
      },
      pagination: null,
      recommendedNextActions,
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
