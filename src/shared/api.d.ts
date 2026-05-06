export {};

export type Site = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
  lastExtractedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSiteInput = {
  code: string;
  name: string;
  username: string;
  password: string;
  enabled?: boolean;
};

export type UpdateSiteInput = {
  id: number;
  code?: string;
  name?: string;
  username?: string;
  password?: string;
  enabled?: boolean;
};

export type Order = {
  id: number;
  siteId: number;
  siteName?: string;
  siteCode?: string;
  orderNumber: string;
  orderDate: string;
  productName: string;
  quantity: number;
  amount: number;
  currency: string;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
  shippingStatus: string | null;
  rawData: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListOrdersInput = {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
};

export type ListOrdersBySiteInput = ListOrdersInput & {
  siteId: number;
};

export type ListAllOrdersInput = ListOrdersInput & {
  siteIds?: number[];
};

export type ExportOrdersInput = {
  siteId?: number;
  siteIds?: number[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
};

declare global {
  interface Window {
    api: {
      app: {
        ping: () => Promise<string>;
        getVersion: () => Promise<string>;
      };
      sites: {
        list: () => Promise<Site[]>;
        create: (input: CreateSiteInput) => Promise<Site>;
        update: (input: UpdateSiteInput) => Promise<Site>;
        delete: (input: { id: number }) => Promise<{
          success: boolean;
          deletedId: number;
        }>;
      };
      orders: {
        listBySite: (
          input: ListOrdersBySiteInput
        ) => Promise<PaginatedResult<Order>>;
        listAll: (
          input: ListAllOrdersInput
        ) => Promise<PaginatedResult<Order>>;
        export: (input: ExportOrdersInput) => Promise<string>;
      };
    };
  }
}
