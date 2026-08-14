export interface CreateCheckoutSessionInput {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  items: {
    name: string;
    description?: string;
    unitPriceCents: number;
    quantity: number;
  }[];
  shippingCents: number;
  successUrl: string;
  cancelUrl: string;
  currency?: string;
}

export class StripeService {
  constructor(private secretKey?: string, private webhookSecret?: string) {}

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ id: string; url: string }> {
    if (!this.secretKey || this.secretKey.startsWith('sk_test_mock') || this.secretKey === 'placeholder') {
      // In development / demo mode or before live keys are attached, return an edge simulation session
      const mockSessionId = 'cs_mock_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const url = `${input.successUrl}${input.successUrl.includes('?') ? '&' : '?'}session_id=${mockSessionId}&mock_payment=true`;
      return { id: mockSessionId, url };
    }

    // Call standard Stripe REST API
    const lineItems = input.items.map((item, idx) => ({
      [`line_items[${idx}][price_data][currency]`]: input.currency || 'usd',
      [`line_items[${idx}][price_data][product_data][name]`]: item.name,
      [`line_items[${idx}][price_data][product_data][description]`]: item.description || '',
      [`line_items[${idx}][price_data][unit_amount]`]: item.unitPriceCents.toString(),
      [`line_items[${idx}][quantity]`]: item.quantity.toString(),
    }));

    const formParams = new URLSearchParams();
    formParams.append('mode', 'payment');
    formParams.append('customer_email', input.customerEmail);
    formParams.append('success_url', input.successUrl);
    formParams.append('cancel_url', input.cancelUrl);
    formParams.append('client_reference_id', input.orderId);
    formParams.append('metadata[order_id]', input.orderId);
    formParams.append('metadata[order_number]', input.orderNumber);

    for (const itemObj of lineItems) {
      for (const [k, v] of Object.entries(itemObj)) {
        formParams.append(k, v);
      }
    }

    if (input.shippingCents > 0) {
      formParams.append('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
      formParams.append('shipping_options[0][shipping_rate_data][fixed_amount][amount]', input.shippingCents.toString());
      formParams.append('shipping_options[0][shipping_rate_data][fixed_amount][currency]', input.currency || 'usd');
      formParams.append('shipping_options[0][shipping_rate_data][display_name]', 'Standard Roastery Ground Shipping');
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formParams.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Stripe Checkout Session creation failed: ${err}`);
    }

    const data = await res.json() as { id: string; url: string };
    return { id: data.id, url: data.url };
  }

  async verifyWebhookSignature(payload: string, signatureHeader?: string): Promise<boolean> {
    if (!this.webhookSecret || this.webhookSecret === 'placeholder') {
      return true; // Bypass signature verification in local sandbox/test mode
    }

    if (!signatureHeader) return false;

    // Header format: t=1492774577,v1=5257a869e7ecebeda32affa62cd4937ed15e224e558777f40195d5277d1e64ee
    const parts = signatureHeader.split(',').reduce((acc, part) => {
      const [k, v] = part.split('=');
      acc[k] = v;
      return acc;
    }, {} as Record<string, string>);

    if (!parts.t || !parts.v1) return false;

    const signedPayload = `${parts.t}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const hexSig = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return hexSig === parts.v1;
  }
}
