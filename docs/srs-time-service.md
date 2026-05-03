# SRS - Hang hoa dich vu tinh gio (TIME)

## 1. Muc tieu
- Ho tro mot loai hang hoa `TIME` voi gia theo cong thuc `x tien / y phut`.
- Thu ngan co the start/stop dem gio tren tung dong mon trong hoa don.
- Tien line TIME duoc tinh theo thoi gian su dung thuc te, bo phan thap phan tien.
- Mapping 1-1 giua FE -> API -> BE -> CSDL.

## 2. Pham vi
- Product: tao/sua/list/get chi tiet cho `type=TIME`.
- Order/POS: them line TIME, start/stop timer, cap nhat thanh tien line va tong hoa don.
- CSDL: luu cau hinh gia TIME + snapshot gia tai order item + session start/stop.

## 3. Quy tac nghiep vu da chot
- Product `TIME` khong su dung `unit`, khong su dung `weight`.
- Product `TIME` khong nhap gia ban rieng; he thong dung `timeRateAmount` lam gia co so.
- Thoi gian su dung khong lam tron theo step/mode.
- Cong thuc line TIME:
  - `lineTotal = floor(timeRateAmountSnapshot * usedMinutes / timeRateMinutesSnapshot)`
- Mot thoi diem, moi line TIME chi co 1 session dang mo (`endedAt IS NULL`).

## 4. Mo hinh du lieu (CSDL)

### 4.1 Bang `products`
- `type`: `SINGLE | COMBO | TIME`
- `timeRateAmount` (DECIMAL): gia dich vu x tien.
- `timeRateMinutes` (INT): thoi luong chuan y phut.
- `price` van ton tai de tuong thich he thong; voi TIME, BE set = `timeRateAmount`.
- `unit`, `weight` van ton tai tren bang, nhung voi TIME thi BE set `NULL`.

### 4.2 Bang `order_items`
- `pricingTypeSnapshot`: `FIXED | TIME`
- `timeRateAmountSnapshot` (DECIMAL)
- `timeRateMinutesSnapshot` (INT)
- `usedMinutes` (INT, default 0)
- `baseUnitPrice`, `unitPrice`, `totalPrice`:
  - voi TIME: `quantity=1`, `baseUnitPrice=timeRateAmountSnapshot`, `unitPrice=totalPrice=lineTotal`

### 4.3 Bang `order_item_time_sessions`
- `orderItemId`, `startedAt`, `endedAt`, `durationMinutes`, `startedBy`, `endedBy`
- Dung de audit va cong don thoi gian su dung.

## 5. API contract

## 5.1 Products

### POST `/products`
- FE gui:
  - `type`, `sku`, `name`, `categoryId`, `costPrice`, `isActive`, `branchConfigs`, `comboItems`, image fields
  - Neu `type=TIME`: gui them `timeRateAmount`, `timeRateMinutes`
  - Neu `type=TIME`: FE khong gui `unit`, `weight`; `price` gui theo `timeRateAmount` de tuong thich.
- BE xu ly:
  - validate `timeRateAmount > 0`, `timeRateMinutes > 0`
  - ep `unit=NULL`, `weight=NULL`
  - ep `price=timeRateAmount`
  - luu vao `products`.

### PATCH `/products/:id`
- Rule tuong tu POST.

### GET `/products`, GET `/products/:id`
- Tra ve thong tin TIME gom `timeRateAmount`, `timeRateMinutes`, `type`.

## 5.2 Orders

### POST `/orders` va PATCH `/orders/:id`
- FE gui `billItems[]`.
- Neu line la TIME:
  - `pricingTypeSnapshot='TIME'`
  - `timeRateAmountSnapshot`, `timeRateMinutesSnapshot`, `usedMinutes`
  - `quantity` luon 1
- BE `normalizeOrderItems`:
  - lay product theo `productId`
  - neu product type TIME -> tinh `lineTotal` theo cong thuc o muc 3
  - ghi snapshot vao `order_items`.

### POST `/orders/:orderId/items/:itemId/timer/start`
- BE check:
  - order item ton tai trong order
  - `pricingTypeSnapshot='TIME'`
  - chua co session mo
- BE tao 1 ban ghi moi trong `order_item_time_sessions` (`endedAt=NULL`).

