# ☕ The Daily Roast — Cloudflare-First Specialty Coffee Platform

[![Platform](https://img.shields.io/badge/Platform-Cloudflare%20Edge-f38020?logo=cloudflare)](https://developers.cloudflare.com/)
[![Database](https://img.shields.io/badge/Database-Cloudflare%20D1%20(SQL)-blue)](https://developers.cloudflare.com/d1/)
[![AI Engine](https://img.shields.io/badge/AI%20Reasoning-Groq%20GPT--OSS%20120B-f55036)](https://groq.com/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

An enterprise-grade, free-tier-first specialty coffee roastery e-commerce platform and autonomous AI agent ecosystem built natively on **Cloudflare's Edge Stack** with **Groq** reasoning.

**Live:** [dailyroast.in](https://dailyroast.in) (storefront) · [admin.dailyroast.in](https://admin.dailyroast.in) (staff portal, Zero Trust-gated) · [api.dailyroast.in](https://api.dailyroast.in) (Worker API)

---

## 🌟 Key Architecture & Features

- **Storefront ([`apps/storefront`](apps/storefront)):** Artisanal specialty coffee shop UI with interactive roast meters (Acidity, Body, Sweetness), bag weight/grind selectors, persistent cart drawers, promo coupons, and an interactive **AI Barista** chat assistant with optional voice.
- **Generated content pages:** The shop is a single-page app, so the catalog used to live entirely behind `#` anchors on one URL and was invisible to anything that does not run JavaScript. `apps/storefront/scripts/generate-seo.mjs` runs after `vite build` and emits a real page per coffee (`/coffee/<slug>`), per brew method (`/brew/<method>`), a collection page for each, an FAQ, `sitemap.xml` and `llms.txt` — 21 URLs where there were 4. Product/Offer, HowTo, FAQPage and CafeOrCoffeeShop structured data are attached to the pages whose visible text they describe. **The build fails if the products API cannot be reached**, deliberately: a sitemap that silently loses ten URLs reads as ten pages withdrawn.
- **Admin Command Portal ([`apps/admin`](apps/admin)):** Protected by **Cloudflare Zero Trust Access**, offering real-time KPI metrics, immutable inventory movement logs, one-click batch restocks, and multi-state order fulfillment (`ROASTING`, `PACKED`, `SHIPPED`, `REFUNDED`).
- **Edge API Gateway ([`apps/api`](apps/api)):** Cloudflare Worker built with **Hono**, backed by **Cloudflare D1 (SQLite)** transactional data and an immutable inventory ledger to eliminate race-condition oversells.
- **Bot Defense & Security:** **Cloudflare Turnstile** middleware on checkout, inquiry forms and AI chat; edge rate limiting; and verified Stripe webhook signatures with idempotency checks. **Turnstile is currently inert in production** — the middleware short-circuits when `TURNSTILE_SECRET_KEY` is unset or `ENVIRONMENT` is `development`, and a `POST /api/agent/chat` with no token is answered normally. The paid AI endpoints are therefore protected by rate limiting alone until that secret is set (see gap 0.5).
- **Asynchronous & Scheduled Tasks:** **Cloudflare Queues** for background email dispatching and PDF invoice generation; **Cron Triggers** (`0 4 * * *`) for automated D1 snapshot backups to **Cloudflare R2** and low-stock alarms.
- **AI & RAG Subsystem:**
  - **Groq GPT-OSS 120B:** Ultra-low latency reasoning, tool calling, and morning operations briefing.
  - **Groq Whisper (`whisper-large-v3-turbo`):** Press-to-talk voice input for the AI Barista via `POST /api/agent/transcribe`. The transcript re-enters through the ordinary chat path, so voice and typing share one conversation and one escaping path. Replies can be read back with the browser's own speech synthesis. Voice is strictly additive — an unsupported browser, an insecure origin, a denied microphone or a failed transcription all leave the typed chat unchanged.
  - **Cloudflare Workers AI:** `bge-base-en-v1.5` embeddings for vector similarity search across coffee profiles and extraction recipes.
  - **Model Context Protocol (MCP):** JSON-RPC 2.0 endpoint (`/api/mcp`) exposing standardized e-commerce tools.
  - **Safe Mutation Protocol:** All cart additions or destructive operations require explicit user confirmation tokens before execution.

---

## 📁 Monorepo Structure

```
coffee-roast/
├── apps/
│   ├── storefront/             # Customer E-Commerce UI (Cloudflare Pages)
│   ├── admin/                  # Staff Command Portal (Cloudflare Zero Trust)
│   └── api/                    # Cloudflare Worker API, Agents & Queue Consumer
│
├── packages/
│   ├── db/                     # D1 Database Migrations (0001_init.sql) & Seeds
│   └── shared-types/           # Shared TypeScript models, contracts & tool definitions
│
│   apps/storefront/scripts/    # Build-time page generation (coffee, brew, FAQ, sitemap, llms.txt)
│
├── .gitignore
├── package.json
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20.x
- npm >= 10.x

### Installation
```bash
git clone <repo-url>
cd coffee-roast
npm install
npm run build
```

### Running Tests
```bash
npm test
```

### Local Development Servers
Run each service in separate terminals or concurrently:

```bash
# 1. Start Edge Worker API (Port 8787)
npm run dev:api

# 2. Start Customer Storefront (Port 5173)
npm run dev:storefront

# 3. Start Staff Admin Command Portal (Port 5174)
npm run dev:admin
```

---

## 🛡️ Cloudflare Free-Tier Capacity Budget

| Service | Allocation | Role in Daily Roast |
| :--- | :--- | :--- |
| **Workers** | 100,000 req/day | API Gateway, Agent Dispatcher |
| **D1 Database** | 5M read / 100k write rows/day | Transactional Source of Truth & Ledger |
| **R2 Storage** | 10 GB storage, 1M Class A ops/mo | Media Assets, Invoices & Backups |
| **Queues** | 10,000 ops/day | Async Notifications & Webhook Jobs |
| **Turnstile** | Unlimited challenges / 20 widgets | Bot Defense & Anti-Spam |
| **Zero Trust** | Up to 50 free seats | Admin Portal Authentication |
| **Workers AI** | 10,000 neurons/day | Vector Search & Text Embeddings |

---

## 📄 License
MIT © 2026 The Daily Roast Roasting Co.
