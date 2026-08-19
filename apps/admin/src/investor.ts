// The Daily Roast — Investor Readiness & Sales Velocity Portal Interactive Engine

interface Milestone {
  id: string;
  category: 'econ' | 'ops' | 'tech' | 'legal';
  categoryLabel: string;
  title: string;
  summary: string;
  proof: string;
  isVerified: boolean;
  scoreWeight: number;
}

interface MonthlyTraction {
  month: string;
  mrrInr: number;
  volumeKg: number;
  subscribers: number;
}

class InvestorPortal {
  private currency: 'INR' | 'USD' = 'INR';
  private readonly FX_RATE = 83.5; // INR per USD

  // Modeler State
  private modelRaiseInr: number = 5000000; // ₹50 Lakhs ($60k)
  private modelPreMoneyInr: number = 50000000; // ₹5.00 Crores ($600k)
  private modelTargetSubscribers: number = 1200;
  private modelProjectedArrInr: number = 12000000; // ₹1.20 Crores ($144k)

  // 8-Point Seed Round Readiness Milestones
  private milestones: Milestone[] = [
    {
      id: 'm1_unit_econ',
      category: 'econ',
      categoryLabel: 'Unit Economics',
      title: 'Unit Economics & Contribution Margin Proven (>35%)',
      summary: 'Landed green bean cost ₹610/kg ($7.30/kg), roasted COGS ₹209.41/250g bag. 36.5% blended gross margin, 50.6% on direct D2C. ₹164.09 net profit per bag.',
      proof: 'Verified in Roastery ERP & Excel Model (coffee_roasting_unit_economics.xlsx). Breakeven at 828 bags/mo.',
      isVerified: true,
      scoreWeight: 12.5
    },
    {
      id: 'm2_d2c_storefront',
      category: 'ops',
      categoryLabel: 'Direct Channels',
      title: 'Direct-to-Consumer Storefront Live with Zero Marketplace Commission',
      summary: 'High-speed D2C storefront deployed on Cloudflare edge. Multi-currency cart, guest checkout, thermal bag QR code integration saving 25% commissions.',
      proof: 'Live at daily-grind-storefront.pages.dev · 0% commission vs Swiggy/Amazon 25% fee.',
      isVerified: true,
      scoreWeight: 12.5
    },
    {
      id: 'm3_recurring_subs',
      category: 'econ',
      categoryLabel: 'Predictable MRR',
      title: 'Recurring Subscription Engine Active (The Daily Club)',
      summary: 'The Daily Club subscription engine with 250g/500g recurring delivery cadence, custom roast profiles, 91.4% 90-day retention, and 2.8% monthly churn.',
      proof: '345 active subscribers generating ₹1,84,500 MRR with automated Stripe/Razorpay recurring billing.',
      isVerified: true,
      scoreWeight: 12.5
    },
    {
      id: 'm4_estate_sourcing',
      category: 'ops',
      categoryLabel: 'Supply Chain',
      title: 'Direct Indian Estate Sourcing Partnerships Secured',
      summary: 'Long-term direct-trade farmgate agreements with Attikan Estate (Chikmagalur 1,750m), Araku Valley Tribal Honey Co-op (1,200m), and Coorg Shade plantations.',
      proof: '88.4 PTS specialty cupping score standard · ₹610/kg direct landed vs ₹850 open broker pricing.',
      isVerified: true,
      scoreWeight: 12.5
    },
    {
      id: 'm5_roaster_capacity',
      category: 'ops',
      categoryLabel: 'Scalability',
      title: 'Production Roaster Capacity Scalability Roadmapped (3kg–5kg Upgrade)',
      summary: 'Current 1kg sample roaster handling 420kg/month. CapEx plan roadmaps procurement of 5kg commercial drum roaster expanding throughput to 2,500kg/mo.',
      proof: 'Vendor quotes secured for Besca BSC-05 & Giesen W6A · CapEx allocation ₹16L in Seed Round.',
      isVerified: true,
      scoreWeight: 12.5
    },
    {
      id: 'm6_compliance_legal',
      category: 'legal',
      categoryLabel: 'Compliance',
      title: 'Compliance & FSSAI / GST / Karnataka Tax ID Active',
      summary: 'Registered Private Limited entity with Karnataka State clearance, active FSSAI Central Roastery License, GSTIN registration, and HSN 0901 automation.',
      proof: 'GSTIN: 29AABCT0123M1Z5 · HSN 0901 Coffee Tax Invoices generated automatically in Roastery admin.',
      isVerified: true,
      scoreWeight: 12.5
    },
    {
      id: 'm7_edge_cloud',
      category: 'tech',
      categoryLabel: 'Edge Cloud',
      title: 'Edge Cloud Infrastructure ($0/mo Overhead on Cloudflare Free Tier)',
      summary: 'Modern serverless architecture powered by Cloudflare Workers, D1 SQLite database, R2 object storage, KV cache, and Pages with zero fixed monthly server bill.',
      proof: 'Full Cloudflare Workers TypeScript backend deployed with <50ms global latency and 99.99% uptime.',
      isVerified: true,
      scoreWeight: 12.5
    },
    {
      id: 'm8_ai_barista',
      category: 'tech',
      categoryLabel: 'Proprietary IP',
      title: 'AI Barista Proprietary Retention Engine (Llama 3.3 70B on Groq)',
      summary: 'Maya AI coffee flavor sommelier running ultra-fast sub-second edge inference on Groq for personalized grind, water chemistry, and brew recipes.',
      proof: 'Direct Groq LLM API integration with streaming response · Boosts customer repeat conversion by 28%.',
      isVerified: true,
      scoreWeight: 12.5
    }
  ];

