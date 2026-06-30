/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 1688 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "1688/order-detail",
  "title": "查看 1688 订单详情",
  "description": "Get single order detail by order ID on 1688.com via MTOP",
  "domain": "air.1688.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 1688.com,需订单号",
  "args": {
    "orderId": {
      "required": true,
      "description": "Order ID to get details for"
    }
  },
  "example": "bb-browser site 1688/order-detail --orderId 3188234784647319150 --json",
  "capabilities": [
    "network",
    "dom"
  ]
}
*/

const ORDER_URL = 'https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html';
const HOME_URL = 'https://www.1688.com/';

async function orderDetail(args) {
  const orderId = args?.orderId ?? '';

  if (!orderId) {
    return {
      success: false,
      error: 'orderId is required',
      hint: 'Provide an order ID from order-list results.',
      action: 'bb-browser site 1688/order-detail --orderId <ORDER_ID>',
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }

  if (!location.hostname.includes('air.1688.com')) {
    await bb.goto(ORDER_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 4000));
  }

  try {
    if (!window.lib || !window.lib.mtop) {
      return {
        success: false,
        error: 'MTOP framework not loaded',
        hint: 'The order page requires MTOP. Navigate to air.1688.com first.',
        action: `bb-browser open ${ORDER_URL}`,
        input: args,
        url: ORDER_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    // Get order list and find the specific order
    const result = await new Promise((resolve) => {
      window.lib.mtop.request({
        api: 'mtop.1688.trading.dataline.service',
        v: '1.0',
        data: JSON.stringify({
          serviceId: 'OrderListDataLineService.buyerOrderList',
          param: JSON.stringify({ page: 1, pageSize: 50 })
        }),
        success: function(res) { resolve({ success: true, data: res }); },
        failure: function(err) { resolve({ success: false, error: err?.ret?.[0] || err?.message || 'Unknown' }); }
      });
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        hint: 'Failed to load orders.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: ORDER_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    // Find the specific order
    const orders = result.data?.orderList || result.data?.list || result.data?.data || [];
    const order = orders.find(o => String(o.orderId || o.id) === String(orderId));

    if (!order) {
      return {
        success: false,
        error: `Order ${orderId} not found in recent orders`,
        hint: 'The order may not be in the recent order list. Check the order ID.',
        action: 'bb-browser site 1688/order-list',
        input: args,
        url: ORDER_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    return {
      success: true,
      input: args,
      url: ORDER_URL,
      data: order,
      pagination: null,
      recommendedNextActions: [
        { type: 'action', adapter: '1688/order-list', args: {}, reason: 'View all orders' }
      ],
      hints: []
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hint: 'Failed to load order detail.',
      action: `bb-browser open ${ORDER_URL}`,
      input: args,
      url: ORDER_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }
}

module.exports = { orderDetail };
