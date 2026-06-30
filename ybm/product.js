/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 药帮忙 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "ybm/product",
  "title": "查看药帮忙商品详情",
  "description": "Get detailed product info on ybm100.com using product barcode/UPC or product ID",
  "domain": "www.ybm100.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 ybm100.com,需商品条码/ID",
  "args": {
    "productId": {
      "required": false,
      "description": "Product ID (from search results)"
    },
    "barcode": {
      "required": false,
      "description": "Product barcode/UPC code (69...)"
    }
  },
  "example": "bb-browser site ybm/product --barcode 6930851411622 --json",
  "capabilities": [
    "network"
  ]
}
*/

const HOME_URL = 'https://www.ybm100.com/new/';
const SEARCH_API = 'https://www.ybm100.com/new-front/search/list-products';

async function(args) {
  const productId = args?.productId ?? '';
  const barcode = args?.barcode ?? '';

  if (!productId && !barcode) {
    return {
      success: false,
      error: 'Missing required argument: productId or barcode',
      hint: 'Provide a product ID (from search results) or barcode to look up.',
      action: 'bb-browser site ybm/product --barcode <商品条码>',
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }

  // Navigate to home page if needed
  if (!location.hostname.includes('ybm100.com')) {
    await bb.goto(HOME_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  const queryWord = barcode || productId;

  try {
    const response = await fetch(SEARCH_API, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Referer': HOME_URL
      },
      body: JSON.stringify({
        queryWord,
        searchScene: 1,
        pageSize: 20,
        pageNum: 1,
        sortStrategy: 1,
        type: 1,
        tags: '',
        isNextPage: 0,
        isFilter: 0
      })
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        hint: 'Product lookup API failed. Session may have expired.',
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
        error: payload.msg || 'Lookup failed',
        hint: 'The product lookup returned an error.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const rows = payload.data?.rows || [];
    // For barcode lookup, find exact match
    const match = barcode
      ? rows.find(r => r.productInfo?.code === barcode)
      : rows[0];

    if (!match || !match.productInfo) {
      return {
        success: false,
        error: 'Product not found',
        hint: `No product found for ${barcode ? 'barcode ' + barcode : 'productId ' + productId}. Try a different identifier.`,
        action: '',
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const info = match.productInfo;

    return {
      success: true,
      input: args,
      url: `${HOME_URL}base/product/${info.pid || info.id}`,
      data: {
        id: String(info.id),
        skuId: String(info.pid),
        spuId: info.masterStandardProductId || '',
        name: info.originalShowName || info.showName || '',
        brand: '',
        spec: info.spec || '',
        manufacturer: info.manufacturer || '',
        providerName: info.companyName || info.shopName || '',
        price: `¥${info.price || info.suggestPrice || 0}`,
        priceValue: info.price || info.suggestPrice || 0,
        originalPrice: info.suggestPrice ? `¥${info.suggestPrice}` : '',
        priceUnit: info.productUnit || '',
        image: info.imageUrlPath || '',
        url: `https://www.ybm100.com/new/base/product/${info.pid || info.id}`,
        stockStatus: info.availableQty > 0 ? 'available' : 'out_of_stock',
        stockQuantity: info.availableQty || null,
        minOrderQuantity: info.leastPurchaseNum || 1,
        shelfLife: info.shelfLife || '',
        nearEffect: info.nearEffect || '',
        approvalNumber: info.approvalNumber || '',
        shopName: info.shopName || '',
        shopCode: info.shopCode || '',
        category: {
          firstId: info.categoryFirstId,
          firstName: info.categoryFirstName,
          secondId: info.categorySecondId,
          secondName: info.categorySecondName
        },
        tags: (info.tagList || []).map(t => t.text).filter(Boolean),
        freeShipping: info.freeShippingFlag || false
      },
      pagination: null,
      recommendedNextActions: [
        {
          type: 'action',
          adapter: 'ybm/cart-add',
          args: { skuId: info.id, quantity: info.leastPurchaseNum || 1 },
          reason: `Add this product to cart (min order: ${info.leastPurchaseNum || 1})`
        },
        {
          type: 'action',
          adapter: 'ybm/search',
          args: { keyword: info.manufacturer || info.originalShowName },
          reason: 'Search for more products from the same manufacturer'
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