  // 6-Month Traction Trajectory Data
  private tractionData: MonthlyTraction[] = [
    { month: 'Mar 26', mrrInr: 75000, volumeKg: 160, subscribers: 88 },
    { month: 'Apr 26', mrrInr: 94000, volumeKg: 210, subscribers: 120 },
    { month: 'May 26', mrrInr: 118000, volumeKg: 265, subscribers: 165 },
    { month: 'Jun 26', mrrInr: 136000, volumeKg: 310, subscribers: 210 },
    { month: 'Jul 26', mrrInr: 158000, volumeKg: 360, subscribers: 270 },
    { month: 'Aug 26', mrrInr: 184500, volumeKg: 420, subscribers: 345 }
  ];

  init() {
    this.setupCurrencySwitcher();
    this.setupNavigation();
    this.renderScorecard('all');
    this.setupScorecardFilter();
    this.setupScenarioModeler();
    this.renderTractionChart();
    this.setupActionButtons();
    this.updateAllCurrencyDisplays();
  }

  private triggerHaptic() {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(10);
      } catch {
        // Fallback for unsupported devices
      }
    }
  }

  private showToast(message: string) {
    let toast = document.getElementById('inv-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'inv-toast';
      toast.className = 'toast-notification';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span>✨</span><span>${message}</span>`;
    toast.classList.add('show');
    setTimeout(() => {
      toast?.classList.remove('show');
    }, 3200);
  }

  // ==========================================
  // CURRENCY SWITCHING & FORMATTING
  // ==========================================
  private setupCurrencySwitcher() {
    const btnInr = document.getElementById('curr-btn-inr');
    const btnUsd = document.getElementById('curr-btn-usd');

    btnInr?.addEventListener('click', () => {
      this.triggerHaptic();
      this.currency = 'INR';
      btnInr.classList.add('active');
      btnUsd?.classList.remove('active');
      this.updateAllCurrencyDisplays();
    });

    btnUsd?.addEventListener('click', () => {
      this.triggerHaptic();
      this.currency = 'USD';
      btnUsd.classList.add('active');
      btnInr?.classList.remove('active');
      this.updateAllCurrencyDisplays();
    });
  }

  private formatMoney(inrValue: number, isCompact: boolean = false): string {
    if (this.currency === 'INR') {
      if (isCompact) {
        if (inrValue >= 10000000) {
          return `₹${(inrValue / 10000000).toFixed(2)} Cr`;
        }
        if (inrValue >= 100000) {
          return `₹${(inrValue / 100000).toFixed(2)}L`;
        }
        return `₹${inrValue.toLocaleString('en-IN')}`;
      }
      return `₹${Math.round(inrValue).toLocaleString('en-IN')}`;
    } else {
      const usdValue = inrValue / this.FX_RATE;
      if (isCompact) {
        if (usdValue >= 1000000) {
          return `$${(usdValue / 1000000).toFixed(2)}M`;
        }
        if (usdValue >= 1000) {
          return `$${(usdValue / 1000).toFixed(1)}k`;
        }
        return `$${usdValue.toFixed(0)}`;
      }
      return `$${Math.round(usdValue).toLocaleString('en-US')}`;
    }
  }

  private updateAllCurrencyDisplays() {
    // Top Hero Key Stats
    const heroArr = document.getElementById('hero-stat-arr');
    const heroMrr = document.getElementById('hero-stat-mrr');
    if (heroArr) heroArr.textContent = this.formatMoney(2214000, true);
    if (heroMrr) heroMrr.textContent = this.formatMoney(184500, true);

    // Section 1 Metric Cards
    const metricArr = document.getElementById('metric-val-arr');
    const metricMrr = document.getElementById('metric-val-mrr');
    const metricAov = document.getElementById('metric-val-aov');
    const metricLtv = document.getElementById('metric-val-ltv');
    const metricProfit = document.getElementById('metric-val-profit');

    if (metricArr) metricArr.textContent = this.formatMoney(2214000, true);
    if (metricMrr) metricMrr.textContent = this.formatMoney(184500, false);
    if (metricAov) metricAov.textContent = this.formatMoney(850, false);
    if (metricLtv) metricLtv.textContent = this.formatMoney(4850, false);
    if (metricProfit) metricProfit.textContent = this.formatMoney(164.09, false);

    // Re-render chart and scenario modeler
    this.renderTractionChart();
    this.recomputeModelerOutputs();
  }

  // ==========================================
  // NAVIGATION & SCROLL
  // ==========================================
  private setupNavigation() {
    const handleNav = (tabId: string | null) => {
      if (!tabId) return;
      this.triggerHaptic();

      document.querySelectorAll('.inv-nav-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
      });
      document.querySelectorAll('.inv-cmd-item').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
      });

      if (tabId === 'overview') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (tabId === 'traction') {
        document.getElementById('sec-traction')?.scrollIntoView({ behavior: 'smooth' });
      } else if (tabId === 'scorecard') {
        document.getElementById('sec-scorecard')?.scrollIntoView({ behavior: 'smooth' });
      } else if (tabId === 'sourcing') {
        document.getElementById('sec-sourcing')?.scrollIntoView({ behavior: 'smooth' });
      } else if (tabId === 'modeler') {
        document.getElementById('sec-modeler')?.scrollIntoView({ behavior: 'smooth' });
      } else if (tabId === 'diligence') {
        document.getElementById('sec-diligence')?.scrollIntoView({ behavior: 'smooth' });
      }
    };

    document.querySelectorAll('.inv-nav-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab');
        handleNav(tab);
      });
    });

    document.querySelectorAll('.inv-cmd-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab');
        handleNav(tab);
      });
    });
  }

  // ==========================================
  // SEED ROUND READINESS SCORECARD
  // ==========================================
  private setupScorecardFilter() {
    document.querySelectorAll('.filter-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.triggerHaptic();
        const target = e.currentTarget as HTMLElement;
        document.querySelectorAll('.filter-tab-btn').forEach((b) => b.classList.remove('active'));
        target.classList.add('active');
        const filter = target.getAttribute('data-filter') || 'all';
        this.renderScorecard(filter);
      });
    });
  }

  private renderScorecard(filter: string) {
    const grid = document.getElementById('milestones-grid-container');
    if (!grid) return;

    const filtered = filter === 'all' 
      ? this.milestones 
      : this.milestones.filter((m) => m.category === filter);

    grid.innerHTML = filtered.map((m) => `
      <div class="milestone-card" id="card-${m.id}">
        <div class="milestone-top">
          <span class="milestone-category cat-${m.category}">${m.categoryLabel}</span>
          <button class="milestone-status ${m.isVerified ? 'status-verified' : 'status-progress'}" data-id="${m.id}" style="border:none; cursor:pointer; font-family:inherit;">
            ${m.isVerified ? '✓ Verified & Proven' : '⏳ In Progress'}
          </button>
        </div>
        <h4 class="milestone-title">${m.title}</h4>
        <p class="milestone-detail">${m.summary}</p>
        <div class="milestone-proof-box">
          <strong>Audit Evidence:</strong> ${m.proof}
        </div>
      </div>
    `).join('');

    // Attach click listener on milestone status to toggle verification state
    grid.querySelectorAll('.milestone-status').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
        const item = this.milestones.find((m) => m.id === id);
        if (item) {
          this.triggerHaptic();
          item.isVerified = !item.isVerified;
          this.updateScorecardGauge();
          this.renderScorecard(filter);
          this.showToast(`Updated milestone: ${item.title.substring(0, 30)}...`);
        }
      });
    });

    this.updateScorecardGauge();
  }

  private updateScorecardGauge() {
    const total = this.milestones.length;
    const verifiedCount = this.milestones.filter((m) => m.isVerified).length;
    const pct = Math.round((verifiedCount / total) * 100);

    const scoreNum = document.getElementById('gauge-score-number');
    const scoreFraction = document.getElementById('readiness-count-label');
    const fillCircle = document.getElementById('gauge-circle-fill');

    if (scoreNum) scoreNum.textContent = `${pct}%`;
    if (scoreFraction) scoreFraction.textContent = `${verifiedCount} of ${total} Milestones Verified (${pct}%)`;

    if (fillCircle) {
      const circumference = 377; // 2 * pi * r (r=60)
      const offset = circumference - (pct / 100) * circumference;
      fillCircle.style.strokeDashoffset = `${offset}`;
    }
  }

  // ==========================================
  // SALES TRACTION SVG CHART
  // ==========================================
  private renderTractionChart() {
    const svg = document.getElementById('traction-svg-chart');
    if (!svg) return;

    const width = 680;
    const height = 190;
    const paddingLeft = 60;
    const paddingBottom = 30;
    const paddingTop = 15;
    const paddingRight = 20;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const maxMrr = 200000;
    const minMrr = 50000;

    const points = this.tractionData.map((d, index) => {
      const x = paddingLeft + (index / (this.tractionData.length - 1)) * chartWidth;
      const y = paddingTop + chartHeight - ((d.mrrInr - minMrr) / (maxMrr - minMrr)) * chartHeight;
      return { x, y, data: d };
    });

    const pathD = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');
    const areaD = `${pathD} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`;

    const gridLines = [50000, 100000, 150000, 200000].map((val) => {
      const y = paddingTop + chartHeight - ((val - minMrr) / (maxMrr - minMrr)) * chartHeight;
      return `
        <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4 4" />
        <text x="${paddingLeft - 10}" y="${y + 4}" fill="#7a6e65" font-size="10" text-anchor="end" font-family="Outfit">${this.formatMoney(val, true)}</text>
      `;
    }).join('');

    const monthLabels = points.map((p) => `
      <text x="${p.x}" y="${height - 8}" fill="#aba097" font-size="11" text-anchor="middle" font-family="Outfit">${p.data.month}</text>
    `).join('');

    const pointCircles = points.map((p) => `
      <circle cx="${p.x}" cy="${p.y}" r="5" fill="#e5b358" stroke="#120e0d" stroke-width="2.5" class="chart-point" style="cursor:pointer;" />
      <text x="${p.x}" y="${p.y - 10}" fill="#fcf9f6" font-size="11" font-weight="700" text-anchor="middle" font-family="Outfit">${this.formatMoney(p.data.mrrInr, true)}</text>
    `).join('');

    svg.innerHTML = `
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e5b358" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#e5b358" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      ${monthLabels}
      <path d="${areaD}" fill="url(#chartGradient)" />
      <path d="${pathD}" fill="none" stroke="#e5b358" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${pointCircles}
    `;
  }

  // ==========================================
  // CAPEX & VALUATION SCENARIO MODELER
  // ==========================================
  private setupScenarioModeler() {
    const sliderRaise = document.getElementById('slider-raise') as HTMLInputElement;
    const sliderPre = document.getElementById('slider-pre') as HTMLInputElement;
    const sliderSubs = document.getElementById('slider-subs') as HTMLInputElement;
    const sliderArr = document.getElementById('slider-arr') as HTMLInputElement;

    const handleInput = () => {
      if (sliderRaise) this.modelRaiseInr = parseInt(sliderRaise.value, 10);
      if (sliderPre) this.modelPreMoneyInr = parseInt(sliderPre.value, 10);
      if (sliderSubs) this.modelTargetSubscribers = parseInt(sliderSubs.value, 10);
      if (sliderArr) this.modelProjectedArrInr = parseInt(sliderArr.value, 10);

      this.recomputeModelerOutputs();
    };

    sliderRaise?.addEventListener('input', handleInput);
    sliderPre?.addEventListener('input', handleInput);
    sliderSubs?.addEventListener('input', handleInput);
    sliderArr?.addEventListener('input', handleInput);

    // Preset Scenario Buttons
    const btnPresetConservative = document.getElementById('preset-conservative');
    const btnPresetGrowth = document.getElementById('preset-growth');
    const btnPresetHyper = document.getElementById('preset-hyper');

    btnPresetConservative?.addEventListener('click', () => {
      this.triggerHaptic();
      this.setActivePreset(btnPresetConservative);
      this.modelRaiseInr = 3500000;
      this.modelPreMoneyInr = 35000000;
      this.modelTargetSubscribers = 800;
      this.modelProjectedArrInr = 8000000;
      this.syncSliders();
      this.recomputeModelerOutputs();
      this.showToast('Applied Conservative Seed Scenario (₹35L @ ₹3.5Cr Pre)');
    });

    btnPresetGrowth?.addEventListener('click', () => {
      this.triggerHaptic();
      this.setActivePreset(btnPresetGrowth);
      this.modelRaiseInr = 6000000;
      this.modelPreMoneyInr = 55000000;
      this.modelTargetSubscribers = 1500;
      this.modelProjectedArrInr = 15000000;
      this.syncSliders();
      this.recomputeModelerOutputs();
      this.showToast('Applied Growth Acceleration Scenario (₹60L @ ₹5.5Cr Pre)');
    });

    btnPresetHyper?.addEventListener('click', () => {
      this.triggerHaptic();
      this.setActivePreset(btnPresetHyper);
      this.modelRaiseInr = 12500000;
      this.modelPreMoneyInr = 100000000;
      this.modelTargetSubscribers = 3500;
      this.modelProjectedArrInr = 35000000;
      this.syncSliders();
      this.recomputeModelerOutputs();
      this.showToast('Applied Hyper-Scale Roastery Scenario (₹1.25Cr @ ₹10Cr Pre)');
    });
  }

  private setActivePreset(activeBtn: HTMLElement) {
    document.querySelectorAll('.preset-chip').forEach((b) => b.classList.remove('active'));
    activeBtn.classList.add('active');
  }

  private syncSliders() {
    const sliderRaise = document.getElementById('slider-raise') as HTMLInputElement;
    const sliderPre = document.getElementById('slider-pre') as HTMLInputElement;
    const sliderSubs = document.getElementById('slider-subs') as HTMLInputElement;
    const sliderArr = document.getElementById('slider-arr') as HTMLInputElement;

    if (sliderRaise) sliderRaise.value = this.modelRaiseInr.toString();
    if (sliderPre) sliderPre.value = this.modelPreMoneyInr.toString();
    if (sliderSubs) sliderSubs.value = this.modelTargetSubscribers.toString();
    if (sliderArr) sliderArr.value = this.modelProjectedArrInr.toString();
  }

  private recomputeModelerOutputs() {
    // Update Slider Pills
    const pillRaise = document.getElementById('pill-val-raise');
    const pillPre = document.getElementById('pill-val-pre');
    const pillSubs = document.getElementById('pill-val-subs');
    const pillArr = document.getElementById('pill-val-arr');

    if (pillRaise) pillRaise.textContent = this.formatMoney(this.modelRaiseInr, true);
    if (pillPre) pillPre.textContent = this.formatMoney(this.modelPreMoneyInr, true);
    if (pillSubs) pillSubs.textContent = `${this.modelTargetSubscribers.toLocaleString()} Subs`;
    if (pillArr) pillArr.textContent = this.formatMoney(this.modelProjectedArrInr, true);

    // Compute Calculations
    const postMoneyInr = this.modelPreMoneyInr + this.modelRaiseInr;
    const investorEquityPct = (this.modelRaiseInr / postMoneyInr) * 100;
    const capexAllocationInr = this.modelRaiseInr * 0.32; // 32% for roaster & packaging equipment
    const monthlyNetBurnInr = 225000; // Expected net burn during expansion
    const runwayMonths = Math.round(this.modelRaiseInr / monthlyNetBurnInr);

    // Projected IRR at 36-month exit (assumed 3.5x - 5x revenue multiple at scale)
    const projectedExitValuationInr = this.modelProjectedArrInr * 4.2;
    const investorExitValueInr = (investorEquityPct / 100) * projectedExitValuationInr;
    const moic = investorExitValueInr / this.modelRaiseInr;
    const annualizedIRR = Math.max(15, Math.min(85, Math.round((Math.pow(moic, 1 / 3) - 1) * 100)));

    // Monthly beans required
    const monthlyBeansKg = Math.round(this.modelTargetSubscribers * 0.85);

    // Update Output DOM elements
    const outEquity = document.getElementById('calc-equity-pct');
    const outPost = document.getElementById('calc-post-money');
    const outCapex = document.getElementById('calc-capex-val');
    const outRunway = document.getElementById('calc-runway-months');
    const outIrr = document.getElementById('calc-projected-irr');
    const outBeans = document.getElementById('calc-beans-volume');

    if (outEquity) outEquity.textContent = `${investorEquityPct.toFixed(2)}%`;
    if (outPost) outPost.textContent = this.formatMoney(postMoneyInr, true);
    if (outCapex) outCapex.textContent = this.formatMoney(capexAllocationInr, true);
    if (outRunway) outRunway.textContent = `${runwayMonths} Months`;
    if (outIrr) outIrr.textContent = `${annualizedIRR}% (${moic.toFixed(1)}x MOIC)`;
    if (outBeans) outBeans.textContent = `${monthlyBeansKg.toLocaleString()} kg/mo`;
  }

  // ==========================================
  // ACTION BUTTONS (PRINT, COPY, EXPORT)
  // ==========================================
  private setupActionButtons() {
    // Print 1-Pager
    const btnPrint = document.getElementById('btn-print-onepager');
    btnPrint?.addEventListener('click', () => {
      this.triggerHaptic();
      window.print();
    });

    // Copy Pitch Memo to Clipboard
    const btnCopyMemo = document.getElementById('btn-copy-pitch');
    btnCopyMemo?.addEventListener('click', () => {
      this.triggerHaptic();
      this.copyPitchMemoToClipboard();
    });

    // Export Data JSON
    const btnExportData = document.getElementById('btn-export-json');
    btnExportData?.addEventListener('click', () => {
      this.triggerHaptic();
      this.exportInvestorJSON();
    });
  }

  private copyPitchMemoToClipboard() {
    const memo = `
☕ THE DAILY ROAST — SEED STAGE INVESTOR EXECUTIVE SUMMARY
========================================================================
HQ: Indiranagar, Bangalore · Specialty Coffee Sourcing & Roasting Hub
Target Raise: ${this.formatMoney(this.modelRaiseInr, true)} at ${this.formatMoney(this.modelPreMoneyInr, true)} Pre-Money Valuation
Live Storefront: https://daily-grind-storefront.pages.dev

1. TRACTION & REVENUE RUN-RATE:
- Current ARR: ${this.formatMoney(2214000, true)} (₹1.84L / $2.2k MRR) with +22.4% MoM Velocity
- Active Subscribers: 345 recurring members (The Daily Club)
- Gross Margin: 36.5% blended (up to 50.6% on direct D2C storefront)
- Average Order Value (AOV): ${this.formatMoney(850, false)} | LTV:CAC Ratio: 5.27x (LTV ${this.formatMoney(4850, false)})
- 90-Day Retention: 91.4% (low 2.8% monthly churn)

2. CORE COMPETITIVE ADVANTAGES:
- Direct Sourcing: Direct-trade partnerships with Attikan Estate (Chikmagalur 1,750m) & Araku Valley (1,200m) at ₹610/kg vs ₹850 broker spot.
- Edge Architecture: $0/mo serverless overhead on Cloudflare Workers, D1, R2, and Pages.
- Maya AI Sommelier: Proprietary retention engine running sub-second Llama 3.3 70B on Groq.
- Zero-Commission Channel: Proprietary D2C eliminates 25% marketplace commissions, saving ₹67.50/bag.

3. USE OF FUNDS (${this.formatMoney(this.modelRaiseInr, true)}):
- 32% CapEx: Commercial 5kg drum roaster + nitrogen flush pouch sealer line (expands capacity to 2,500kg/mo).
- 28% Green Bean Silos & Direct Estate Forward Contracts.
- 25% Growth Marketing & D2C Customer Acquisition.
- 15% Edge Tech, Packaging Automation & Working Capital Runway (${Math.round(this.modelRaiseInr / 225000)} Months).

4. SYNDICATE CONTACT:
Founders: roasters@dailyroast.in · Bangalore Hub
Legal: FSSAI Central License Active · GSTIN: 29AABCT0123M1Z5
========================================================================
    `.trim();

    if (navigator.clipboard) {
      navigator.clipboard.writeText(memo).then(() => {
        this.showToast('Copied Investor Pitch Memo to clipboard!');
      }).catch(() => {
        this.fallbackCopyText(memo);
      });
    } else {
      this.fallbackCopyText(memo);
    }
  }

  private fallbackCopyText(text: string) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      this.showToast('Copied Investor Pitch Memo to clipboard!');
    } catch {
      alert('Could not auto-copy. Please copy from screen.');
    }
    document.body.removeChild(textArea);
  }

  private exportInvestorJSON() {
    const payload = {
      company: 'The Daily Roast Coffee Roasters Private Limited',
      hub: 'Bangalore, India',
      currency: this.currency,
      generated_at: new Date().toISOString(),
      current_metrics: {
        arr_inr: 2214000,
        mrr_inr: 184500,
        blended_gross_margin_pct: 36.5,
        direct_storefront_margin_pct: 50.6,
        aov_inr: 850,
        ltv_inr: 4850,
        cac_inr: 920,
        ltv_to_cac_ratio: 5.27,
        retention_90_day_pct: 91.4,
        monthly_churn_pct: 2.8,
        active_subscribers: 345
      },
      milestone_readiness: {
        score_pct: 87.5,
        milestones: this.milestones
      },
      scenario_modeler: {
        target_raise_inr: this.modelRaiseInr,
        pre_money_valuation_inr: this.modelPreMoneyInr,
        post_money_valuation_inr: this.modelPreMoneyInr + this.modelRaiseInr,
        investor_equity_pct: ((this.modelRaiseInr / (this.modelPreMoneyInr + this.modelRaiseInr)) * 100).toFixed(2),
        target_subscribers: this.modelTargetSubscribers,
        projected_18m_arr_inr: this.modelProjectedArrInr
      }
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute('href', dataStr);
    dlAnchorElem.setAttribute('download', `the_daily_roast_investor_readiness_${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchorElem.click();
    this.showToast('Downloaded Investor Data JSON Package');
  }
}

// Auto-boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const portal = new InvestorPortal();
  portal.init();
});
