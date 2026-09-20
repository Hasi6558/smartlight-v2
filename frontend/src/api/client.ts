export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Preserve the HTTP error when the response is not JSON.
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export const api = {
  getMqttStatus: () => apiRequest<import('../types/api').MqttStatus>('/api/mqtt/status'),
  getSettings: () => apiRequest<import('../types/api').AppSettings>('/api/settings'),
  saveSetting: (key: string, value: string) => apiRequest<{ success: boolean }>('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }),
  deleteSetting: (key: string) => apiRequest<{ success: boolean }>(`/api/settings/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  connectMqtt: (config: import('../types/api').MqttConfig) => apiRequest<import('../types/api').MqttStatus>('/api/mqtt/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }),
  disconnectMqtt: () => apiRequest<{ success: boolean }>('/api/mqtt/disconnect', { method: 'POST' }),
  getTags: () => apiRequest<import('../types/api').Tag[]>('/api/tags'),
  saveTags: (tags: import('../types/api').Tag[]) => apiRequest<{ success: boolean; count: number }>('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tags),
  }),
  publishMqtt: (topic: string, payload: unknown) => apiRequest<{ success: boolean }>('/api/mqtt/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, payload }),
  }),
  getSkus: () => apiRequest<import('../types/api').Sku[]>('/api/skus'),
  saveSkus: (skus: import('../types/api').Sku[]) => apiRequest<{ success: boolean; count: number }>('/api/skus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(skus),
  }),
  getInventory: () => apiRequest<import('../types/api').InventoryRecord[]>('/api/inventory'),
  adjustInventory: (skuNo: string, quantityDelta: number) => apiRequest<{ success: boolean; newStock: number }>('/api/inventory/adjust', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skuNo, quantityDelta }),
  }),
  batchAdjustInventory: (items: Array<{ skuNo: string; quantityDelta: number }>) => apiRequest<{ success: boolean }>('/api/inventory/batch-adjust', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  }),
  getTransactions: () => apiRequest<import('../types/api').StockTransaction[]>('/api/transactions'),
  getPicklists: () => apiRequest<import('../types/api').Picklist[]>('/api/picklists'),
  savePicklists: (lists: import('../types/api').Picklist[]) => apiRequest<{ success: boolean; count: number }>('/api/picklists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lists),
  }),
  getPicklistTemplates: () => apiRequest<import('../types/api').PicklistTemplate[]>('/api/picklist-templates'),
  savePicklistTemplates: (templates: import('../types/api').PicklistTemplate[]) => apiRequest<{ success: boolean; count: number }>('/api/picklist-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(templates),
  }),
  getNextNumbers: (type: 'PICKLIST' | 'PUTAWAY') => apiRequest<{ orderNo: string; listNo: string }>(`/api/running-numbers/next?listType=${type}`),
  commitList: (orderNo: string, listNo: string, items: Array<{ skuNo: string; quantityDelta: number }>) => apiRequest<{ success: boolean }>('/api/inventory/commit-list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNo, listNo, items }),
  }),
};
