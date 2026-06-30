/**
 * @disclaimer 本适配器由作者独立维护,ma-browser 不为适配器行为背书。
 *             使用者需遵守 药帮忙 服务条款,不得用于反爬/转售/商业化替代。
 *             作者已阅读目标站点 ToS 并认为本适配器合规。
 */
/* @meta
{
  "name": "ybm/order-list",
  "title": "查询药帮忙订单列表",
  "description": "Get order history with pagination and status filter on ybm100.com (药帮忙)",
  "domain": "www.ybm100.com",
  "category": "电商",
  "risk": "medium",
  "readOnly": true,
  "prerequisites": "需先登录 ybm100.com",
  "args": {
    "page": {
      "required": false,
      "description": "Page number, default 1"
    },
    "pageSize": {
      "required": false,
      "description": "Items per page, default 10"
    },
    "startDate": {
      "required": false,
      "description": "Start date filter (YYYY-MM-DD), default 3 months ago"
    },
    "endDate": {
      "required": false,
      "description": "End date filter (YYYY-MM-DD), default today"
    }
  },
  "example": "bb-browser site ybm/order-list --json",
  "capabilities": [
    "network"
  ]
}
*/

const HOME_URL = 'https://www.ybm100.com/new/';
const ORDER_URL = 'https://www.ybm100.com/new/base/order';
const ORDER_API = 'https://www.ybm100.com/new-front/order/index';
const HEADER_API = 'https://www.ybm100.com/new-front/index/header-data';

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function(args) {
  const page = args?.page ?? 1;
  const pageSize = args?.pageSize ?? 10;
  const endDate = args?.endDate || formatDate(new Date());
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  const startDate = args?.startDate || formatDate(d);

  // Navigate to order page if needed to establish auth
  if (!location.hostname.includes('ybm100.com') || !location.pathname.includes('/base/order')) {
    await bb.goto(ORDER_URL, { waitUntil: 'networkidle' });
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  try {
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
        pageNo: page,
        pageSize,
        startCreateTime: startDate,
        endCreateTime: endDate,
        preciseStateQuery: true
      })
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        hint: 'Order list API failed. Your session may have expired.',
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
        error: payload.msg || 'Order list request failed',
        hint: 'Unable to load orders. Make sure you are logged in.',
        action: `bb-browser open ${HOME_URL}`,
        input: args,
        url: HOME_URL,
        data: null,
        pagination: null,
        recommendedNextActions: []
      };
    }

    const orderData = payload.data?.data;
    const pager = orderData?.pager || {};
    const rows = pager.rows || [];
    const total = pager.total || 0;

    // Map orders to contract format
    const orders = rows.map(row => ({
      id: String(row.id || row.orderId || ''),
      status: mapOrderStatus(row.status),
      statusLabel: row.statusName || '',
      createdAt: row.createTime ? new Date(row.createTime).toISOString() : '',
      totalPrice: `¥${(row.payAmount || row.totalAmount || 0).toFixed(2)}`,
      totalPriceValue: row.payAmount || row.totalAmount || 0,
      itemCount: row.productNum || 0,
      items: (row.orderItemList || []).map(item => ({
        id: String(item.skuId || item.id || ''),
        name: item.skuName || item.productName || '',
        spec: item.spec || '',
        price: `¥${(item.price || 0).toFixed(2)}`,
        priceValue: item.price || 0,
        quantity: item.amount || item.quantity || 0,
        image: item.imageUrl || ''
      })),
      shippingAddress: row.address || '',
      url: `https://www.ybm100.com/merchant/center/order/index.htm?orderId=${row.id || row.orderId}`,
      merchantName: row.merchantName || row.shopName || ''
    }));

    const pagination = {
      page: pager.currentPage || page,
      pageSize: pager.limit || pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / (pager.limit || pageSize)) || 0,
      hasMore: (pager.currentPage || page) < Math.ceil(total / (pager.limit || pageSize)),
      nextCursor: null
    };

    const recommendedNextActions = [];
    if (orders.length > 0) {
      recommendedNextActions.push({
        type: 'drill',
        adapter: 'ybm/order-detail',
        args: { orderId: '<from orders[].id>' },
        reason: 'View full order details'
      });
    }
    recommendedNextActions.push({
      type: 'action',
      adapter: 'ybm/search',
      args: { keyword: '<药品名称>' },
      reason: 'Search for products to order'
    });

    return {
      success: true,
      input: { page, pageSize, startDate, endDate },
      url: ORDER_URL,
      requestedConstraints: [
        { key: 'page', value: page, source: 'arg' },
        { key: 'pageSize', value: pageSize, source: 'arg' },
        { key: 'startDate', value: startDate, source: 'arg' },
        { key: 'endDate', value: endDate, source: 'arg' }
      ],
      executedConstraints: [
        { key: 'page', value: page, source: 'arg' },
        { key: 'pageSize', value: pageSize, source: 'arg' },
        { key: 'startDate', value: startDate, source: 'arg' },
        { key: 'endDate', value: endDate, source: 'arg' }
      ],
      deferredConstraints: [],
      data: orders,
      pagination,
      recommendedNextActions,
      hints: orders.length === 0 ? ['No orders found in the selected date range.'] : []
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
