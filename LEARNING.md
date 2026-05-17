# POS System Backend Learning (Comprehensive API Contract)

Base prefix: `/api`

Default auth rule:
- Protected endpoints require `Authorization: Bearer <token>`.
- Public endpoints are explicitly marked below.

## Auth payloads

- `CurrentUser` shape (used by `/auth/login` and `/auth/me`):
  - `{ id: string, username: string, fullName: string | null, role: string, branchId: string | null, branchName: string | null }`
  - practical role values: `ADMIN | MANAGER | STAFF`

---

## 1) Authentication APIs

### `POST /api/auth/login`
- Auth: public
- Request body:
  - `{ username: string, password: string, branchId: string }`
- Response body:
  - `{ user: CurrentUser, token: string }`
- Business intention:
  - Primary login; validates user/password/branch access and returns session token.

### `POST /api/auth/login-context`
- Auth: public
- Request body:
  - `{ username: string }`
- Response body:
  - `{ username: string, role: string, branchId: string | null, branchName: string | null }`
- Business intention:
  - Pre-login context lookup; helps UI determine branch/role flow before password submission.

### `GET /api/auth/me`
- Auth: bearer required
- Request body: none
- Response body:
  - `CurrentUser`
- Business intention:
  - Validates token and restores session identity.

### `POST /api/auth/change-password`
- Auth: bearer required
- Request body:
  - `{ currentPassword: string, newPassword: string, confirmNewPassword: string }`
- Response body:
  - `{ success: true }`
- Business intention:
  - Authenticated user password change.

---

## 2) Public Utility APIs

NOTE: this is conflicting with /api/auth/login-context
### `GET /api/branches`
- Auth: public
- Request body: none
- Response body:
  - `Array<{ id: string, name: string, ...branchFields }>`
- Business intention:
  - Branch list discovery for branch selection/bootstrap UX.

NOTE: this is just a hack, so let get rid of it and implement proper procedure
### `GET /api/health/schema`
- Auth: public
- Request body: none
- Response body:
  - `{ ok: boolean, requiredColumns: string[], missingColumns: string[] }`
- Business intention:
  - Runtime DB schema guard visibility (ops/debug).

---

## 3) Product APIs

## Product DTOs

- `CreateOrUpdateProductDto`:
  - `{ type?: 'SINGLE'|'COMBO'|'TIME', autoPrice?: boolean, sku?: string, name: string, categoryId?: string|null, unit?: string, weight?: number, costPrice?: number, price: number, timeRateAmount?: number, timeRateMinutes?: number, isActive?: boolean, branchConfigs?: Array<{ branchId: string, isActive: boolean, stock?: number }>, comboItems?: Array<{ itemProductId: string, quantity: number, itemName?: string, itemUnit?: string }>, imageUrl?: string|null, imageThumb?: string|null }`

### `GET /api/products`
- Auth: bearer required
- Request body: none
- Query:
  - `page?: string, pageSize?: string, type?: 'SINGLE'|'COMBO'|'TIME', categoryId?: string, stockStatus?: 'all'|'in_stock'|'out_of_stock', branchId?: string, search?: string`
- Response body:
  - `{ items: ProductListItem[], pagination: { page: number, pageSize: number, total: number, totalPages: number } }`
- Business intention:
  - Product catalog list for sales/inventory with filtering and branch scoping.

### `GET /api/products/:id`
- Auth: bearer required
- Request body: none
- Response body:
  - `ProductDetail` (single product + branchConfigs/comboItems where applicable)
- Business intention:
  - Product detail for edit/view.

### `GET /api/products/:id/delete-impact`
- Auth: bearer required
- Permission: `PRODUCTS_DELETE`
- Request body: none
- Response body:
  - `{ totalOrders: number, orders: Array<{ orderId: string, orderCode: string, orderState: 'DRAFT'|'PARTIAL'|'PAID'|'UNPAID'|'DELETED', createdAt: string, itemCount: number }> }`
- Business intention:
  - Read-only pre-delete impact preview.

