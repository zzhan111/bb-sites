/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/search",
  "title": "搜索 1688 商品",
  "description": "Search products on 1688.com using traditional page-based search with server-rendered results",
  "domain": "s.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "无",
  "args": {
    "keyword": {
      "required": true,
      "description": "Search keyword"
    },
    "page": {
      "required": false,
      "description": "Page number, default 1"
    },
    "sortType": {
      "required": false,
      "description": "Sort: 综合(default), sale(销量), price-asc(价格升序), price-desc(价格降序)"
    }
  },
  "example": "bb-browser site 1688/search --keyword \"数据线\" --json",
  "capabilities": [
    "network",
    "dom"
  ]
}
*/

const SEARCH_URL = 'https://s.1688.com/selloffer/offer_search.htm';
const HOME_URL = 'https://www.1688.com/';

async function search(args) {
  const keyword = args?.keyword ?? '';
  const page = args?.page ?? 1;
  const sortType = args?.sortType ?? '';

  if (!keyword) {
    return {
      success: false,
      error: 'keyword is required',
      hint: 'Provide a product name to search',
      action: 'bb-browser site 1688/search --keyword <商品名称>',
      input: args,
      url: SEARCH_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }

  // Navigate to search page
  let searchUrl = `${SEARCH_URL}?keywords=${encodeURIComponent(keyword)}&n=y`;
  if (page > 1) searchUrl += `&beginPage=${page}`;
  if (sortType) {
    if (sortType === 'sale') searchUrl += '&sortType=sale';
    else if (sortType === 'price-asc') searchUrl += '&sortType=price&priceOrder=asc';
    else if (sortType === 'price-desc') searchUrl += '&sortType=price&priceOrder=desc';
  }

  if (!location.hostname.includes('1688.com') || !location.pathname.includes('offer_search')) {
    await bb.goto(searchUrl, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 1688 search page has a GBK/UTF-8 encoding bug: when Chinese keywords
    // are passed via URL parameter, the page JS reads them with wrong charset,
    // resulting in garbled text (e.g. "宠物益生菌" → "瀹犵墿鐩婄敓鑿�").
    // Fix: manually correct the search input value and re-submit if garbled.
    const searchInput = document.querySelector('input[name="keywords"]');
    if (searchInput) {
      const currentVal = searchInput.value;
      // Heuristic: if the input contains high-codepoint chars that differ
      // from the keyword, it's garbled - fix it and re-submit
      const isGarbled = keyword && currentVal && keyword !== currentVal;
      if (isGarbled) {
        const descriptor = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        );
        descriptor.set.call(searchInput, keyword);
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
        const form = searchInput.closest('form');
        if (form) {
          form.submit();
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }
  }

  try {
    // 1688 search results are server-rendered in the HTML with embedded JSON data
    // Extract product data from DOM or embedded scripts
    const products = [];

    // Try to find product cards via common 1688 selectors
    const offerItems = document.querySelectorAll('[class*="offer-list"] [class*="item"], [data-offerid], [data-offer-id]');

    if (offerItems.length > 0) {
      offerItems.forEach(item => {
        const id = item.getAttribute('data-offerid') || item.getAttribute('data-offer-id') || '';
        const titleEl = item.querySelector('[class*="title"], a[title], [class*="subject"]');
        const priceEl = item.querySelector('[class*="price"], [class*="Price"]');
        const imgEl = item.querySelector('img');
        const linkEl = item.querySelector('a[href*="offer"]');

        if (titleEl) {
          products.push({
            id,
            name: titleEl.textContent?.trim() || titleEl.getAttribute('title') || '',
            price: priceEl?.textContent?.trim() || '',
            image: imgEl?.src || '',
            url: linkEl?.href || (id ? `https://detail.1688.com/offer/${id}.html` : '')
          });
        }
      });
    }

    // If DOM extraction found nothing, try server-rendered JSON
    if (products.length === 0) {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        const match = text.match(/offerList[:\s]*(\[[\s\S]*?\])\s*[,;}]/);
        if (match) {
          try {
            const offers = JSON.parse(match[1]);
            offers.forEach(o => products.push({
              id: o.offerId || o.id || '',
              name: o.subject || o.title || o.offerName || '',
              price: o.price || o.priceStr || '',
              image: o.image || o.imageUrl || '',
              url: `https://detail.1688.com/offer/${o.offerId || o.id}.html`
            }));
          } catch(e) {}
          break;
        }
      }
    }

    const hints = [];
    if (products.length === 0) {
      hints.push('No products extracted from page. The page may require JavaScript rendering. Try searching on the live site first.');
    }

    return {
      success: true,
      input: { keyword, page, sortType },
      url: searchUrl,
      requestedConstraints: [{ key: 'keyword', value: keyword, source: 'arg' }],
      executedConstraints: [{ key: 'keyword', value: keyword, source: 'arg' }],
      deferredConstraints: [],
      data: products,
      pagination: {
        page,
        pageSize: products.length,
        totalItems: products.length,
        totalPages: 1,
        hasMore: products.length > 0
      },
      recommendedNextActions: products.length > 0 ? [
        { type: 'drill', adapter: '1688/product', args: { offerId: '<from products[].id>' }, reason: 'View product detail' },
        { type: 'action', adapter: '1688/cart-add', args: { offerId: '<from products[].id>', quantity: 1 }, reason: 'Add to cart' }
      ] : [],
      hints
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Search failed. Try again or log in first.',
      action: `bb-browser open ${HOME_URL}`,
      input: args,
      url: searchUrl,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}

module.exports = { search };
