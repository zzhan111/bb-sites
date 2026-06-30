/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/order-list",
  "title": "查询 1688 订单列表",
  "description": "Get order list with pagination on 1688.com using MTOP trading service",
  "domain": "air.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 1688.com",
  "args": {
    "page": {
      "required": false,
      "description": "Page number, default 1"
    },
    "pageSize": {
      "required": false,
      "description": "Items per page, default 10"
    }
  },
  "example": "bb-browser site 1688/order-list --json",
  "capabilities": [
    "network",
    "dom"
  ]
}
*/

const ORDER_URL = 'https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html';
const HOME_URL = 'https://www.1688.com/';

async function orderList(args) {
  const page = args?.page ?? 1;
  const pageSize = args?.pageSize ?? 10;

  if (!location.hostname.includes('air.1688.com')) {
    await bb.goto(`${ORDER_URL}?page=${page}&pageSize=${pageSize}`, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 4000));
  }

  try {
    if (!window.lib || !window.lib.mtop) {
      return {
        success: false,
        error: 'MTOP framework not loaded',
        hint: 'The order page requires the MTOP framework. Navigate to air.1688.com first.',
        action: `bb-browser open ${ORDER_URL}`,
        input: args,
        url: ORDER_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const result = await new Promise((resolve) => {
      window.lib.mtop.request({
        api: 'mtop.1688.trading.dataline.service',
        v: '1.0',
        data: JSON.stringify({
          serviceId: 'OrderListDataLineService.buyerOrderList',
          param: JSON.stringify({ page, pageSize })
        }),
        success: function(res) { resolve({ success: true, data: res }); },
        failure: function(err) { resolve({ success: false, error: err?.ret?.[0] || err?.message || 'Unknown error' }); }
      });
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        hint: 'Failed to load orders. Make sure you are logged in on 1688.com.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: ORDER_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const data = result.data;

    return {
      success: true,
      input: { page, pageSize },
      url: ORDER_URL,
      requestedConstraints: [
        { key: 'page', value: page, source: 'arg' },
        { key: 'pageSize', value: pageSize, source: 'arg' }
      ],
      executedConstraints: [
        { key: 'page', value: page, source: 'arg' },
        { key: 'pageSize', value: pageSize, source: 'arg' }
      ],
      deferredConstraints: [],
      data: data,
      pagination: {
        page,
        pageSize,
        totalItems: data.total || 0,
        totalPages: Math.ceil((data.total || 0) / pageSize),
        hasMore: data.hasMore !== false
      },
      recommendedNextActions: [
        { type: 'drill', adapter: '1688/order-detail', args: { orderId: '<from data>' }, reason: 'View order detail' },
        { type: 'action', adapter: '1688/search', args: { keyword: '<商品>' }, reason: 'Search for products' }
      ],
      hints: []
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Failed to load orders.',
      action: `bb-browser open ${ORDER_URL}`,
      input: args,
      url: ORDER_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}

module.exports = { orderList };