### `POST /api/products`
- Auth: bearer required
- Permission: `PRODUCTS_CREATE`
- Request body:
  - `CreateOrUpdateProductDto`
- Response body:
  - `CreatedProduct` (inserted product row)
- Business intention:
  - Create product master record (single/combo/time models).

### `PATCH /api/products/:id`
- Auth: bearer required
- Permission: `PRODUCTS_UPDATE`
- Request body:
  - `CreateOrUpdateProductDto`
- Response body:
  - `UpdatedProduct` (selected product row)
- Business intention:
  - Update product configuration, pricing, stock mapping, media.

### `DELETE /api/products/:id`
- Auth: bearer required
- Permission: `PRODUCTS_DELETE`
- Request body: none
- Response body:
  - `{ success: true, affectedOrders: number, removedItems: number }`
- NOTE: Current behavior is hybrid, not full hard delete. The product row is soft-deleted (`products.deletedAt` is set), while related `order_items` rows are hard-deleted and impacted orders are recalculated.
- NOTE: Desired behavior (per product direction) is full hard delete across product + related data paths.
- Business intention:
  - Actual delete operation; updates impacted orders and soft-deletes product.

Difference between product delete endpoints:
- `GET /api/products/:id/delete-impact`: preview only, no mutation.
- `DELETE /api/products/:id`: performs deletion and side-effect recalculations.
- NOTE: Despite being a delete endpoint, current implementation does not physically remove the `products` row.


### `POST /api/products/upload-image`
- Auth: bearer required
- Permission: `PRODUCTS_CREATE`
- Request body:
  - `multipart/form-data` with `image` file (max 5MB)
- Response body:
  - `{ imageUrl: string, imageThumb: string, sizeKb: number }`
- Business intention:
  - Image preprocessing endpoint for product media payload
NOTE: ok right now it is uploading raw file to API, and then download to the client, and then upload from the client again, it is redundant, we will get rid of this and process directly on front-end instead


---

## 4) Category APIs

### `GET /api/categories`
- Auth: bearer required
- Request body: none
- Response body:
  - `Array<{ id: string, name: string, isActive: boolean, createdAt: string, productCount: number }>`
- Business intention:
  - Category management list with usage count.

### `POST /api/categories`
- Auth: bearer required
- Permission: `CATEGORIES_MANAGE`
- Request body:
  - `{ name: string }`
- Response body:
  - `{ id: string, name: string, isActive: boolean, createdAt: string }`
- Business intention:
  - Create category taxonomy.

### `PATCH /api/categories/:id`
- Auth: bearer required
- Permission: `CATEGORIES_MANAGE`
- Request body:
  - `{ name: string }`
- Response body:
  - `{ id: string, name: string, isActive: boolean, createdAt: string, updatedAt: string }`
- Business intention:
  - Update category name.

### `DELETE /api/categories/:id`
- Auth: bearer required
- Permission: `CATEGORIES_MANAGE`
- Request body: none
- Response body:
  - `{ success: true, affectedProductCount: number, message: string }`
- Business intention:
  - Delete category; detaches category links from products.

---

NOTE: this is floor level / area
## 5) Area APIs

### `GET /api/areas`
- Auth: bearer required
- Request body: none
- Query: `branchId?: string`
- Response body:
  - `Array<{ id: string, name: string, branchId: string | null, createdAt: string, updatedAt: string, roomCount: number, tableCount: number }>`
- Business intention:
  - Area list for floor zoning.

### `POST /api/areas`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body:
  - `{ name: string, branchId?: string }`
- Response body:
  - `{ id: string, name: string, branchId: string | null }`
- Business intention:
  - Create area.

### `PATCH /api/areas/:id`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body:
  - `{ name: string, branchId?: string }`
- Response body:
  - `{ id: string, name: string, branchId: string | null }`
- Business intention:
  - Update area.

### `DELETE /api/areas/:id`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body: none
- Response body:
  - `{ success: true }`
- Business intention:
  - Delete area and clear linked order location refs.
NOTE: shouldn't clear linked order location refs, it will just delete the table, not the info on the old itself

