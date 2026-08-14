const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';
const TOKEN_KV_KEY = 'shiprocket:auth_token';
function isConfigured(email, password) {
    return Boolean(email && password && password !== 'placeholder');
}
export class ShiprocketService {
    email;
    password;
    pickupLocation;
    kv;
    environment;
    usdToInrRate;
    constructor(email, password, pickupLocation, kv, environment = 'development', usdToInrRate = 83) {
        this.email = email;
        this.password = password;
        this.pickupLocation = pickupLocation;
        this.kv = kv;
        this.environment = environment;
        this.usdToInrRate = usdToInrRate;
    }
    get configured() {
        return isConfigured(this.email, this.password);
    }
    get allowMock() {
        return this.environment !== 'production';
    }
    async getAuthToken() {
        if (this.kv) {
            const cached = await this.kv.get(TOKEN_KV_KEY);
            if (cached)
                return cached;
        }
        const res = await fetch(`${SHIPROCKET_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: this.email, password: this.password }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Shiprocket authentication failed: ${err}`);
        }
        const data = await res.json();
        if (this.kv) {
            // Tokens are valid ~10 days; refresh a day early to be safe.
            await this.kv.put(TOKEN_KV_KEY, data.token, { expirationTtl: 9 * 24 * 60 * 60 });
        }
        return data.token;
    }
    async request(path, init = {}) {
        const token = await this.getAuthToken();
        const res = await fetch(`${SHIPROCKET_BASE_URL}${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(init.headers || {}),
            },
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Shiprocket API error (${path}): ${err}`);
        }
        return res.json();
    }
    async createOrder(input) {
        if (!this.configured) {
            if (!this.allowMock) {
                throw new Error('Shiprocket credentials are not configured in production');
            }
            // No live credentials attached yet — simulate a shipment so order fulfillment
            // flows keep working end-to-end in development/demo mode.
            return {
                shiprocketOrderId: 'sr_mock_order_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
                shipmentId: 'sr_mock_shipment_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
                status: 'NEW',
                mock: true,
            };
        }
        if (!input.customerPhone) {
            throw new Error('Order has no customer phone number on file — Shiprocket requires one for courier contact. ' +
                'The storefront checkout does not currently collect a phone number; add that field before ' +
                'live shipments can be auto-pushed. Falling back to manual tracking entry for this order.');
        }
        const totalWeightKg = input.weightKg && input.weightKg > 0 ? input.weightKg : 0.5;
        // Shiprocket's order value is always INR. Convert if the order was placed in another currency.
        const toInr = (cents) => {
            const major = cents / 100;
            return input.currency.toLowerCase() === 'inr' ? major : Math.round(major * this.usdToInrRate * 100) / 100;
        };
        const payload = {
            order_id: input.orderNumber,
            order_date: input.orderDateISO,
            pickup_location: this.pickupLocation || 'Primary',
            billing_customer_name: input.customerName,
            billing_last_name: '',
            billing_address: input.shippingAddress.line1,
            billing_address_2: input.shippingAddress.line2 || '',
            billing_city: input.shippingAddress.city,
            billing_pincode: input.shippingAddress.postal_code,
            billing_state: input.shippingAddress.state,
            billing_country: input.shippingAddress.country,
            billing_email: input.customerEmail,
            billing_phone: input.customerPhone,
            shipping_is_billing: true,
            order_items: input.items.map((item) => ({
                name: item.name,
                sku: item.sku,
                units: item.units,
                selling_price: toInr(item.unitPriceCents).toFixed(2),
            })),
            payment_method: 'Prepaid',
            sub_total: toInr(input.subtotalCents),
            length: 15,
            breadth: 10,
            height: 8,
            weight: totalWeightKg,
        };
        const data = await this.request('/orders/create/adhoc', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return {
            shiprocketOrderId: String(data.order_id),
            shipmentId: String(data.shipment_id),
            status: data.status || 'NEW',
            mock: false,
        };
    }
    async trackShipment(shipmentId) {
        if (!this.configured || shipmentId.startsWith('sr_mock_')) {
            if (!this.allowMock) {
                throw new Error('Shiprocket credentials are not configured in production');
            }
            return {
                awbCode: 'MOCKAWB' + shipmentId.slice(-8).toUpperCase(),
                courierName: 'Demo Courier',
                currentStatus: 'IN TRANSIT',
                trackUrl: undefined,
                mock: true,
            };
        }
        const data = await this.request(`/courier/track/shipment/${shipmentId}`);
        const tracking = data?.[shipmentId]?.tracking_data || data?.tracking_data || {};
        const shipmentTrack = Array.isArray(tracking.shipment_track) ? tracking.shipment_track[0] : undefined;
        return {
            awbCode: shipmentTrack?.awb_code,
            courierName: shipmentTrack?.courier_name,
            currentStatus: tracking.shipment_status || shipmentTrack?.current_status,
            trackUrl: shipmentTrack?.track_url,
            mock: false,
        };
    }
}
