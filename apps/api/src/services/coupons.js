// Shared by the coupon preview endpoint (storefront cart drawer, informational only) and
// checkout.ts (authoritative — always re-validated at charge time, never trusts a client-sent
// discount amount).
export async function validateCoupon(db, rawCode, subtotalCents) {
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) {
        return { valid: false, error: 'Coupon code required', discountCents: 0 };
    }
    const coupon = await db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1').bind(code).first();
    if (!coupon) {
        return { valid: false, error: 'Invalid or expired coupon code', discountCents: 0 };
    }
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
        return { valid: false, error: 'This coupon has expired', discountCents: 0 };
    }
    if (coupon.max_uses != null && Number(coupon.times_used) >= Number(coupon.max_uses)) {
        return { valid: false, error: 'This coupon has reached its usage limit', discountCents: 0 };
    }
    if (subtotalCents < Number(coupon.minimum_order_cents || 0)) {
        return { valid: false, error: `Minimum order of ${(Number(coupon.minimum_order_cents) / 100).toFixed(2)} required for this code`, discountCents: 0 };
    }
    const discountCents = coupon.discount_type === 'PERCENT'
        ? Math.round((subtotalCents * Number(coupon.discount_value)) / 100)
        : Math.min(Number(coupon.discount_value), subtotalCents);
    return { valid: true, discountCents, couponId: coupon.id, code: coupon.code };
}
