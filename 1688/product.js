/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/product",
  "title": "查看 1688 商品详情",
  "description": "Get product detail by offer ID on 1688.com",
  "domain": "detail.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需商品 offer ID",
  "args": {
    "offerId": {
      "required": true,
      "description": "Product offer ID (from search results or product page URL)"
    }
  },
  "example": "bb-browser site 1688/product --offerId 1234567890 --json",
  "capabilities": [
    "network",
    "dom"
  ]
}
*/

const HOME_URL = 'https://www.1688.com/';
const DETAIL_URL = 'https://detail.1688.com/offer/';

async function product(args) {
  const offerId = args?.offerId ?? '';

  if (!offerId) {
    return {
      success: false,
      error: 'offerId is required',
      hint: 'Provide an offer ID from search results or a product page URL.',
      action: 'bb-browser site 1688/product --offerId <OFFER_ID>',
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }

  const productUrl = `${DETAIL_URL}${offerId}.html`;

  if (!location.hostname.includes('detail.1688.com') || !location.href.includes(offerId)) {
    await bb.goto(productUrl, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  try {
    // Extract product info from DOM
    const title = document.querySelector('[class*="title"], .offer-title, h1')?.textContent?.trim() || '';
    const priceEl = document.querySelector('[class*="price"], .offer-price, [class*="Price"]');
    const price = priceEl?.textContent?.trim() || '';
    const image = document.querySelector('img[class*="main"], .main-img img, [class*="mainImage"] img')?.src || '';
    const specEl = document.querySelector('[class*="spec"], [class*="attr"]');
    const spec = specEl?.textContent?.trim() || '';
    const descEl = document.querySelector('[class*="desc"], [class*="detail"]');

    // Try to extract embedded data
    let metaData = {};
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/offerDetailData\s*[:=]\s*(\{[^}]+?\})/);
      if (match) {
        try { metaData = JSON.parse(match[1]); } catch(e) {}
        break;
      }
    }

    return {
      success: true,
      input: args,
      url: productUrl,
      data: {
        id: offerId,
        name: metaData.subject || title || '',
        price: price || metaData.price || '',
        image: image || metaData.image || '',
        spec: spec || metaData.spec || '',
        url: productUrl,
        minOrderQuantity: metaData.minOrder || 1
      },
      pagination: null,
      recommendedNextActions: [
        { type: 'action', adapter: '1688/cart-add', args: { offerId }, reason: 'Add this product to cart' },
        { type: 'action', adapter: '1688/search', args: { keyword: title }, reason: 'Find similar products' }
      ],
      hints: []
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Failed to load product detail.',
      action: `bb-browser open ${HOME_URL}`,
      input: args,
      url: productUrl,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}

module.exports = { product };
