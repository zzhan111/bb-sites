/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 药帮忙 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "ybm/order-detail",
  "title": "查看药帮忙订单详情",
  "description": "Get single order detail by order ID on ybm100.com (药帮忙)",
  "domain": "www.ybm100.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 ybm100.com,需订单号",
  "args": {
    "orderId": {
      "required": true,
      "description": "Order ID to get details for"
    }
  },
  "example": "bb-browser site ybm/order-detail --orderId 1 --json",
  "capabilities": [
    "network"
  ]
}
*/

const HOME_URL = 'https://www.ybm100.com/new/';
const ORDER_URL = 'https://www.ybm100.com/new/base/order';
const ORDER_API = 'https://www.ybm100.com/new-front/order/index';

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function(args) {
  const orderId = args?.orderId ?? '';

  if (!orderId) {
    return {
      success: false,
      error: 'Missing required argument: orderId',
      hint: 'Provide an orderId from order-list results.',
      action: 'bb-browser site ybm/order-detail --orderId <ORDER_ID>',
      input: args,
      url: HOME_URL,
      data: null,
      pagination: null,
      recommendedNextActions: []
    };
  }

  if (!location.hostname.includes('ybm100.com') || !location.pathname.includes('/base/order')) {
    await bb.goto(ORDER_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  try {
    // Query orders with a broad date range and find the specific order
    const endDate = formatDate(new Date());
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    const startDate = formatDate(d);

    const response = await fetch(ORDER_API, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Referer': ORDER_URL
      },
      body: JSON.stringify({
        invoiceState: '',
        pageNo: 1,
        pageSize: 50,
        startCreateTime: startDate,
        endCreateTime: endDate,
        preciseStateQuery: true
      })
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        hint: 'Order detail API failed.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const payload = await response.json();
    if (!payload.success) {
      return {
        success: false,
        error: payload.msg || 'Order lookup failed',
        hint: 'Make sure you are logged in.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const rows = payload.data?.data?.pager?.rows || [];
    const order = rows.find(r => String(r.id) === String(orderId) || String(r.orderId) === String(orderId));

    if (!order) {
      return {
        success: false,
        error: `Order ${orderId} not found`,
        hint: 'The order may not exist or is outside the searchable date range.',
        action: 'bb-browser site ybm/order-list',
        input: args,
        url: ORDER_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const items = (order.orderItemList || []).map(item => ({
      id: String(item.skuId || item.id || ''),
      name: item.skuName || item.productName || '',
      spec: item.spec || '',
      manufacturer: item.manufacturer || '',
      price: `¥${(item.price || 0).toFixed(2)}`,
      priceValue: item.price || 0,
      quantity: item.amount || item.quantity || 0,
      subtotal: item.subtotal || item.price * (item.amount || 0) || 0,
      image: item.imageUrl || ''
    }));

    return {
      success: true,
      input: args,
      url: `https://www.ybm100.com/merchant/center/order/index.htm?orderId=${order.id || order.orderId}`,
      data: {
        id: String(order.id || order.orderId || ''),
        status: mapOrderStatus(order.status),
        statusLabel: order.statusName || '',
        createdAt: order.createTime ? new Date(order.createTime).toISOString() : '',
        totalPrice: `¥${(order.payAmount || order.totalAmount || 0).toFixed(2)}`,
        totalPriceValue: order.payAmount || order.totalAmount || 0,
        itemCount: order.productNum || items.length,
        items,
        shippingAddress: order.address || '',
        merchantName: order.merchantName || order.shopName || '',
        orderNo: order.orderNo || '',
        payAmount: order.payAmount || 0,
        freightAmount: order.freightAmount || 0,
        discountAmount: order.discountAmount || 0
      },
      pagination: null,
      recommendedNextActions: [
        {
          type: 'action',
          adapter: 'ybm/order-list',
          args: {},
          reason: 'View all orders'
        },
        {
          type: 'action',
          adapter: 'ybm/search',
          args: { keyword: '<药品名称>' },
          reason: 'Reorder products'
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

function mapOrderStatus(status) {
  const map = {
    0: 'pending_payment', 1: 'paid', 2: 'shipped', 3: 'delivered',
    4: 'cancelled', 7: 'pending_approval', 9: 'refunded',
    10: 'shipped', 11: 'pending', 20: 'pending_approval',
    21: 'cancelled', 90: 'cancelled', 91: 'cancelled'
  };
  return map[status] || 'unknown';
}
