/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/store-search",
  "title": "在 1688 店铺内搜索商品",
  "description": "Search products within a specific 1688 store (本店搜索). Navigate to the store's offer list page and extract products.",
  "domain": "shop.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需店铺 ID",
  "args": {
    "shopId": {
      "required": true,
      "description": "Store ID (e.g. shop90w86u6291304) or memberId (e.g. b2b-2220329970392b8372)"
    },
    "keyword": {
      "required": true,
      "description": "Search keyword within the store"
    },
    "pageNum": {
      "required": false,
      "description": "Page number, default 1"
    },
    "sortType": {
      "required": false,
      "description": "Sort: wangpu_score (综合/default), sale (销量), price-asc (价格升序), price-desc (价格降序)"
    }
  },
  "example": "bb-browser site 1688/store-search --shopId shop90w86u6291304 --keyword 益生菌 --json",
  "capabilities": [
    "network",
    "dom"
  ]
}
*/

const HOME_URL = 'https://shop.1688.com';

async function storeSearch(args) {
  const keyword = args?.keyword || '';
  const shopId = args?.shopId || '';
  const pageNum = parseInt(args?.pageNum || 1, 10);

  if (!keyword) {
    return { success: false, error: 'keyword is required', hint: 'Provide a keyword to search within the store' };
  }

  // Build the offer list URL
  const offerlistUrl = `https://${shopId}.1688.com/page/offerlist.htm?keywords=${encodeURIComponent(keyword)}`;

  // Navigate if not already on the right page
  const onTargetPage = location.hostname.includes('1688.com') && location.pathname.includes('offerlist')
    && location.search.includes(encodeURIComponent(keyword));

  if (!onTargetPage) {
    await bb.goto(offerlistUrl, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Fix encoding if page garbled the keywords
  const searchInput = document.querySelector('.input-search');
  if (searchInput && searchInput.value !== keyword) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    descriptor.set.call(searchInput, keyword);
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  function extractProducts() {
    var bodyText = document.body ? document.body.innerText : '';

    // Total count
    var countMatch = bodyText.match(/共\s*(\d+)\s*件/);
    var totalCount = countMatch ? parseInt(countMatch[1], 10) : null;

    // Store name: first line
    var storeName = (bodyText.split('\n')[0] || '').trim();

    var lines = bodyText.split('\n').map(function(l) { return l.trim(); });

    var products = [];
    var i = 0;

    // Skip to product area: find '-起订量以下' or similar boundary
    while (i < lines.length) {
      if (lines[i] === '-起订量以下') { i += 2; break; }
      i++;
    }

    // State machine to parse products
    while (i < lines.length) {
      var line = lines[i];

      // Skip known non-product lines
      if (!line || line.length < 3 ||
          /^(全选|删除|移入收藏|结算|券后价|比加购降|再选一款|更多|推荐|精选货源|客服|手机逛|阿里巴巴|淘宝|天猫|1688|全球速卖通|淘宝海外|关于阿里|联系我们|知识产权|著作权|廉正|法律|服务条款|隐私|网站导航|医疗器械|增值电信|浙[江B网公]|网络警察|网络工商|可信网站|违法|查看全部|店铺推荐|全部商品|新品专区|店铺动态|公司档案|联系方式|所有类目|支持混批|分类：)/.test(line) ||
          /^[0-9]+\+?$/.test(line) ||
          /^\d+\.\d+$/.test(line) ||
          /^[¥￥]$/.test(line) ||
          line.indexOf('沈阳') === 0 && line.indexOf('科技') > -1 ||
          line.indexOf('地址：') === 0) {
        i++;
        continue;
      }

      // Skip sidebar number list (0, 1, 2, ...)
      if (/^\d{1,3}$/.test(line) && parseInt(line, 10) < 200) {
        var nextLines = lines.slice(i + 1, i + 5).join('');
        if (/^\d+$/.test(nextLines.substring(0, 3))) {
          i++; continue;
        }
      }

      // This looks like a product name
      var name = line;
      i++;

      var price = null;
      var sales = '';
      var isNewPrice = false;
      var tags = [];

      // Parse following lines for attributes
      var lookAhead = 0;
      while (i + lookAhead < lines.length && lookAhead < 15) {
        var la = lines[i + lookAhead];
        lookAhead++;

        // Price: ¥ alone, then INT, then .DEC
        if (la === '¥' && i + lookAhead + 1 < lines.length) {
          var intPart = lines[i + lookAhead];
          var decPart = lines[i + lookAhead + 1];
          if (/^\d+$/.test(intPart) && /^\.\d+$/.test(decPart)) {
            price = parseFloat(intPart + decPart);
            lookAhead += 2;
            continue;
          }
        }

        // Sales count
        var sm = la.match(/已售\s*([\d+]+)\s*件/);
        if (sm) { sales = sm[1]; continue; }

        // New customer price
        if (la === '新人价') { isNewPrice = true; continue; }
        if (la === '混批') { tags.push('混批'); continue; }

        // Stop at next product or end of list
        if (price !== null && la.length > 10 && /[\u4e00-\u9fff]/.test(la)) break;
        if (la === '再选一款' || la === '券后价') break;
        if (/^(全选删除|卖家数量|结算)/.test(la)) break;
      }

      i += Math.max(0, lookAhead - 1);

      if (name && price !== null) {
        var pi = products.length;
        products.push({
          index: pi,
          name: name,
          price: price,
          priceLabel: '¥' + price.toFixed(2),
          sales: sales,
          tags: tags,
          isNewCustomerPrice: isNewPrice,
          offerId: '',
          url: ''
        });
      }
    }

    return { products: products, totalCount: totalCount, storeName: storeName };
  }

  try {
    var result = extractProducts();

    // Try to find offer IDs from script data
    var scripts = document.querySelectorAll('script');
    for (var si = 0; si < scripts.length; si++) {
      var text = scripts[si].textContent || '';
      if (text.indexOf('offerId') > -1 && text.length < 500000) {
        var offerIds = [];
        var re = /"offerId"\s*:\s*(\d+)/g;
        var m;
        while ((m = re.exec(text)) !== null) {
          offerIds.push(m[1]);
        }
        for (var pi = 0; pi < Math.min(result.products.length, offerIds.length); pi++) {
          result.products[pi].offerId = offerIds[pi];
          result.products[pi].url = 'https://detail.1688.com/offer/' + offerIds[pi] + '.html';
        }
        break;
      }
    }

    // Build output
    var out = {
      success: true,
      input: {
        keyword: keyword,
        shopId: shopId,
        shopUrl: 'https://' + shopId + '.1688.com/',
        page: pageNum
      },
      url: offerlistUrl,
      data: {
        storeName: result.storeName,
        totalCount: result.totalCount !== null ? result.totalCount : result.products.length,
        page: pageNum,
        products: result.products
      },
      pagination: {
        page: pageNum,
        totalItems: result.totalCount || result.products.length,
        hasMore: (result.totalCount || result.products.length) > pageNum * 30
      },
      recommendedNextActions: result.products.length > 0 ? [
        { type: 'drill', adapter: '1688/product', args: { offerId: '<from products[].offerId>' }, reason: 'View product detail' },
        { type: 'action', adapter: '1688/cart-add', args: { offerId: '<from products[].offerId>', quantity: 1 }, reason: 'Add to cart' }
      ] : [],
      hints: result.products.length === 0 ? ['No products extracted. The store may have no matching products.'] : []
    };

    return out;
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Store search failed.',
      input: args,
      url: offerlistUrl
    };
  }
}

module.exports = { storeSearch };
