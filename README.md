# ☕ The Daily Grind — Cloudflare-First Specialty Coffee Platform

[![Platform](https://img.shields.io/badge/Platform-Cloudflare%20Edge-f38020?logo=cloudflare)](https://developers.cloudflare.com/)
[![Database](https://img.shields.io/badge/Database-Cloudflare%20D1%20(SQL)-blue)](https://developers.cloudflare.com/d1/)
[![AI Engine](https://img.shields.io/badge/AI%20Reasoning-Groq%20Llama%203.3-f55036)](https://groq.com/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

An enterprise-grade, free-tier-first specialty coffee roastery e-commerce platform and autonomous AI agent ecosystem built natively on **Cloudflare's Edge Stack** with **Groq** reasoning.

---

## 🌟 Key Architecture & Features

- **Storefront ([`apps/storefront`](apps/storefront)):** Artisanal specialty coffee shop UI with interactive roast meters (Acidity, Body, Sweetness), bag weight/grind selectors, persistent cart drawers, promo coupons, and an interactive **AI Barista** chat assistant.
- **Admin Command Portal ([`apps/admin`](apps/admin)):** Protected by **Cloudflare Zero Trust Access**, offering real-time KPI metrics, immutable inventory movement logs, one-click batch restocks, and multi-state order fulfillment (`ROASTING`, `PACKED`, `SHIPPED`, `REFUNDED`).
- **Edge API Gateway ([`apps/api`](apps/api)):** Cloudflare Worker built with **Hono**, backed by **Cloudflare D1 (SQLite)** transactional data and an immutable inventory ledger to eliminate race-condition oversells.
- **Bot Defense & Security:** **Cloudflare Turnstile** bot protection on checkout, inquiry forms, and AI chat; edge rate limiting; and verified Stripe webhook signatures with idempotency checks.
- **Asynchronous & Scheduled Tasks:** **Cloudflare Queues** for background email dispatching and PDF invoice generation; **Cron Triggers** (`0 4 * * *`) for automated D1 snapshot backups to **Cloudflare R2** and low-stock alarms.
- **AI & RAG Subsystem:**
  - **Groq Llama 3.3 70B:** Ultra-low latency reasoning, tool calling, and morning operations briefing.
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

| Service | Allocation | Role in Daily Grind |
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
MIT © 2026 The Daily Grind Roasting Co.
