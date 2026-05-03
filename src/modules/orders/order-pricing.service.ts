import { Injectable } from '@nestjs/common';

export type AdjustmentMode = 'percent' | 'amount';
export type PaymentMethod = 'CASH' | 'BANKING';

@Injectable()
export class OrderPricingService {
  toMoney(value: unknown) {
    return Math.max(0, Math.trunc(Number(value) || 0));
  }

  toRawAdjustmentValue(value: unknown) {
    const numeric = Math.max(0, Number(value) || 0);
    return Number(numeric.toFixed(4));
  }

  normalizeAdjustmentMode(value: unknown, fallback: AdjustmentMode = 'amount'): AdjustmentMode {
    if (value === 'percent' || value === 'amount') return value;
    return fallback;
  }

  normalizePaymentMethod(value: unknown, fallback: PaymentMethod = 'CASH'): PaymentMethod {
    if (value === 'CASH' || value === 'BANKING') return value;
    return fallback;
  }

  calculateTimePrice(rateAmount: number, rateMinutes: number, usedMinutes: number) {
    if (rateAmount <= 0 || rateMinutes <= 0 || usedMinutes <= 0) return 0;
    return Math.floor((rateAmount * usedMinutes) / rateMinutes);
  }
}
