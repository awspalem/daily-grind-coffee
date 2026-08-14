// Indian GST Tax Invoicing (HSN 0901 - Specialty Coffee)
// Compliant with Section 31 of CGST Act 2017 & Rule 46 of CGST Rules
export const ROASTERY_GST_PROFILE = {
    legalName: 'THE DAILY GRIND SPECIALTY ROASTERS PRIVATE LIMITED',
    tradeName: 'The Daily Grind Roastery',
    address: '12th Main Road, HAL 2nd Stage, Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560038',
    country: 'India',
    gstin: '29AABCT0123M1Z5',
    pan: 'AABCT0123M',
    stateCode: '29',
    fssaiNumber: '11224333000456',
    email: 'roastery@dailygrind.coffee',
    phone: '+91 80 4123 9870',
    website: 'https://daily-grind-storefront.pages.dev'
};
export function numberToWordsINR(amount) {
    const rounded = Math.round(amount);
    if (rounded === 0)
        return 'Rupees Zero Only';
    const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const convertLessThanOneThousand = (n) => {
        let current = '';
        if (n >= 100) {
            current += units[Math.floor(n / 100)] + ' Hundred ';
            n %= 100;
        }
        if (n >= 20) {
            current += tens[Math.floor(n / 10)] + ' ';
            n %= 10;
        }
        if (n > 0) {
            current += units[n] + ' ';
        }
        return current.trim();
    };
    let num = rounded;
    let word = '';
    const crores = Math.floor(num / 10000000);
    num %= 10000000;
    if (crores > 0) {
        word += convertLessThanOneThousand(crores) + ' Crore ';
    }
    const lakhs = Math.floor(num / 100000);
    num %= 100000;
    if (lakhs > 0) {
        word += convertLessThanOneThousand(lakhs) + ' Lakh ';
    }
    const thousands = Math.floor(num / 1000);
    num %= 1000;
    if (thousands > 0) {
        word += convertLessThanOneThousand(thousands) + ' Thousand ';
    }
    if (num > 0) {
        word += convertLessThanOneThousand(num) + ' ';
    }
    return `Rupees ${word.trim()} Only`;
}
export function buildGSTInvoiceFromOrder(order) {
    const total = order.totalAmountInr;
    const qty = order.quantity || 1;
    const taxableTotal = +(total / 1.05).toFixed(2);
    const totalGst = +(total - taxableTotal).toFixed(2);
    const cgst = +(totalGst / 2).toFixed(2);
    const sgst = +(totalGst - cgst).toFixed(2);
    const invoiceNum = `INV-2026-${order.orderId.replace(/[^A-Za-z0-9]/g, '')}`;
    const invDate = order.date || new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return {
        invoiceNumber: invoiceNum,
        invoiceDate: invDate,
        orderNumber: order.orderId,
        orderDate: invDate,
        placeOfSupply: 'Karnataka (29)',
        stateCode: '29',
        paymentMode: 'Pre-paid Online (Razorpay / UPI / Cards)',
        customer: {
            name: order.customerName,
            email: order.customerEmail || `${order.customerName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
            address: order.customerLocation ? `${order.customerLocation}, Bengaluru` : '142, 5th Cross, Indiranagar, Bengaluru',
            city: 'Bengaluru',
            state: 'Karnataka',
            postalCode: '560038'
        },
        items: [
            {
                slNo: 1,
                description: order.productDescription,
                hsnCode: '0901',
                grindType: order.grindType || 'Freshly Ground to Order',
                quantity: qty,
                unitPrice: +(taxableTotal / qty).toFixed(2),
                taxableAmount: taxableTotal,
                cgstRate: 2.5,
                cgstAmount: cgst,
                sgstRate: 2.5,
                sgstAmount: sgst,
                totalAmount: total
            }
        ],
        subtotalTaxable: taxableTotal,
        totalCgst: cgst,
        totalSgst: sgst,
        totalGst: totalGst,
        grandTotal: total
    };
}
export function renderGSTInvoiceHTML(inv) {
    const amountWords = numberToWordsINR(inv.grandTotal);
    return `
    <div class="gst-invoice-document" id="gst-invoice-printable">
      <div class="inv-header">
        <div class="inv-brand">
          <div class="inv-logo-badge">☕</div>
          <div>
            <h1 class="inv-legal-name">${ROASTERY_GST_PROFILE.legalName}</h1>
            <p class="inv-address">${ROASTERY_GST_PROFILE.address}, ${ROASTERY_GST_PROFILE.city}, ${ROASTERY_GST_PROFILE.state} - ${ROASTERY_GST_PROFILE.postalCode}</p>
            <p class="inv-tax-ids">
              <span><strong>GSTIN:</strong> ${ROASTERY_GST_PROFILE.gstin}</span> &nbsp;|&nbsp; 
              <span><strong>PAN:</strong> ${ROASTERY_GST_PROFILE.pan}</span> &nbsp;|&nbsp; 
              <span><strong>FSSAI:</strong> ${ROASTERY_GST_PROFILE.fssaiNumber}</span>
            </p>
          </div>
        </div>
        <div class="inv-title-block">
          <div class="inv-badge">TAX INVOICE</div>
          <div class="inv-meta-row"><strong>Invoice No:</strong> <span>${inv.invoiceNumber}</span></div>
          <div class="inv-meta-row"><strong>Date:</strong> <span>${inv.invoiceDate}</span></div>
          <div class="inv-meta-row"><strong>Order Ref:</strong> <span>${inv.orderNumber}</span></div>
          <div class="inv-meta-row"><strong>Place of Supply:</strong> <span>${inv.placeOfSupply}</span></div>
        </div>
      </div>

      <div class="inv-parties-grid">
        <div class="inv-party-card">
          <div class="party-title">BILLED & SHIPPED TO</div>
          <div class="party-name">${inv.customer.name}</div>
          <div class="party-text">${inv.customer.address}</div>
          <div class="party-text">${inv.customer.city}, ${inv.customer.state} - ${inv.customer.postalCode}</div>
          <div class="party-text"><strong>Email:</strong> ${inv.customer.email}</div>
          <div class="party-text"><strong>State Code:</strong> ${inv.stateCode}</div>
        </div>
        <div class="inv-party-card">
          <div class="party-title">DISPATCH & PAYMENT DETAILS</div>
          <div class="party-text"><strong>Roastery Dispatch:</strong> Indiranagar Hub, Bangalore</div>
          <div class="party-text"><strong>Payment Mode:</strong> ${inv.paymentMode}</div>
          <div class="party-text"><strong>Payment Status:</strong> <span style="color: #108548; font-weight:700;">✓ PAID (Authorized)</span></div>
          <div class="party-text"><strong>Reverse Charge:</strong> No</div>
          <div class="party-text"><strong>Roastery Shift:</strong> Convection Batch Roast</div>
        </div>
      </div>

      <table class="inv-table">
        <thead>
          <tr>
            <th style="width: 5%;">#</th>
            <th style="width: 38%;">Description of Goods (Specialty Coffee)</th>
            <th style="width: 10%;">HSN Code</th>
            <th style="width: 6%;">Qty</th>
            <th style="width: 12%;">Rate (₹)</th>
            <th style="width: 12%;">Taxable Value (₹)</th>
            <th style="width: 8%;">CGST (2.5%)</th>
            <th style="width: 8%;">SGST (2.5%)</th>
            <th style="width: 11%;">Total (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${inv.items.map(item => `
            <tr>
              <td style="text-align: center;">${item.slNo}</td>
              <td>
                <strong>${item.description}</strong>
                ${item.grindType ? `<br><small style="color: #666;">Grind: ${item.grindType}</small>` : ''}
              </td>
              <td style="text-align: center; font-weight: 600; font-family: monospace; color: #1c1512;">${item.hsnCode}</td>
              <td style="text-align: center;">${item.quantity}</td>
              <td style="text-align: right;">₹${item.unitPrice.toFixed(2)}</td>
              <td style="text-align: right; font-weight: 600;">₹${item.taxableAmount.toFixed(2)}</td>
              <td style="text-align: right;">₹${item.cgstAmount.toFixed(2)}</td>
              <td style="text-align: right;">₹${item.sgstAmount.toFixed(2)}</td>
              <td style="text-align: right; font-weight: 700;">₹${item.totalAmount.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="inv-summary-container">
        <div class="inv-words-block">
          <div style="font-size: 0.8rem; text-transform: uppercase; color: #666; margin-bottom: 0.2rem;">Invoice Amount in Words:</div>
          <div style="font-weight: 700; color: #1c1512; font-size: 0.95rem;">${amountWords}</div>
          
          <div class="gst-breakdown-box">
            <div style="font-size: 0.8rem; font-weight: 700; margin-bottom: 0.3rem; color: #1c1512;">GST Breakdown Summary (HSN 0901 · Roasted Coffee @ 5%):</div>
            <div style="display: flex; gap: 1.5rem; font-size: 0.82rem; color: #444;">
              <span><strong>Taxable:</strong> ₹${inv.subtotalTaxable.toFixed(2)}</span>
              <span><strong>CGST (2.5%):</strong> ₹${inv.totalCgst.toFixed(2)}</span>
              <span><strong>SGST (2.5%):</strong> ₹${inv.totalSgst.toFixed(2)}</span>
              <span><strong>Total GST:</strong> ₹${inv.totalGst.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div class="inv-totals-table">
          <div class="totals-row">
            <span>Taxable Subtotal:</span>
            <strong>₹${inv.subtotalTaxable.toFixed(2)}</strong>
          </div>
          <div class="totals-row">
            <span>CGST (2.5%):</span>
            <strong>₹${inv.totalCgst.toFixed(2)}</strong>
          </div>
          <div class="totals-row">
            <span>SGST (2.5%):</span>
            <strong>₹${inv.totalSgst.toFixed(2)}</strong>
          </div>
          <div class="totals-row grand-total">
            <span>Total Invoice Value:</span>
            <span>₹${inv.grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div class="inv-footer">
        <div class="inv-declaration">
          <strong>Declaration & Specialty Roaster Warranty:</strong>
          <p>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. Specialty coffee freshly roasted to order under FSSAI license standard. Storage: Store sealed in cool, dry conditions away from moisture.</p>
        </div>
        <div class="inv-signatory">
          <div style="font-size: 0.8rem; font-weight: 600; color: #666; margin-bottom: 0.4rem;">For THE DAILY GRIND SPECIALTY ROASTERS PVT LTD</div>
          <div class="inv-digital-stamp">
            <span style="color: #d97746; font-size: 1.1rem;">☕</span>
            <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1c1512;">Bangalore Roastery Authority</span>
            <span style="font-size: 0.65rem; color: #108548;">✓ Digitally Certified · GST Compliant</span>
          </div>
          <div style="font-size: 0.78rem; font-weight: 700; margin-top: 0.4rem;">Authorized Signatory</div>
        </div>
      </div>
    </div>
  `;
}