### POST `/orders/:orderId/items/:itemId/timer/stop`
- BE check co session mo.
- BE dong session, tinh `durationMinutes`.
- BE cong don `usedMinutes`, tinh lai `lineTotal`.
- BE update `order_items` + recalc tong hoa don `orders`.

### GET `/orders/:orderId/items/:itemId/timer/status`
- Tra `timerStatus` (`RUNNING|STOPPED`), `usedMinutes`, `activeSessionStartedAt`.

## 6. Mapping 1-1 FE -> API -> BE -> CSDL

## 6.1 Tao/sua Product TIME

| FE field | API payload | BE mapping | CSDL |
|---|---|---|---|
| Loai hang hoa = Dich vu tinh gio | `type='TIME'` | branch TIME flow | `products.type='TIME'` |
| Gia dich vu (x tien) | `timeRateAmount` | validate >0; dung lam `price` | `products.timeRateAmount`, `products.price` |
| Thoi luong chuan (y phut) | `timeRateMinutes` | validate >0 | `products.timeRateMinutes` |
| Don vi tinh (an tren FE) | khong gui | ep `unit=NULL` | `products.unit=NULL` |
| Trong luong (an tren FE) | khong gui | ep `weight=NULL` | `products.weight=NULL` |
| Gia ban (an tren FE) | gui `price=timeRateAmount` de tuong thich | override ve `timeRateAmount` | `products.price=timeRateAmount` |

## 6.2 Them line TIME vao hoa don

| FE field | API payload (`billItems[]`) | BE mapping | CSDL |
|---|---|---|---|
| pricing type TIME | `pricingTypeSnapshot='TIME'` | branch TIME in normalize | `order_items.pricingTypeSnapshot='TIME'` |
| Gia snap x tien | `timeRateAmountSnapshot` | fallback product.timeRateAmount neu can | `order_items.timeRateAmountSnapshot` |
| Dinh muc y phut | `timeRateMinutesSnapshot` | fallback product.timeRateMinutes neu can | `order_items.timeRateMinutesSnapshot` |
| So phut da dung | `usedMinutes` | tinh lineTotal | `order_items.usedMinutes` |
| Thanh tien dong | client co the gui, BE tu tinh lai | `lineTotal=floor(x*used/y)` | `order_items.unitPrice,totalPrice` |

## 6.3 Timer start/stop

| FE action | API | BE | CSDL |
|---|---|---|---|
| Bam Bat dau | `POST .../timer/start` | tao session mo | insert `order_item_time_sessions` |
| Bam Tat dem gio | `POST .../timer/stop` | dong session + recalc line/order | update `order_item_time_sessions`, `order_items`, `orders` |
| Tai lai trang | `GET .../timer/status` | tra trang thai running/stop | doc session mo + usedMinutes |

## 7. Hanh vi FE hien tai
- Product modal:
  - Khi chon `TIME`: hien `timeRateAmount`, `timeRateMinutes`; an `unit`, `weight`, `price`.
  - Khi save TIME: payload gui `price=timeRateAmount`, khong gui `unit/weight`.
- POS/Order:
  - Line TIME hien thong tin `x / y phut` + `usedMinutes`.
  - Nut `Bat dau/Tat dem gio` chi hien cho line `pricingTypeSnapshot='TIME'`.
  - Khoa sua `qty` va `unitPrice` cho line TIME.

## 8. Diem can chinh de mapping dat chuan hon

1. `GET /products` query param type trong controller dang khai bao `'SINGLE' | 'COMBO'`; nen them `'TIME'` de khop thuc te su dung.
2. Hien thi danh sach Product: cot `Don vi tinh` va `Gia ban` voi TIME dang hien gia tri chung; co the doi sang `-` va `Theo gio` de tranh nham nghia.
3. Nen bo `unit` khoi `OrderPayload.billItems` cho line TIME o FE (hien co de tuong thich), de contract ro hon.

## 9. Tieu chi chap nhan (UAT)
- Tao moi product TIME thanh cong khi nhap x/y hop le.
- Product TIME luu `unit=NULL`, `weight=NULL`, `price=timeRateAmount`.
- Them TIME vao order tao line `pricingTypeSnapshot=TIME`.
- Start timer khi line dang STOPPED -> RUNNING.
- Stop timer -> cap nhat `usedMinutes`, `lineTotal`, `orders.finalAmount` dung cong thuc.
- Khong the start 2 lan lien tiep khi chua stop.
- Khong the stop khi chua start.
