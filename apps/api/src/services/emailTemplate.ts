export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export function generateLoginCodeEmail(params: { email: string; code: string }): EmailPayload {
  const { email, code } = params;

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8" /><title>Your login code</title></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fcf9f5; margin: 0; padding: 24px;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #ede5dc; padding: 36px; box-shadow: 0 4px 12px rgba(0,0,0,0.03); text-align: center;">
        <h1 style="color: #1c1512; margin: 0 0 4px; font-size: 22px; letter-spacing: 1px;">☕ THE DAILY ROAST</h1>
        <p style="color: #8c7e72; font-size: 12px; margin: 0 0 24px; text-transform: uppercase; letter-spacing: 2px;">Small Batch Specialty Roastery</p>

        <p style="color: #554a41; font-size: 15px; margin-bottom: 8px;">Your login code:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1c1512; background: #fdf8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          ${code}
        </div>
        <p style="color: #8c7e72; font-size: 13px;">Expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
      </div>
    </body>
    </html>
  `;

  return {
    to: email,
    subject: `${code} is your The Daily Roast login code`,
    html,
  };
}

export function generateOrderConfirmationEmail(params: {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  totalCents: number;
  items: { name: string; weightGrams: number; grindType: string; priceCents: number; quantity: number }[];
  storefrontUrl: string;
}): EmailPayload {
  const { orderNumber, customerName, customerEmail, totalCents, items, storefrontUrl } = params;

  const itemsHtml = items.map((it) => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 12px 0;">
        <strong style="color: #1e1b18;">${it.name}</strong><br/>
        <span style="font-size: 13px; color: #777;">${it.weightGrams}g · ${it.grindType.replace('_', ' ')}</span>
      </td>
      <td style="padding: 12px 0; text-align: center; color: #555;">${it.quantity}</td>
      <td style="padding: 12px 0; text-align: right; font-weight: bold; color: #1e1b18;">$${((it.priceCents * it.quantity) / 100).toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Order Confirmation #${orderNumber}</title>
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fcf9f5; margin: 0; padding: 24px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #ede5dc; padding: 36px; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
        <div style="text-align: center; border-bottom: 2px solid #d4883b; padding-bottom: 20px; margin-bottom: 24px;">
          <h1 style="color: #1c1512; margin: 0; font-size: 24px; letter-spacing: 1px;">☕ THE DAILY ROAST</h1>
          <p style="color: #8c7e72; font-size: 12px; margin: 4px 0 0; text-transform: uppercase; letter-spacing: 2px;">Small Batch Specialty Roastery</p>
        </div>

        <h2 style="color: #1c1512; font-size: 20px;">Thank you for your order, ${customerName || 'Coffee Lover'}!</h2>
        <p style="color: #554a41; line-height: 1.6; font-size: 15px;">
          We have received your order <strong>#${orderNumber}</strong>. Your beans will be roasted to order on our next scheduled roast day to ensure peak aromatic profile and degassing freshness.
        </p>

        <table style="width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 14px;">
          <thead>
            <tr style="border-bottom: 2px solid #1c1512; text-align: left;">
              <th style="padding-bottom: 8px;">Coffee</th>
              <th style="padding-bottom: 8px; text-align: center;">Qty</th>
              <th style="padding-bottom: 8px; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div style="text-align: right; font-size: 18px; margin-bottom: 30px;">
          <span style="color: #8c7e72; font-size: 14px;">Total Paid: </span>
          <strong style="color: #1c1512;">$${(totalCents / 100).toFixed(2)}</strong>
        </div>

        <div style="background: #fdf8f0; border-radius: 8px; padding: 16px; border: 1px dashed #d4883b; margin-bottom: 28px; text-align: center;">
          <p style="margin: 0; font-size: 14px; color: #7a4b1b;">
            💡 <strong>Barista Tip:</strong> For light and medium roasts, allow 5 to 7 days from roast date for optimum degassing before brewing!
          </p>
        </div>

        <div style="text-align: center;">
          <a href="${storefrontUrl}/#order-lookup" style="background: #1c1512; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">
            Track Order Live at the Edge
          </a>
        </div>
      </div>
    </body>
    </html>
  `;

  return {
    to: customerEmail,
    subject: `☕ Order Confirmation #${orderNumber} — The Daily Roast Roastery`,
    html,
  };
}