### `GET /api/areas/:id/delete-impact`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body: none
- Response body:
  - `{ id: string, name: string, activeOrderCount: number }`
- Business intention:
  - Pre-delete impact preview.
NOTE: since we dont do linked order above anymore, this is no longer needed

---

## 6) Room APIs

### `GET /api/rooms`
- Auth: bearer required
- Request body: none
- Query: `areaId?: string, branchId?: string`
- Response body:
  - `Array<{ id: string, name: string, areaId: string, branchId: string | null, createdAt: string, updatedAt: string, areaName: string, tableCount: number }>`
- Business intention:
  - Room list for sub-zones.

### `POST /api/rooms`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body:
  - `{ name: string, areaId: string, branchId?: string }`
- Response body:
  - `{ id: string, name: string, areaId: string, branchId: string | null }`
- Business intention:
  - Create room.

### `PATCH /api/rooms/:id`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body:
  - `{ name: string, areaId: string, branchId?: string }`
- Response body:
  - `{ id: string, name: string, areaId: string, branchId: string | null }`
- Business intention:
  - Update room and keep area consistency.

### `DELETE /api/rooms/:id`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body: none
- Response body:
  - `{ success: true }`
- Business intention:
  - Delete room and clear linked order refs.
NOTE: same logic as the Area one

### `GET /api/rooms/:id/delete-impact`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body: none
- Response body:
  - `{ id: string, name: string, activeOrderCount: number }`
- Business intention:
  - Pre-delete impact preview.
NOTE: same logic as the Area one

---

## 7) Dining Table APIs

NOTE: FUll management list
### `GET /api/dining-tables`
- Auth: bearer required
- Request body: none
- Query:
  - `branchId?: string, areaId?: string, roomId?: string, search?: string, page?: string, pageSize?: string`
- Response body:
  - `{ items: DiningTableRow[], pagination: { page: number, pageSize: number, total: number, totalPages: number } }`
- Business intention:
  - Main table management list.

NOTE: more for controls and dropdown
### `GET /api/dining-tables/options`
- Auth: bearer required
- Request body: none
- Query: `branchId?: string`
- Response body:
  - `Array<{ id: string, name: string, areaId: string, roomId: string | null, areaName: string, roomName: string | null }>`
- Business intention:
  - Lightweight list for selectors when assigning order locations.

### `POST /api/dining-tables`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body:
  - `{ name: string, areaId: string, roomId?: string | null, branchId?: string, capacity?: number }`
- Response body:
  - `{ id: string, name: string, areaId: string, roomId: string | null, branchId: string | null }`
- Business intention:
  - Create table entity.

### `PATCH /api/dining-tables/:id`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body:
  - `{ name: string, areaId: string, roomId?: string | null, branchId?: string, capacity?: number }`
- Response body:
  - `{ id: string, name: string, areaId: string, roomId: string | null, branchId: string | null }`
- Business intention:
  - Update table metadata and location.

### `DELETE /api/dining-tables/:id`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body: none
- Response body:
  - `{ success: true }`
- Business intention:
  - Delete table and clear linked order refs.
NOTE: same logic as the Area one

### `GET /api/dining-tables/:id/delete-impact`
- Auth: bearer required
- Permission: `TABLES_ACCESS`
- Request body: none
- Response body:
  - `{ id: string, name: string, activeOrderCount: number }`
- Business intention:
  - Pre-delete impact preview.
NOTE: same logic as the Area one

---

## 8) Order APIs

## Order DTOs

- `CreateOrderDto` and `UpdateOrderDto` include:
  - header fields: `entityType`, `tableId`, `roomId`, `customerName`, `totalAmount`, discount/surcharge fields, `paidAmount`, `paymentMethod`, `orderState`, `branchId`, `applySaveStatusRules`
  - line fields in `billItems`: `lineId`, `productId`, `productName`, `unit`, `baseUnitPrice`, `unitPrice`, `quantity`, `note`, pricing snapshots, time usage/session fields, line discount/surcharge
  - update supports `billItemsPatch` (`addedItems`, `updatedItems`, `removedItemIds`)

