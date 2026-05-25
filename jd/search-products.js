/* @meta
{
  "name": "jd/search-products",
  "description": "京东商品搜索 - 按关键词搜索京东商品 (product search: title, price, isJDSelfOperated, reviewCount, url)",
  "domain": "search.jd.com",
  "args": {
    "keyword": {"required": true, "description": "搜索关键词，如'手机'、'笔记本电脑'"},
    "priceMin": {"required": false, "description": "最低价格（元），如 1000"},
    "priceMax": {"required": false, "description": "最高价格（元），如 5000"},
    "sort": {"required": false, "description": "排序方式: default(综合), price_asc(价格从低到高), price_desc(价格从高到低), sales(销量), review(评价), new(新品)"}
  },
  "tags": ["ecommerce", "j", "jingdong", "search", "products"],
  "readOnly": true,
  "example": "bb-browser site jd/search-products 手机"
}
*/

async function(args) {
  if (!args.keyword) {
    return {
      error: '缺少必填参数: keyword',
      hint: '请输入搜索关键词，例如：bb-browser site jd/search-products 手机',
      action: 'bb-browser site jd/search-products <搜索关键词>'
    };
  }

  var keyword = args.keyword.trim();
  var priceMin = args.priceMin ? parseFloat(args.priceMin) : null;
  var priceMax = args.priceMax ? parseFloat(args.priceMax) : null;
  var sort = args.sort || 'default';

  // Build search URL
  var url = 'https://search.jd.com/Search?keyword=' + encodeURIComponent(keyword) + '&enc=utf-8';

  // Optional price filter params
  if (priceMin !== null || priceMax !== null) {
    var priceRange = '';
    if (priceMin !== null) priceRange += priceMin;
    priceRange += '-';
    if (priceMax !== null) priceRange += priceMax;
    url += '&wq=' + encodeURIComponent(keyword) + '&ev=exprice_' + priceRange;
  }

  // Sort parameter
  var sortMap = {
    'default': '',
    'price_asc': '&psort=1',
    'price_desc': '&psort=2',
    'sales': '&psort=3',
    'review': '&psort=4',
    'new': '&psort=5'
  };
  if (sortMap[sort]) {
    url += sortMap[sort];
  }

  // Try to fetch search results
  var resp;
  try {
    resp = await fetch(url, {
      credentials: 'include',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
  } catch(e) {
    return {
      error: '网络请求失败: ' + e.message,
      hint: '京东搜索需要中国大陆网络环境。请确保使用中国代理或在中国网络环境下运行。',
      action: '请先配置中国代理，然后在浏览器中打开 https://search.jd.com 并确保访问正常后再试'
    };
  }

  if (!resp.ok) {
    return {
      error: 'HTTP ' + resp.status + ': ' + resp.statusText,
      hint: resp.status === 302 || resp.status === 403
        ? '京东检测到非中国大陆IP访问，已将请求重定向到登录页面。需要使用中国大陆IP代理或在中国网络环境下运行。'
        : '请求失败，请稍后重试。',
      action: '1. 配置中国代理\n2. 在浏览器中打开 https://search.jd.com 确认可以正常访问\n3. 重新运行搜索'
    };
  }

  var html;
  try {
    html = await resp.text();
  } catch(e) {
    return {error: '解析响应内容失败: ' + e.message};
  }

  // Check if we got redirected to login page
  if (html.indexOf('login') !== -1 && (html.indexOf('passport') !== -1 || html.indexOf('登录') !== -1)) {
    return {
      error: '被重定向到京东登录页面',
      hint: '当前IP不在中国大陆，京东要求登录才能访问搜索页面。需要使用中国大陆IP代理。',
      action: '1. 配置中国代理\n2. 在浏览器中打开 https://search.jd.com 确认可正常搜索\n3. 如果已登录，确保session cookie有效'
    };
  }

  var parser = new DOMParser();
  var doc = parser.parseFromString(html, 'text/html');

  // --- Strategy 1: Parse HTML search results ---
  var products = [];
  var totalResults = 0;

  // Try to find total results count
  var totalEl = doc.querySelector('#J_topMessage span, .total-result, .searchCount, .result-count');
  if (totalEl) {
    var totalText = totalEl.textContent.trim();
    var totalMatch = totalText.match(/(\d[\d,]*)/);
    if (totalMatch) {
      totalResults = parseInt(totalMatch[1].replace(/,/g, ''));
    }
  }

  // Parse product items from the search results grid
  var items = doc.querySelectorAll('#J_goodsList .gl-item, .goods-list .gl-item, .search-result-list .gl-item, div[class*="gl-item"]');
  if (items.length === 0) {
    // Fallback: try alternative selectors
    items = doc.querySelectorAll('.p-name, .goods-item, [class*="product"], [class*="item"]');
  }

  items.forEach(function(item) {
    try {
      // Only process if this looks like a product item
      var nameEl = item.querySelector('.p-name a') || item.querySelector('.p-name em') || item.querySelector('a[clstag]');
      if (!nameEl) return;

      var title = (nameEl.textContent || nameEl.getAttribute('title') || '').trim();
      if (!title) return;

      // Extract product URL
      var link = nameEl.getAttribute('href') || '';
      if (link && !link.startsWith('http')) {
        link = 'https:' + link;
      }

      // Extract price
      var priceEl = item.querySelector('.p-price strong, .p-price i, .p-price');
      var price = 0;
      if (priceEl) {
        var priceText = (priceEl.textContent || '').trim().replace(/[^0-9.]/g, '');
        price = parseFloat(priceText) || 0;
      } else {
        // Try data attribute
        var priceData = item.getAttribute('data-price') || item.querySelector('[data-price]')?.getAttribute('data-price');
        if (priceData) {
          price = parseFloat(priceData) || 0;
        }
      }

      // Extract review count
      var reviewEl = item.querySelector('.p-commit a, .p-commit, a[class*="comment"]');
      var reviewCount = 0;
      if (reviewEl) {
        var reviewText = (reviewEl.textContent || '').trim();
        var reviewMatch = reviewText.match(/([\d,]+)/);
        if (reviewMatch) {
          reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
        }
      }

      // Check if JD self-operated (京东自营)
      var iconsEl = item.querySelector('.p-icons, .p-icons i, [class*="self"], .jd-icons');
      var isJDSelfOperated = false;
      if (iconsEl) {
        var iconText = (iconsEl.textContent || '').trim();
        if (iconText.indexOf('自营') !== -1) {
          isJDSelfOperated = true;
        }
      }

      // Extract shop name
      var shopEl = item.querySelector('.p-shop a, .p-shop, .shop a, a[class*="shop"]');
      var shopName = '';
      if (shopEl) {
        shopName = (shopEl.textContent || shopEl.getAttribute('title') || '').trim();
      }

      // Extract image URL
      var imgEl = item.querySelector('.p-img img') || item.querySelector('img[data-lazy-img]');
      var imageUrl = '';
      if (imgEl) {
        imageUrl = imgEl.getAttribute('src') || imgEl.getAttribute('data-lazy-img') || imgEl.getAttribute('data-lazy-load') || '';
        if (imageUrl && !imageUrl.startsWith('http')) {
          imageUrl = 'https:' + imageUrl;
        }
      }

      products.push({
        title: title,
        price: price,
        isJDSelfOperated: isJDSelfOperated,
        reviewCount: reviewCount,
        shopName: shopName,
        imageUrl: imageUrl,
        url: link
      });
    } catch(e) {
      // Skip items that fail to parse
    }
  });

  // If no products found via HTML parsing, try to extract from script JSON
  if (products.length === 0) {
    try {
      var scripts = doc.querySelectorAll('script');
      var jsonStr = '';
      scripts.forEach(function(s) {
        var text = s.textContent || '';
        // Look for product data in window.pageConfig or searchData
        if (text.indexOf('pageConfig') !== -1 && text.indexOf('product') !== -1) {
          var match = text.match(/pageConfig\s*=\s*(\{[^;]+\})/);
          if (match) jsonStr = match[1];
        }
        if (!jsonStr && text.indexOf('searchData') !== -1) {
          var match = text.match(/searchData\s*=\s*(\{[^;]+\})/);
          if (match) jsonStr = match[1];
        }
        if (!jsonStr && text.indexOf('wareList') !== -1) {
          var match = text.match(/wareList\s*=\s*(\[[^\]]+\])/);
          if (match) jsonStr = match[1];
        }
      });

      if (jsonStr) {
        var data = JSON.parse(jsonStr);
        var wareList = data.wareList || data.productList || data.products || [];
        if (Array.isArray(wareList)) {
          wareList.forEach(function(w) {
            products.push({
              title: w.wname || w.name || w.title || '',
              price: parseFloat(w.jdPrice || w.price || 0),
              isJDSelfOperated: w.isSelf || w.selfOperated || false,
              reviewCount: parseInt(w.comments || w.reviewCount || w.goodComments || 0),
              shopName: w.shopName || w.shop || '',
              imageUrl: w.imagePath || w.image || w.img || '',
              url: 'https://item.jd.com/' + (w.wareId || w.skuId || w.id) + '.html'
            });
          });
        }
      }
    } catch(e) {
      // JSON parsing failed silently, continue with empty results
    }
  }

  // Provide meaningful feedback if no results
  if (products.length === 0) {
    // Check if the page might have blocked us
    if (html.indexOf('验证') !== -1 || html.indexOf('captcha') !== -1 || html.indexOf('reCAPTCHA') !== -1) {
      return {
        error: '需要完成验证码验证',
        hint: '京东触发了验证码验证。需要在中国网络环境下通过浏览器完成验证后重试。',
        action: '在浏览器中打开 https://search.jd.com/Search?keyword=' + encodeURIComponent(keyword) + ' 完成验证后再试'
      };
    }

    return {
      keyword: keyword,
      totalResults: 0,
      products: [],
      hint: '未找到商品，可能原因：\n1. 搜索关键词过于生僻\n2. 需要在中国大陆网络环境下运行\n3. 京东页面结构已更新，需要更新解析逻辑'
    };
  }

  // Sort products if price filters were specified (server-side might not have applied)
  if (priceMin !== null) {
    products = products.filter(function(p) { return p.price >= priceMin; });
  }
  if (priceMax !== null) {
    products = products.filter(function(p) { return p.price <= priceMax; });
  }

  return {
    keyword: keyword,
    totalResults: totalResults || products.length,
    products: products
  };
}