export function generateAbandonedCartEmail(params: {
  customerEmail: string;
  items: { name: string; weightGrams: number; grindType: string }[];
  resumeUrl: string;
}): EmailPayload {
  const { customerEmail, items, resumeUrl } = params;
  const customerName = customerEmail.split('@')[0];

  const itemsHtml = items.map((it) => `
    <li style="padding: 8px 0; color: #1e1b18;">
      <strong>${it.name}</strong>
      <span style="font-size: 13px; color: #777;"> — ${it.weightGrams}g · ${it.grindType.replace(/_/g, ' ')}</span>
    </li>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8" /><title>You left something at the roastery</title></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fcf9f5; margin: 0; padding: 24px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #ede5dc; padding: 36px; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
        <div style="text-align: center; border-bottom: 2px solid #d4883b; padding-bottom: 20px; margin-bottom: 24px;">
          <h1 style="color: #1c1512; margin: 0; font-size: 24px; letter-spacing: 1px;">☕ THE DAILY ROAST</h1>
          <p style="color: #8c7e72; font-size: 12px; margin: 4px 0 0; text-transform: uppercase; letter-spacing: 2px;">Small Batch Specialty Roastery</p>
        </div>

        <h2 style="color: #1c1512; font-size: 20px;">Still thinking it over, ${customerName}?</h2>
        <p style="color: #554a41; line-height: 1.6; font-size: 15px;">
          You left these in your cart. They're still fresh and waiting for you:
        </p>

        <ul style="list-style: none; padding: 0; margin: 20px 0;">
          ${itemsHtml}
        </ul>

        <div style="text-align: center; margin-top: 28px;">
          <a href="${resumeUrl}" style="background: #1c1512; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">
            Complete Your Order
          </a>
        </div>
      </div>
    </body>
    </html>
  `;

  return {
    to: customerEmail,
    subject: `☕ You left some coffee behind — The Daily Roast`,
    html,
  };
}

export function generateReviewRequestEmail(params: {
  customerEmail: string;
  orderNumber: string;
  products: { productId: string; name: string }[];
  storefrontUrl: string;
}): EmailPayload {
  const { customerEmail, orderNumber, products, storefrontUrl } = params;
  const customerName = customerEmail.split('@')[0];

  const linksHtml = products.map((p) => `
    <div style="text-align: center; margin-bottom: 12px;">
      <a href="${storefrontUrl}/?review_product=${encodeURIComponent(p.productId)}" style="color: #d4883b; text-decoration: none; font-weight: bold; font-size: 14px;">
        ★ Rate ${p.name}
      </a>
    </div>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8" /><title>How was your coffee?</title></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fcf9f5; margin: 0; padding: 24px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #ede5dc; padding: 36px; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
        <div style="text-align: center; border-bottom: 2px solid #d4883b; padding-bottom: 20px; margin-bottom: 24px;">
          <h1 style="color: #1c1512; margin: 0; font-size: 24px; letter-spacing: 1px;">☕ THE DAILY ROAST</h1>
          <p style="color: #8c7e72; font-size: 12px; margin: 4px 0 0; text-transform: uppercase; letter-spacing: 2px;">Small Batch Specialty Roastery</p>
        </div>

        <h2 style="color: #1c1512; font-size: 20px;">How was order #${orderNumber}, ${customerName}?</h2>
        <p style="color: #554a41; line-height: 1.6; font-size: 15px;">
          We hope it's been a great cup. A quick review helps other coffee lovers (and us) — it takes less than a minute:
        </p>

        <div style="margin: 24px 0;">
          ${linksHtml}
        </div>
      </div>
    </body>
    </html>
  `;

  return {
    to: customerEmail,
    subject: `How was your coffee? Rate order #${orderNumber}`,
    html,
  };
}