### `GET /api/orders`
- Auth: bearer required
- Request body: none
- Query:
  - `branchId?, page?, pageSize?, search?, orderStates?, statuses?, paymentMethod?, areaId?, roomId?, tableId?, startDate?, endDate?`
- Response body:
  - `{ items: Array<{ id, code, tableName, customerName, creatorName, totalAmount, finalAmount, paidAmount, paymentMethod, orderState, createdAt }>, pagination: { page, pageSize, total, totalPages } }`
- Business intention:
  - Operational order list with filters and priority sorting.

### `POST /api/orders`
- Auth: bearer required
- Request body:
  - `CreateOrderDto`
- Response body:
  - `{ id: string, code: string, itemMappings: Array<{ clientLineId: string, orderItemId: string }> }`
- Business intention:
  - Create bill/order with total/state computation and audit logging.

### `GET /api/orders/:id`
- Auth: bearer required
- Request body: none
- Response body:
  - `OrderDetail` including header, computed totals, and full `items[]`.
- Business intention:
  - Detailed order retrieval for checkout/edit/print views.

### `PATCH /api/orders/:id`
- Auth: bearer required
- Request body:
  - `UpdateOrderDto`
- Response body:
  - `{ success: true }`
- Business intention:
  - Update order lines/payment/location/state with change logging.

### `POST /api/orders/:id/print`
- Auth: bearer required
- Request body: none
- Response body:
  - `{ success: true }`
- Business intention:
  - Record print action in order logs.

### `GET /api/orders/:id/logs`
- Auth: bearer required
- Request body: none
- Response body:
  - `Array<{ id: string, action: string, detail: string | null, snapshot: unknown, createdBy: string | null, createdByName: string | null, createdAt: string }>`
- Business intention:
  - Audit trail for edits/deletes/prints.

### `DELETE /api/orders/:id`
- Auth: bearer required
- Permission: `ORDERS_DELETE`
- Request body: none
- Response body:
  - `{ success: true }`
- Business intention:
  - Soft-delete order (state becomes `DELETED`, items removed).

### `DELETE /api/orders/:id/hard`
- Auth: bearer required
- Permission: `ORDERS_DELETE`
- Request body: none
- Response body:
  - `{ success: true }`
- Business intention:
  - Hard-delete order for exceptional cleanup.

---

## 9) Report APIs

All report endpoints:
- Auth: bearer required
- Permission: `REPORTS_ACCESS`

### `GET /api/reports/sales/end-of-day`
- Request body: none
- Query:
  - `branchId?, startDate?, endDate?, search?, orderStates?, areaId?, roomId?, tableId?, paymentMethod?`
- Response body:
  - `{ groups: Array<{ date: string, summary: { orderCount, paymentAmount, debtAmount, revenueAmount, grossAmount, discountAmount, totalQuantity, serviceAmount }, rows: Array<{ id, code, createdAt, receiverName, paymentAmount, debtAmount, revenueAmount, grossAmount, discountAmount, totalQuantity, serviceAmount, locationLabel, paymentMethod }> }>, creators: Array<{ id: string, name: string }> }`
- Business intention:
  - End-of-day grouped reconciliation and cashier performance view.

### `GET /api/reports/products`
- Request body: none
- Query:
  - `branchId?, startDate?, endDate?, categoryId?, search?, type?, stockStatus?`
- Response body:
  - `{ rows: Array<{ productId, productName, unit, categoryId, categoryName, costPrice, totalQuantity, grossAmount, discountAmount, surchargeAmount, netAmount, grossProfit, orderDetails }> }`
- Business intention:
  - Product sales/profit analytics by date range.

---

## 10) Cross-cutting notes

- Branch policy scopes most reads/writes by user role and branch context.
- `delete-impact` endpoints are confirmation helpers before destructive calls.
- Time-priced products are supported in order line snapshots.
- `orderState` lifecycle used in backend: `DRAFT | UNPAID | PARTIAL | PAID | DELETED`.
