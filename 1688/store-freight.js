/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/store-freight",
  "title": "查看 1688 店铺运费/包邮门槛",
  "description": "Get per-store shipping/delivery info from 1688 cart page. Shows delivery floors (包邮门槛), current subtotals, and gaps to free shipping.",
  "domain": "cart.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 1688.com",
  "args": {},
  "example": "bb-browser site 1688/store-freight --json",
  "capabilities": [
    "network",
    "dom"
  ]
}
*/

const CART_URL = 'https://cart.1688.com/';

async function storeFreight(args) {
  // Navigate to cart if not already there
  if (!location.hostname.includes('cart.1688.com')) {
    await bb.goto(CART_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 4000));
  }

  try {
    const bodyText = document.body?.innerText || '';

    // Shipping address
    const addrMatch = bodyText.match(/发货至：([^\n]+)/);
    const shippingAddress = addrMatch ? addrMatch[1].trim() : '';

    // Find store sections: each store starts with its company name
    const storeNameRe = /([^\n]+(?:科技有限公司|有限公司|经营部|商贸有限公司|实业有限公司|贸易有限公司))/g;
    const storeNames = [];
    let m;
    while ((m = storeNameRe.exec(bodyText)) !== null) {
      storeNames.push({ name: m[1], index: m.index });
    }

    // Parse per-store data
    const stores = [];
    for (let i = 0; i < storeNames.length; i++) {
      const startIdx = storeNames[i].index;
      const endIdx = i + 1 < storeNames.length ? storeNames[i + 1].index : bodyText.length;
      const section = bodyText.substring(startIdx, endIdx);

      // Promotion / delivery text
      const promoMatch = section.match(/(满[^\n]{0,150}(?:包邮|免快递|免运费))/);
      const promotion = promoMatch ? promoMatch[1].trim() : '';

      // Parse delivery floor from promotion
      const floorMatch = promotion.match(/满\s*(\d+(?:\.\d+)?)\s*元/);
      const deliveryFloor = floorMatch ? parseFloat(floorMatch[1]) : null;

      // Check if free shipping is achieved
      const freeShippingText = promotion.match(/免快递运费|免运费|包邮/);
      const hasFreeShipping = !!(freeShippingText);

      // Extract item subtotals from price lines
      // Format: "券后价 ¥X.XX比加购降X.XX元\tXX.XX"
      const itemPrices = [];
      const priceRe = /券后价\s*[¥￥]\s*(\d+(?:\.\d+)?)\s*比加购降[\d.]+\s*元\s*\t?\s*(\d+(?:\.\d+)?)/g;
      let pm;
      while ((pm = priceRe.exec(section)) !== null) {
        itemPrices.push({
          unitPrice: parseFloat(pm[1]),
          subtotal: parseFloat(pm[2])
        });
      }

      // Fallback: extract prices without coupon
      if (itemPrices.length === 0) {
        const simplePriceRe = /\n\s*(\d+(?:\.\d+)?)\s*\n\s*(\d+(?:\.\d+)?)\s*\n\s*券后价/g;
        while ((pm = simplePriceRe.exec(section)) !== null) {
          itemPrices.push({
            unitPrice: parseFloat(pm[1]),
            subtotal: parseFloat(pm[2])
          });
        }
      }

      // Calculate store subtotal from item subtotals
      const storeSubtotal = itemPrices.reduce((sum, item) => sum + item.subtotal, 0);

      // Gap to free shipping
      const gapToFreeShipping = (deliveryFloor !== null && !hasFreeShipping)
        ? Math.max(0, deliveryFloor - storeSubtotal)
        : 0;

      // Shipping status
      let shippingStatus = 'unknown';
      if (deliveryFloor !== null) {
        if (hasFreeShipping || storeSubtotal >= deliveryFloor) {
          shippingStatus = 'free';
        } else {
          shippingStatus = 'below-threshold';
        }
      }

      stores.push({
        storeName: storeNames[i].name,
        promotion: promotion,
        deliveryFloor: deliveryFloor,
        storeSubtotal: parseFloat(storeSubtotal.toFixed(2)),
        gapToFreeShipping: parseFloat(gapToFreeShipping.toFixed(2)),
        shippingStatus: shippingStatus,
        itemCount: itemPrices.length
      });
    }

    // Extract cart totals
    const totalMatch = bodyText.match(/共计\s*[¥￥]\s*([\d.]+)/);
    const cartTotal = totalMatch ? parseFloat(totalMatch[1]) : null;

    // Store count
    const sellerCountMatch = bodyText.match(/卖家数量\s*(\d+)/);
    const sellerCount = sellerCountMatch ? parseInt(sellerCountMatch[1], 10) : stores.length;

    const hints = [];
    if (stores.length === 0) {
      hints.push('Cart is empty or no stores could be identified. Add items to cart first.');
    }
    if (stores.some(s => s.deliveryFloor === null)) {
      hints.push('Some stores do not show delivery floor info in cart. Check product pages for shipping details.');
    }

    return {
      success: true,
      input: args,
      url: CART_URL,
      data: {
        shippingAddress: shippingAddress,
        sellerCount: sellerCount,
        cartTotal: cartTotal,
        stores: stores
      },
      recommendedNextActions: stores.length > 0 ? [
        { type: 'action', adapter: '1688/store-search', args: { shopId: '<from store name>', keyword: '<product name>' }, reason: 'Search for products within a store' },
        { type: 'action', adapter: '1688/cart-add', args: { offerId: '<offerId>', quantity: 1 }, reason: 'Add items to meet delivery floor' }
      ] : [],
      hints: hints
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Failed to extract freight data from cart.',
      action: `bb-browser open ${CART_URL}`,
      input: args,
      url: CART_URL
    };
  }
}

module.exports = { storeFreight };
