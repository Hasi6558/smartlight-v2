export interface MqttStatus {
  connected: boolean;
  connecting: boolean;
  lastError: string | null;
  apInfo: {
    ID?: string;
    IP?: string;
    MAC?: string;
    Firmware?: string;
  };
  apTrafficSeen: boolean;
  config: MqttConfig;
}

export interface MqttConfig {
  host: string;
  port: string;
  wsPath: string;
  clientId: string;
  username: string;
  password?: string;
  subTopic: string;
}

export type AppSettings = Record<string, string>;

export interface Tag {
  uid: string;
  tagType: string;
  tagId: string;
  tagRef: string;
  areaId: string;
  shopId: string;
  materialId: string;
  description: string;
  defaultColor: number;
  defaultBeep: boolean;
  defaultFlash: boolean;
  parentTag: string;
}

export interface Sku {
  skuNo: string;
  itemLabel: string;
  description: string;
  supplierCustomer: string;
  tagBind: string;
  dateAdded: string;
  productImage: string;
}

export interface InventoryRecord extends Sku {
  stock: number;
  lastUpdated: string | null;
}

export interface StockTransaction {
  id: number;
  orderNo: string;
  picklistNo: string;
  skuNo: string;
  itemLabel: string;
  description: string;
  supplierCustomer: string;
  quantity: number;
  timestamp: string;
  productImage: string;
}

export interface PicklistItem {
  skuNo: string;
  itemLabel: string;
  description: string;
  tagBind: string;
  productImage: string;
  quantity: number;
}

export type PicklistStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface Picklist {
  uid: string;
  type: 'PICKLIST' | 'PUTAWAY';
  orderNo: string;
  listNo: string;
  status: PicklistStatus;
  color?: number | null;
  items: PicklistItem[];
  createdAt: string;
  activatedAt?: string;
  completedAt?: string;
}

export interface PicklistTemplate {
  uid: string;
  name: string;
  type: 'PICKLIST' | 'PUTAWAY';
  items: PicklistItem[];
  createdAt: string;
}
