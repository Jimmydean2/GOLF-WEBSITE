// Configurable Quebec sales tax rates. Both GST and QST apply to the
// pre-tax subtotal (not compounded on each other, per current QC tax
// rules). Change these two constants if rates ever change — nothing else
// needs to be touched.
export const GST_RATE = 0.05;
export const QST_RATE = 0.09975;

export type PriceBreakdown = {
  subtotalCents: number;
  gstCents: number;
  qstCents: number;
  totalCents: number;
};

export function calculateTotal(subtotalCents: number): PriceBreakdown {
  const gstCents = Math.round(subtotalCents * GST_RATE);
  const qstCents = Math.round(subtotalCents * QST_RATE);
  return { subtotalCents, gstCents, qstCents, totalCents: subtotalCents + gstCents + qstCents };
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
