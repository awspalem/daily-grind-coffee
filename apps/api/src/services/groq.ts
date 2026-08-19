export interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface GroqToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class GroqService {
  private apiKey?: string;
  private model: string;
  private fallbackModel: string;

  constructor(
    apiKey?: string,
    model: string = 'llama-3.3-70b-versatile',
    fallbackModel: string = 'llama-3.1-8b-instant'
  ) {
    this.apiKey = apiKey;
    // Ensure we don't use old decommissioned or invalid models
    if (!model || model.includes('gpt-oss') || model.includes('llama3-70b-8192')) {
      this.model = 'llama-3.3-70b-versatile';
    } else {
      this.model = model;
    }
    this.fallbackModel = fallbackModel;
  }

  async chatCompletion(
    messages: GroqChatMessage[],
    tools?: GroqToolDefinition[],
    temperature: number = 0.5
  ): Promise<GroqChatMessage> {
    if (!this.apiKey || this.apiKey === 'placeholder' || this.apiKey.trim() === '') {
      return this.generateFallbackResponse(messages);
    }

    // Format messages cleanly for Groq API
    const formattedMessages = messages.map((m) => {
      const msg: Record<string, any> = {
        role: m.role,
        content: m.content ?? '',
      };
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls;
      }
      if (m.tool_call_id) {
        msg.tool_call_id = m.tool_call_id;
      }
      if (m.name) {
        msg.name = m.name;
      }
      return msg;
    });

    const payload: Record<string, unknown> = {
      model: this.model,
      messages: formattedMessages,
      temperature,
      max_tokens: 1024,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        if (data.choices && data.choices[0]?.message) {
          return data.choices[0].message;
        }
      }

      // Log first attempt error
      const errText = await res.text();
      console.warn(`Groq API primary model (${this.model}) returned status ${res.status}: ${errText}. Attempting fallback to ${this.fallbackModel}...`);

      // Attempt fallback model if primary model differed from fallback
      if (this.model !== this.fallbackModel) {
        const fallbackPayload = {
          ...payload,
          model: this.fallbackModel,
        };

        const fallbackRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fallbackPayload),
        });

        if (fallbackRes.ok) {
          const fallbackData = (await fallbackRes.json()) as any;
          if (fallbackData.choices && fallbackData.choices[0]?.message) {
            return fallbackData.choices[0].message;
          }
        } else {
          const fallbackErr = await fallbackRes.text();
          console.error(`Groq API fallback model (${this.fallbackModel}) also failed (${fallbackRes.status}): ${fallbackErr}`);
        }
      }
    } catch (networkErr) {
      console.error('Groq network/fetch error:', networkErr);
    }

    // Return sommelier fallback if both API calls failed or offline
    return this.generateFallbackResponse(messages);
  }

  private generateFallbackResponse(messages: GroqChatMessage[]): GroqChatMessage {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content.toLowerCase() || '';

    // South Indian Filter Kaapi & Traditional Brewing
    if (
      lastUserMsg.includes('filter') ||
      lastUserMsg.includes('kaapi') ||
      lastUserMsg.includes('decoction') ||
      lastUserMsg.includes('south indian') ||
      lastUserMsg.includes('davarah') ||
      lastUserMsg.includes('dabarah')
    ) {
      return {
        role: 'assistant',
        content: `### ☕ Traditional South Indian Filter Kaapi Guide

Namaskara! Here is our authentic Bangalore roastery recipe for rich, velvety **Filter Kaapi**:

| Parameter | Specification |
| :--- | :--- |
| **Coffee Recommended** | **Chikmagalur Attikan Estate Honey** (or Dawn Patrol) |
| **Grind Size** | Medium-Fine (slightly coarser than espresso, finer than V60) |
| **Decoction Ratio** | **1:5** (20g coffee to 100g water) |
| **Water Temp** | 98°C (Freshly boiled off the stove) |
| **Extraction Time** | 15–20 minutes slow gravity drip |

#### 🌿 Step-by-Step Brewing:
1. Place 20g ground coffee into the top compartment of your brass/stainless steel filter.
2. Lightly tamp using the umbrella disc (do not press too hard).
3. Pour 100g hot water (98°C) over the disc, place the lid on, and allow the thick first-press decoction to collect (15 mins).
4. **The Pour:** Mix **1 part decoction** with **2.5 parts hot, frothy boiled milk** and unrefined jaggery or country sugar.
5. Froth between the dabarah and tumbler from height to create a thick golden crema head!

Would you like me to prepare a **250g bag of Chikmagalur Attikan Honey** ground specifically for South Indian Filter?`,
      };
    }

    // Araku Valley Red Honey
    if (
      lastUserMsg.includes('araku') ||
      lastUserMsg.includes('jackfruit') ||
      lastUserMsg.includes('andhra') ||
      lastUserMsg.includes('red honey')
    ) {
      return {
        role: 'assistant',
        content: `### 🌺 Araku Valley Red Honey Micro-Lot

Grown by indigenous tribal smallholders in the high-elevation mist-covered Eastern Ghats of Araku Valley (1,400m):

- **Process:** Extended Red Honey Mucilage Drying
- **Roast Level:** Medium-Light Roast
- **Sensory Wheel Notes:** Ripe Sweet Jackfruit, Wild Forest Blossom Honey, Candied Orange Peel & Floral Jasmine
- **Mouthfeel:** Buttery, syrupy and extraordinarily fragrant

It is exceptional as a morning pour-over or AeroPress. Shall I add a **250g pouch (₹490 / $19.50)** to your cart?`,
      };
    }

    // Chikmagalur Attikan Honey / Indian Estates
    if (
      lastUserMsg.includes('attikan') ||
      lastUserMsg.includes('chikmagalur') ||
      lastUserMsg.includes('karnataka') ||
      lastUserMsg.includes('baba budan') ||
      lastUserMsg.includes('jaggery') ||
      (lastUserMsg.includes('honey') && !lastUserMsg.includes('araku'))
    ) {
      return {
        role: 'assistant',
        content: `### 🌿 Chikmagalur Attikan Estate Honey Micro-Lot

Our crown jewel from the sacred **Baba Budan Giri** range in Chikmagalur, Karnataka (grown under silver oak shade at 1,750m elevation):

- **Process:** Sun-dried Honey Process (pulp retained during drying)
- **Roast Profile:** Medium-Light Convection Roast
- **Sensory Wheel Notes:** Sweet Sugarcane Jaggery, Red Apple Brightness, Roasted Hazelnut & Silky Caramel
- **Best Brew Methods:** South Indian Filter Kaapi (1:5), Hario V60 (1:16, 93°C), AeroPress

This coffee has an incredible natural sweetness with balanced malic acidity. Would you like me to add a **250g pouch (₹450 / $18.50)** to your cart?`,
      };
    }

    // Ethiopia Yirgacheffe / Light / Floral
    if (
      lastUserMsg.includes('ethiopia') ||
      lastUserMsg.includes('yirgacheffe') ||
      lastUserMsg.includes('light') ||
      lastUserMsg.includes('floral') ||
      lastUserMsg.includes('jasmine') ||
      lastUserMsg.includes('peach')
    ) {
      return {
        role: 'assistant',
        content: `### 🌸 Ethiopia Yirgacheffe Gedeb (Natural Process)

An ethereal, ultra-clean light roast harvested at 2,150m in the Gedeb micro-region of Yirgacheffe:

- **Process:** 21-Day Raised Bed Natural
- **Roast Level:** Nordic-style Light Roast
- **Sensory Notes:** Fragrant Jasmine Florals, Bergamot Earl Grey Tea, Ripe White Peach & Honeycomb
- **Acidity / Sweetness:** Vibrant, sparkling citrus acidity with crystalline sweetness

**Recommended Recipe (Hario V60):**
- 15g coffee (Medium-Fine) to 240g water (1:16 ratio) at 94°C
- 45s bloom with 45g water, total brew time 3:00 min

Would you like me to add a **250g bag (₹490 / $19.50)** to your order?`,
      };
    }

    // Colombia Pink Bourbon
    if (
      lastUserMsg.includes('colombia') ||
      lastUserMsg.includes('pink bourbon') ||
      lastUserMsg.includes('guava') ||
      lastUserMsg.includes('papaya')
    ) {
      return {
        role: 'assistant',
        content: `### 🥭 Colombia Huila Pink Bourbon

Sourced from Finca El Paraiso in San Agustin, Huila (1,900m altitude volcanic soil):

- **Varietal:** Rare Pink Bourbon mutation
- **Roast Level:** Medium-Light
- **Sensory Notes:** Pink Guava, Papaya, Crystalline Cane Sugar & Crisp Lemon Verbena
- **Cup Characteristics:** Extraordinary clarity, tropical fruit aromatics, and lingering juicy sweetness.

Pairs magnificently with V60, Kalita Wave, and Chemex pour-over drippers!`,
      };
    }

    // Espresso / Dark Roast / Midnight Runner
    if (
      lastUserMsg.includes('espresso') ||
      lastUserMsg.includes('dark') ||
      lastUserMsg.includes('crema') ||
      lastUserMsg.includes('midnight') ||
      lastUserMsg.includes('latte') ||
      lastUserMsg.includes('cappuccino')
    ) {
      return {
        role: 'assistant',
        content: `### 🍫 Midnight Runner Dark Roast Espresso

Engineered for rich, thick golden crema and bold chocolate depth with zero carbon bitterness:

- **Composition:** High-grown Brazil Cerrado, Guatemala Antigua & Monsooned Malabar Robusta AA
- **Roast Profile:** Dark Roast (stopped right at second crack)
- **Flavor Profile:** Intense Dark Cocoa Nibs, Molasses, Toasted Almonds & Smoky Vanilla
- **Dialing-in Specs (9-Bar Commercial / Home Machine):**
  - **Dose:** 18g finely ground coffee
  - **Yield:** 36g liquid espresso (1:2 ratio)
  - **Extraction Time:** 27–30 seconds at 93°C

Would you like me to add a **250g or 500g pouch** to your cart?`,
      };
    }

    // V60 Pour Over & Brew Guides
    if (
      lastUserMsg.includes('v60') ||
      lastUserMsg.includes('pour over') ||
      lastUserMsg.includes('ratio') ||
      lastUserMsg.includes('brew') ||
      lastUserMsg.includes('grind') ||
      lastUserMsg.includes('timer')
    ) {
      return {
        role: 'assistant',
        content: `### ⏱️ Barista Dial-In: Hario V60 Pour Over

Here is the exact dialing-in recipe we use every morning at our Indiranagar roastery:

| Step | Water Target | Time Window | Action |
| :--- | :--- | :--- | :--- |
| **0. Prep** | — | 0:00 | Rinse paper filter with hot water; discard rinse water. Add 15g coffee. |
| **1. Bloom** | 45g | 0:00 – 0:45 | Pour 45g water at 93°C in spirals. Excavate dry grounds. |
| **2. Main Pour** | 150g | 0:45 – 1:30 | Pour steadily in concentric circles from center outwards. |
| **3. Final Pour** | 240g | 1:30 – 2:15 | Gentle center pour up to 240g. Give 1 gentle swirl. |
| **4. Drawdown** | Total 240g | 2:45 – 3:15 | Bed drains flat and even. Decant and enjoy! |

- **Brew Ratio:** 1:16 (15g coffee to 240g water)
- **Water Temp:** 93°C (200°F)
- **Recommended Beans:** Chikmagalur Attikan Honey or Ethiopia Yirgacheffe

Would you like to launch the interactive live brew timer?`,
      };
    }

    // Taster Flight
    if (
      lastUserMsg.includes('flight') ||
      lastUserMsg.includes('sampler') ||
      lastUserMsg.includes('taster') ||
      lastUserMsg.includes('trio') ||
      lastUserMsg.includes('sample')
    ) {
      return {
        role: 'assistant',
        content: `### 🎁 Curated 3x 100g Roastery Taster Flight

Explore three rare micro-lot profiles in custom nitrogen-flushed 100g sample pouches (₹590 / $24.00 total):

1. **Chikmagalur Attikan Estate Honey** (Jaggery, Red Apple & Hazelnut)
2. **Araku Valley Red Honey** (Ripe Jackfruit, Wild Blossom Honey)
3. **Ethiopia Yirgacheffe Gedeb** (Jasmine, Bergamot & White Peach)

Each pouch is freshly roasted on our convection hot-air roaster and sealed within 1 hour of roasting. Shall I add a Taster Flight to your cart?`,
      };
    }

    // Default welcome & assistance
    return {
      role: 'assistant',
      content: `Namaskara! Welcome to **The Daily Roast** roastery in Indiranagar, Bengaluru.

I am **Maya**, your Master Barista & Roastery Sommelier. I can assist you with:
- 🌿 **Indian Micro-Lots:** Chikmagalur Attikan Honey & Araku Valley Red Honey
- 🌸 **Global Single Origins:** Ethiopia Yirgacheffe Gedeb & Colombia Pink Bourbon
- ☕ **Brewing Science:** Exact ratios for South Indian Filter Kaapi (1:5), V60 (1:16, 93°C), AeroPress, and 9-bar Espresso
- 📦 **Order Tracking & Cart Building:** Add coffees directly to your cart or track your roasting batch

What flavors or brewing techniques would you like to explore today?`,
    };
  }
}
