/**
 * FAQ page.
 *
 * Every answer below is sourced from copy that already exists on the site — shipping.html,
 * terms.html, the plan and experience descriptions, the free-shipping banner — and each entry
 * records where. Nothing here answers a question the site does not already answer: inventing a
 * returns window or an international shipping rate is the same error as the opening hours that
 * were written into the homepage schema and then removed.
 *
 * The answers are rendered visibly on the page, not markup-only. Same rule as the missing
 * aggregateRating on the coffee pages: never mark up something a visitor cannot read.
 */
import { SITE, esc, jsonLd } from './seo-data.mjs';
import { PAGE_CSS } from './seo-render.mjs';

export const FAQS = [
  {
    q: 'Is the coffee roasted to order?',
    a: 'Yes. Every order is roasted fresh in small batches at our Indiranagar, Bangalore roastery, and most orders are dispatched within 1–3 business days of roasting. Subscription orders are roasted and dispatched right before each renewal date rather than stockpiled in advance.',
    src: 'shipping.html — Roasting & Dispatch',
  },
  {
    q: 'How long does delivery take, and where do you ship?',
    a: 'Orders within India ship through our courier partner, Shiprocket. International orders may use other carriers. Estimated delivery times are shown at checkout, but they are estimates — courier delays are outside our control. You can track any order from the Track My Order section using your order number.',
    src: 'shipping.html — Shipping',
  },
  {
    q: 'Is shipping free?',
    a: 'Shipping is free on roastery orders over ₹1,200 across India. Free shipping on every subscription delivery is included from the Explorer tier upwards.',
    src: 'index.html announcement bar; subscription plan features',
  },
  {
    q: 'Can I have the coffee ground for my brewer?',
    a: 'Yes, and it is ground the day it ships rather than in advance. Choose your grind at checkout — whole bean, pour over, South Indian filter, espresso, AeroPress, French press or cold brew, depending on the coffee.',
    src: 'product variant grind_options',
  },
  {
    q: 'Can I return coffee if I do not like it?',
    a: 'Coffee is a perishable food product, so we cannot accept returns for a change of mind once a bag has been opened. If an order arrives damaged, incorrect or defective, contact us within 7 days of delivery with your order number and we will arrange a replacement or a refund to your original payment method.',
    src: 'shipping.html / terms.html — Returns & Refunds',
  },
  {
    q: 'How do subscriptions work, and can I cancel?',
    a: 'Subscribe & Save orders renew automatically at the frequency you choose, at a discount off the one-time price. You can change or cancel any time before the next renewal by contacting us with your order number, and there are no cancellation fees.',
    src: 'terms.html — Subscriptions; shipping.html — Subscription Changes',
  },
  {
    q: 'What do the annual plans include that the monthly ones do not?',
    a: 'Annual terms are prepaid, cheaper per bag, and carry the perks that only come with committing to a year: 15-minute video consultations with one of our baristas, a roastery tour seat, a cupping table seat, and — on the Founder tier — a place on the annual estate visit in the Western Ghats.',
    src: 'subscription plan descriptions and feature lists',
  },
  {
    q: 'What can I book at the roastery?',
    a: 'Four things: a 15-minute barista teleconsultation over video, a roastery tour on the roasting floor, a guided cupping session across six single origins, and a three-day estate tour in the Chikmagalur hills. Annual subscribers have consultation credits and seats included with their plan.',
    src: 'experiences catalog',
  },
  {
    q: 'How does the loyalty programme work?',
    a: 'You earn points on every delivered order and redeem them against a future order. Points are worth ₹0.50 each, and there are three tiers — Bronze, Silver and Gold — set by what you have ordered over the last 12 months.',
    src: 'loyalty configuration rendered on the storefront',
  },
  {
    q: 'Where are you, and how do I reach you?',
    a: 'The Daily Roast Roastery is at 100ft Road, Indiranagar, Bangalore, Karnataka 560038. Email support@dailyroast.in or message us on WhatsApp at +91 80 4123 4567 with your order number and we will sort it out.',
    src: 'index.html footer; shipping.html — Contact',
  },
];

export function faqPage(css) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: `${SITE}/faq`,
    mainEntity: FAQS.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Frequently Asked Questions — Roasting, Shipping &amp; Subscriptions | The Daily Roast</title>
<meta name="description" content="How our coffee is roasted to order, how long delivery takes across India, grind options, returns, how subscriptions and the loyalty programme work, and what you can book at the Bangalore roastery.">
<link rel="canonical" href="${SITE}/faq">
<meta name="theme-color" content="#1b1614">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/faq">
<meta property="og:site_name" content="The Daily Roast">
<meta property="og:title" content="Frequently Asked Questions | The Daily Roast">
<meta property="og:description" content="Roasting, shipping across India, grind options, returns, subscriptions and the loyalty programme.">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="${css}">
${PAGE_CSS}
<script type="application/ld+json">
${jsonLd(schema)}
</script>
</head>
<body>
<header class="site-header">
  <div class="nav-container">
    <a href="/" class="brand-logo"><div><span class="brand-name">THE DAILY ROAST</span></div></a>
    <div class="nav-actions"><a class="btn-primary" href="/#catalog">Shop all roasts</a></div>
  </div>
</header>
<main id="main-content" style="max-width:780px; margin:0 auto; padding:2.5rem 1.5rem 4rem;">
  <nav aria-label="Breadcrumb" style="font-size:0.85rem; margin-bottom:1.6rem;"><a href="/">Home</a> · <span>FAQ</span></nav>
  <h1 class="section-title">Frequently asked questions</h1>
  <p class="section-subtitle" style="margin-bottom:2.5rem;">Roasting, delivery, grind, returns, subscriptions and the roastery.</p>
  ${FAQS.map(({ q, a }) => `<section style="margin-bottom:2rem;">
    <h2 style="font-size:1.12rem; margin-bottom:0.5rem;">${esc(q)}</h2>
    <p style="line-height:1.75;">${esc(a)}</p>
  </section>`).join('\n  ')}
  <p style="margin-top:2.5rem;">Still stuck? Email <a href="mailto:support@dailyroast.in">support@dailyroast.in</a>,
  or read the full <a href="/shipping">shipping and returns</a> and <a href="/terms">terms</a> pages.</p>
</main>
<footer class="site-footer">
  <div class="footer-bottom" style="max-width:780px; margin:0 auto; padding:2rem 1.5rem;">
    <span>&copy; 2026 The Daily Roast Roastery Pvt Ltd · Bangalore, India</span>
    <span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/shipping">Shipping &amp; Returns</a></span>
  </div>
</footer>
</body>
</html>
`;
}
