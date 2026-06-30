/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 药帮忙 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "ybm/search",
  "title": "搜索药帮忙商品",
  "description": "Keyword + structured filters → product list with pagination on ybm100.com (药帮忙)",
  "domain": "www.ybm100.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 ybm100.com",
  "args": {
    "keyword": {
      "required": true,
      "description": "Search keyword. Product name, generic name, or manufacturer."
    },
    "manufacturer": {
      "required": false,
      "description": "Manufacturer / factory filter"
    },
    "shop": {
      "required": false,
      "description": "Shop code filter (e.g. DP0009 for 长沙小药药自营旗舰店)"
    },
    "spec": {
      "required": false,
      "description": "Specification filter (e.g. '0.25g*10s*5板')"
    },
    "minPrice": {
      "required": false,
      "description": "Minimum price (numeric)"
    },
    "maxPrice": {
      "required": false,
      "description": "Maximum price (numeric)"
    },
    "sortStrategy": {
      "required": false,
      "description": "Sort: 1=综合(default), 2=销量, 3=价格升序, 4=价格降序, 5=有效期"
    },
    "page": {
      "required": false,
      "description": "Page number, default 1"
    },
    "pageSize": {
      "required": false,
      "description": "Items per page, default 20"
    }
  },
  "example": "bb-browser site ybm/search --keyword \"阿莫西林\" --json",
  "capabilities": [
    "network",
    "dom"
  ]
}
*/

const HOME_URL = 'https://www.ybm100.com/new/';
const SEARCH_URL = 'https://www.ybm100.com/new/base/search';
const SEARCH_API = 'https://www.ybm100.com/new-front/search/list-products';
const CATEGORIES_API = 'https://www.ybm100.com/new-front/search/search-categories';
const HEADER_API = 'https://www.ybm100.com/new-front/index/header-data';

async function(args) {
  const keyword = args?.keyword ?? '';
  const manufacturer = args?.manufacturer ?? '';
  const shop = args?.shop ?? '';
  const spec = args?.spec ?? '';
  const minPrice = args?.minPrice ?? '';
  const maxPrice = args?.maxPrice ?? '';
  const sortStrategy = args?.sortStrategy ?? 1;
  const page = args?.page ?? 1;
  const pageSize = args?.pageSize ?? 20;

  if (!keyword) {
    return {
      success: false,
      error: 'Missing required argument: keyword',
      hint: 'Please provide a search keyword (product name, generic name, or manufacturer).',
      action: 'bb-browser site ybm/search --keyword <药品名称>',
      input: args,
      url: SEARCH_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }

  // Navigate to search page if needed (triggers auth check and cookie setup)
  if (!location.hostname.includes('ybm100.com') || !location.pathname.includes('/base/search')) {
    await bb.goto(`${SEARCH_URL}?keyword=${encodeURIComponent(keyword)}`, { waitUntil: 'networkidle' });
    // Wait for SPA to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Build tags for structured filters
  const tagParts = [];
  if (manufacturer) tagParts.push(`manufacturer:${manufacturer}`);
  if (shop) tagParts.push(`shop:${shop}`);
  if (spec) tagParts.push(`spec:${spec}`);
  if (minPrice !== '' || maxPrice !== '') {
    tagParts.push(`price:${minPrice || 0}-${maxPrice || '*'}`);
  }
  const tags = tagParts.join(';');

  try {
    // Execute search API call
    const response = await fetch(SEARCH_API, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Referer': SEARCH_URL
      },
      body: JSON.stringify({
        queryWord: keyword,
        searchScene: 1,
        pageSize,
        pageNum: page,
        sortStrategy,
        type: 1,
        tags,
        isNextPage: 0,
        isFilter: manufacturer || shop || spec || minPrice || maxPrice ? 1 : 0
      })
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        hint: 'Search API returned an error. Your session may have expired.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: SEARCH_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const payload = await response.json();

    if (!payload.success || payload.code !== 200) {
      return {
        success: false,
        error: payload.msg || 'Search failed',
        hint: 'The search API returned an error. Try again or log in first.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: SEARCH_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const data = payload.data;
    const rows = data.rows || [];
    const totalCount = data.totalCount || 0;
    const totalPage = data.totalPage || 0;
    const isEnd = data.isEnd;

    // Map to contract product objects
    const products = rows.map(row => {
      const info = row.productInfo || {};
      return {
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
        freeShipping: info.freeShippingFlag || false,
        shopCode: info.shopCode || '',
        shopName: info.shopName || '',
        tags: (info.tagList || []).map(t => t.text).filter(Boolean)
      };
    });

    // Constraint tracking
    const requestedConstraints = [];
    const executedConstraints = [];
    const deferredConstraints = [];

    if (keyword) {
      requestedConstraints.push({ key: 'keyword', value: keyword, source: 'arg' });
      executedConstraints.push({ key: 'keyword', value: keyword, source: 'arg' });
    }
    if (manufacturer) {
      requestedConstraints.push({ key: 'manufacturer', value: manufacturer, source: 'arg' });
      executedConstraints.push({ key: 'manufacturer', value: manufacturer, source: 'arg' });
    }
    if (shop) {
      requestedConstraints.push({ key: 'shop', value: shop, source: 'arg' });
      executedConstraints.push({ key: 'shop', value: shop, source: 'arg' });
    }
    if (spec) {
      requestedConstraints.push({ key: 'spec', value: spec, source: 'arg' });
      executedConstraints.push({ key: 'spec', value: spec, source: 'arg' });
    }
    if (minPrice || maxPrice) {
      requestedConstraints.push({ key: 'price', value: { minPrice, maxPrice }, source: 'arg' });
      executedConstraints.push({ key: 'price', value: { minPrice, maxPrice }, source: 'arg' });
    }
    if (sortStrategy !== 1) {
      requestedConstraints.push({ key: 'sortStrategy', value: sortStrategy, source: 'arg' });
      executedConstraints.push({ key: 'sortStrategy', value: sortStrategy, source: 'arg' });
    }

    // Pagination
    const pagination = {
      page: data.pageNo || page,
      pageSize: data.pageSize || pageSize,
      totalItems: totalCount,
      totalPages: totalPage,
      hasMore: !isEnd,
      nextCursor: isEnd ? null : String(page + 1)
    };

    // Recommended next actions
    const recommendedNextActions = [];
    if (products.length > 0) {
      recommendedNextActions.push({
        type: 'drill',
        adapter: 'ybm/product',
        args: { productId: '<from products[].id>' },
        reason: 'View full product details'
      });
      recommendedNextActions.push({
        type: 'action',
        adapter: 'ybm/cart-add',
        args: { productId: '<from products[].id>', quantity: '<minOrderQuantity>' },
        reason: 'Add product to shopping cart'
      });
    }

    // Hints
    const hints = [];
    if (products.length === 0) {
      hints.push('No products found. Try a different keyword or broaden filters.');
    }
    if (totalCount > products.length) {
      hints.push(`Showing ${products.length} of ${totalCount} products. Use --page to see more.`);
    }

    return {
      success: true,
      input: {
        keyword,
        manufacturer,
        shop,
        spec,
        minPrice,
        maxPrice,
        sortStrategy,
        page,
        pageSize
      },
      url: `${SEARCH_URL}?keyword=${encodeURIComponent(keyword)}`,
      requestedConstraints,
      executedConstraints,
      deferredConstraints,
      data: products,
      pagination,
      recommendedNextActions,
      hints
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Network error. Check your connection or login state.',
      action: `bb-browser open ${HOME_URL}`,
      input: args,
      url: SEARCH_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}
