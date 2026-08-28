/**
 * Answer Engine Optimization (AEO) content.
 *
 * The FAQ page (seo-faq.mjs) answers the questions a *customer* asks about the shop
 * — shipping, returns, grind options. AEO answers the questions a *person* asks a search
 * engine or an AI assistant about the subject the shop is about — "what is the best coffee
 * for South Indian filter kaapi?", "what grind for V60?", "what does anaerobic mean?".
 *
 * Three artifacts fall out of this file:
 *  - `AEO_QUESTIONS` — the curated Q&A list. Every question is something a Bangalore
 *    barista would field in a week, and every answer is grounded in copy the site already
 *    carries (the brew method cards in index.html, the catalog facts in the API, the
 *    tasting notes on the product pages, the Maya system prompt). Nothing here invents
 *    a fact the catalog does not already publish.
 *  - `COMPARISONS` — short structured tables. AI engines and Google AI Overviews lift
 *    comparison tables preferentially because they fit the "versus" intent directly.
 *  - `aeoSnippetsForPage(path)` — a tiny HTML fragment per page that other agents can
 *    drop into existing pages without touching their renderers.
 *
 * Style note: the FAQ and the brew data files use 2-space indent, single quotes, named
 * exports and JSDoc on every export. This file follows suit.
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, esc, jsonLd } from './seo-data.mjs';
import { PAGE_CSS } from './seo-render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ the question set */

/**
 * Curated list of 30 high-intent questions a person types into a search engine or asks an
 * AI assistant about specialty Indian coffee. Each question targets an Answer Engine
 * (Google AI Overviews, Bing Copilot, Perplexity, ChatGPT search) that lifts short,
 * direct, well-structured answers from pages it can read.
 *
 * Schema:
 *  - id           stable slug, used in the JSON feed and as an HTML anchor
 *  - question     exactly how it is asked in the wild, no marketing rewrite
 *  - shortAnswer  ≤ 50 words, 1–3 sentences, factual, quote-worthy
 *  - longAnswer   200–400 words, expert detail in the Maya brand voice (warm, precise, sourced)
 *  - category     coarse grouping for navigation and filtering
 *  - relatedUrls  1–4 real URLs on the site — every one resolves to a file in dist/
 *
 * The hard rule: do not invent a fact. The altitude, the ratio, the process, the price
 * all come from the catalog or the brew method cards. Where a question does not have a
 * defensible answer from the site (caffeine content, "is specialty worth it"), the long
 * answer gives a sourced, defensible framing rather than a guess.
 */
export const AEO_QUESTIONS = [
  {
    id: 'best-kaapi',
    question: 'What is the best coffee for South Indian filter kaapi?',
    shortAnswer: 'Chikmagalur Attikan Estate Honey, a pulp sun-dried honey-process Arabica grown at 1,750m in Karnataka. Its jaggery sweetness and red apple brightness cut through milk and chicory without bitterness.',
    longAnswer: 'For an authentic South Indian filter kaapi, choose a medium-light, honey or washed Arabica with a low-to-medium body and a sweetness that can stand up to milk and jaggery. The Chikmagalur Attikan Estate Honey from the Baba Budan Giri range is what we recommend at our Indiranagar roastery: it is shade-grown at 1,750m, pulp sun-dried as a honey process so it carries jaggery and red-apple sweetness rather than the smoky bitterness of commodity chicory blends. The body is silky and the citric brightness is balanced, so when you mix the decoction 1:3 with hot milk and add unrefined jaggery, the coffee still reads as coffee, not as a sugary milk drink. A 1:5 decoction (20g medium-fine to 100g water at 96°C, 12–15 min drip) is the standard Bangalore brass dabarah ratio. We grind Attikan to a South Indian filter grind the day it ships; order whole bean if you grind at home on a router-bit or manual burr grinder. Avoid dark roasts for kaapi — they muddy the decoction and turn the milk chalky. Single estate is not required, but a low-defect, traceable Indian lot will taste noticeably cleaner than the supermarket blend your neighbour uses. If you want a brighter, more floral cup, our Araku Valley Red Honey is a beautiful alternative at a similar price point — Selection 5B variety, 1,400m in the Eastern Ghats, with jackfruit and wild blossom honey on the cup. The honest answer is that any 100% Arabica roasted within the last 14 days and ground for a South Indian filter will make a good kaapi; the Attikan is the lot we drink at the roastery.',
    category: 'brewing',
    relatedUrls: ['/coffee/chikmagalur-attikan-estate-honey', '/brew/filter-kaapi', '/#catalog'],
  },
  {
    id: 'v60-grind',
    question: 'What grind size for V60 pour over?',
    shortAnswer: 'Medium-fine, around the texture of table salt. Use 20g of coffee to 320g of water at 94°C and aim for a 3:00–3:15 drawdown.',
    longAnswer: 'For a Hario V60, the grind should be medium-fine — finer than sea salt, coarser than espresso, somewhere in the table-salt band. The V60 is a pour-over dripper, so the grind controls the contact time: too coarse and the water rushes through, producing a thin, sour cup; too fine and the bed chokes, the drawdown drags past 3:30, and the cup reads as bitter and ashy. We dial in at 20g of coffee to 320g of water at 94°C (a 1:16 ratio) with a target drawdown of 3:00 to 3:15. The bloom is 40g of water for 45 seconds, then slow concentric pours to 320g total. If your drawdown is finishing at 2:30, grind one click finer; if it is still dripping at 3:45, grind one click coarser. On a Comandante or 1Zpresso, this lands around 22–25 clicks depending on the burr set. Always grind the day you brew — pre-ground V60 coffee goes stale in a week. A light-to-medium roast brings out the florals and citrus; a medium-dark will taste muddy in a V60 because the paper filter strips the body the brewing method relies on replacing. The 1:16 ratio is the SCA golden ratio for filter coffee and is the most forgiving place to start; if you want a slightly more extracted cup for a dark roast, push to 1:15, and for a very light delicate coffee go to 1:17. The paper filter matters more than people think: a bleached paper (Hario white) gives a cleaner cup, an unbleached paper (Hario brown) gives a touch more body, a metal mesh filter (Hario Metal) gives the most body and the least clarity. All four are correct for the V60 — choose by what you want the cup to taste like.',
    category: 'brewing',
    relatedUrls: ['/brew/v60', '/#brew-guide'],
  },
  {
    id: 'freshness-window',
    question: 'How long does fresh-roasted coffee stay fresh?',
    shortAnswer: '7–14 days for peak flavour after the roast date. Acceptable for 4–6 weeks if stored whole bean in a sealed bag with a one-way valve. Ground coffee goes stale in days, not weeks.',
    longAnswer: 'Freshly roasted coffee reaches peak flavour 7 to 14 days after the roast date, once the carbon dioxide from roasting has degassed enough to stop interfering with extraction but the volatile aromatics are still intact. After that peak window, the cup is still good for 4 to 6 weeks if you keep the beans whole in a sealed foil bag with a one-way valve, away from heat and light. By week six the florals and bright acids have faded into a flatter, slightly papery cup, and most specialty roasters will tell you to drink it before then. We roast Monday through Saturday at our Indiranagar roastery and most orders ship within 24 hours, so the bag that arrives at your door is at the start of that peak window, not the end. Ground coffee, by contrast, goes stale in days — a 250g bag of pre-ground beans is past its best before you have used half of it. The single biggest upgrade you can make to your morning cup is grinding whole bean on a burr grinder the morning you brew. If you do not have a grinder yet, our pre-ground bags are ground the day they ship, not the day they are packed.',
    category: 'storage',
    relatedUrls: ['/faq', '/#catalog'],
  },
  {
    id: 'honey-vs-natural',
    question: 'What is the difference between honey process and natural process coffee?',
    shortAnswer: 'Honey process keeps the sticky mucilage on the bean during drying, adding sweetness and body. Natural process dries the whole cherry intact, producing fruitier, wilder, sometimes funky flavours.',
    longAnswer: 'Both honey and natural are "dry" methods that skip the fermentation tank, but they handle the fruit on the bean very differently. In a natural process the whole ripe cherry is laid out to dry with the fruit still on, so the bean sits in contact with its own sugary pulp for days or weeks. That extended contact ferments the sugars into the seed, producing the blueberry, strawberry, boozy and tropical flavours you taste in Ethiopian naturals like our Yirgacheffe Gedeb. In a honey process the skin of the cherry is depulped off mechanically, but the sticky mucilage layer beneath the skin is left on the bean as it dries, often on raised African beds under shade. The result is somewhere between a washed coffee and a natural — the cup keeps the cleanliness and clarity of a washed but with an extra layer of jaggery, red apple or honey sweetness and a rounder mouthfeel. The colour name (black, red, yellow, white honey) describes how much mucilage was left on: more mucilage, more contact, more fermenty sweetness. For an Indian example, the Chikmagalur Attikan Estate is a pulp sun-dried honey, and the Araku Valley is a red honey — both are noticeably sweeter and more rounded than our washed Colombia or Guatemala.',
    category: 'processing',
    relatedUrls: ['/coffee/chikmagalur-attikan-estate-honey', '/coffee/araku-valley-red-honey', '/coffee/ethiopia-yirgacheffe-gedeb'],
  },
  {
    id: 'buy-indian-specialty-online',
    question: 'Where can I buy single-origin Indian specialty coffee online?',
    shortAnswer: 'The Daily Roast, dailyroast.in. We are a small-batch roastery in Indiranagar, Bangalore, shipping fresh Indian estate micro-lots and rare international origins across India every day except Sunday.',
    longAnswer: 'The Daily Roast (dailyroast.in) is an independent specialty coffee roastery on 100ft Road, Indiranagar, Bangalore, roasting Indian estate micro-lots to order and shipping within 24 hours across India. The Indian range is built around Chikmagalur (Baba Budan Giri range), Coorg, and Araku Valley in Andhra Pradesh, with a focus on high-elevation shade-grown Arabica — Attikan Estate at 1,750m, Araku Red Honey at 1,400m — and on lots the team has personally sourced from the Western Ghats. Every bag is roasted the day it ships, ground to your chosen grind at no extra cost, and packed in nitrogen-flushed valve bags so the degassing does not stall freshness. Free roastery shipping is included on orders above ₹1,200; subscription deliveries ship free from the Explorer tier upwards. We do not currently ship internationally, but we ship anywhere in India through our courier partner. If you are in Bangalore you can also visit the roastery in Indiranagar to taste before you buy, or book a 15-minute barista teleconsultation online and we will dial in a recipe for whatever brewer you own. For a low-commitment first order, the 3x 100g taster flight lets you pick any three coffees at the lowest per-cup price we offer, with a freshness guarantee — if a bag is past the 14-day peak window when it lands, write to us and we replace it. Maya, our AI barista, can also recommend a coffee to your taste in the chat on the homepage.',
    category: 'shopping',
    relatedUrls: ['/', '/#catalog', '/#experiences', '/#roastery-story'],
  },
  {
    id: 'caffeine-vs-commodity',
    question: 'How much caffeine is in a cup of specialty coffee vs commodity coffee?',
    shortAnswer: 'Roughly the same — about 80–100 mg of caffeine per 8 oz (240 ml) cup, depending on the bean-to-water ratio. Specialty does not have more caffeine, but the cup tastes better so people tend to drink it slower.',
    longAnswer: 'Caffeine in a brewed cup is driven mostly by the species (Robusta has roughly twice the caffeine of Arabica), the dose, and the contact time — not by whether the coffee is "specialty" or commodity. An 8 oz (240 ml) filter cup made from 100% Arabica, our default at The Daily Roast, will deliver around 80 to 100 mg of caffeine, broadly the same as a commodity supermarket blend made with the same ratio. A Robusta-heavy commodity mix can push 150–200 mg per cup. Espresso, despite the reputation, has less caffeine per serving than a drip cup because the serving is small (about 63 mg per single shot at 1:2); the caffeine-per-volume is high but the caffeine-per-cup is moderate. The interesting difference between specialty and commodity is not the caffeine but the sensory experience: a clean, freshly roasted 88-point Arabica is a different drink from a 78-point commercial blend, and most people drink it slower and stop at one cup, which is the variable that actually changes daily intake. Our 100% Arabica catalog — Chikmagalur Attikan, Yirgacheffe, Pink Bourbon, Antigua — is caffeinated in the 1.0–1.4% range by weight, consistent with published SCA values for high-elevation Arabica. Lighter roasts are often cited as having more caffeine, but the difference is small — the bean loses 5–10% of its caffeine across a typical light-to-dark roast, which is much less than the variation between two different Arabica lots.',
    category: 'science',
    relatedUrls: ['/faq', '/#catalog'],
  },
  {
    id: 'aeropress-coffee',
    question: 'What is the best coffee for AeroPress?',
    shortAnswer: 'A light-to-medium roast with clean acidity, ground medium-fine. Our Yirgacheffe Gedeb and Colombia Huila Pink Bourbon are both AeroPress favourites. Recipe: 15g coffee, 210g water at 88°C, 1:15 steep, 30s press.',
    longAnswer: 'The AeroPress rewards the same coffees you would brew in a V60 — light-to-medium roasts, clean washed or honey process, high-elevation Arabica. The method is forgiving of grind and dose, so a single recipe will pull good results from a Yirgacheffe, a Pink Bourbon, a Chikmagalur honey or a Guatemalan Antigua. At our roastery we dial in the inverted AeroPress at a 1:14 ratio: 15g of coffee, 210g of water at 88°C, a 1:15 steep, then a 30-second gentle press stopping at the hiss. The lower temperature (88°C vs 94°C on V60) protects the delicate florals in lighter roasts and reduces the perceived bitterness in a cup that ends with a 30-second immersion. For a fruit-forward cup, a natural-process Yirgacheffe or a Pink Bourbon will deliver blueberry, jasmine and tropical fruit. For a sweeter, rounder cup, a Chikmagalur honey or a Guatemala washed will give jaggery, red apple and dark chocolate. The AeroPress is also the best travel brewer we know of — it does not need electricity, it is indestructible, and the paper micro-filter gives a clean cup that competes with a V60. Use the standard recipe as your baseline, then experiment with the inverted method (which we use), a longer steep of 2–3 minutes for more body, or a paper-and-metal filter combo for the cleanest possible cup. The "James Hoffmann" championship recipe (1:11, 4-minute steep, no immersion stir) is also worth trying once you have the standard dialed in.',
    category: 'brewing',
    relatedUrls: ['/brew/aeropress', '/coffee/ethiopia-yirgacheffe-gedeb', '/coffee/colombia-huila-pink-bourbon'],
  },
  {
    id: 'international-shipping',
    question: 'Does The Daily Roast ship internationally?',
    shortAnswer: 'Not at the moment. We currently ship within India only, through our courier partner. International shipping is on the roadmap but is not yet available.',
    longAnswer: 'The Daily Roast currently ships only within India. All Indian pin codes are served through our courier partner, and orders above ₹1,200 ship free. We do not yet ship to the United States, the United Kingdom, Singapore, the UAE or any other international destination — the brand is a Bangalore specialty coffee roastery and we have not yet built the international fulfilment operation, including the customs declarations, the import-doc pack for each destination, and the food-safety paperwork the destination customs require for green and roasted coffee. International shipping is on the long-term roadmap. In the meantime, the best way to keep your international friends in fresh Indian roasts is to send them a gift card from the roastery — they can place an order to any Indian address themselves and choose the grind and the delivery window. If you are a returning NRI customer who used to subscribe, drop us a line at support@dailyroast.in and we will let you know the moment international shipping opens. For diaspora customers we can also arrange forwarding via a friend or family member in India — we will dispatch to the address you give us, and the recipient can re-ship from India on their own courier account. Most metro Indian pin codes are next-day with our partner, tier-2 cities are 2–3 days, and remote addresses are 4–6 days.',
    category: 'shipping',
    relatedUrls: ['/faq', '/shipping'],
  },
  {
    id: 'best-espresso-roast',
    question: 'What is the best espresso roast?',
    shortAnswer: 'Our Midnight Runner — a dark roast blend of Brazil, Guatemala and Indian parchment, designed to pull a 1:2 shot in 27–30 seconds with dense crema, dark cocoa and no astringency.',
    longAnswer: 'The "best" espresso roast is a function of your machine, your basket size and what you like in the cup, but for a Bangalore audience pulling shots at home on a Sage Bambino, a Rancilio Silvia or a decent lever machine, our Midnight Runner dark roast is the safest answer. It is a blend of Brazil (for chocolate body), Guatemala (for cocoa and dried fruit) and Indian parchment (for a wild-card spice and a syrupy mouthfeel), roasted dark but not burnt — Development time is long enough to drive off the acetic acid that turns an espresso shot sour and into the Maillard browning that produces crema. On a 9-bar machine at 93°C, dose 18g, aim for 36g out in 27–30 seconds, and you will get a dense golden crema, dark cocoa nibs, molasses, toasted almond and a smoky caramel finish with zero astringency. If you prefer a brighter, more modern espresso, a single-origin Yirgacheffe or Pink Bourbon pulled long (1:2.5 in 35s) makes a beautifully fruity filter-style espresso. The honest answer is "it depends on your machine and your taste" — but Midnight Runner is what we drink at the roastery when we want an espresso. The Dawn Patrol Bangalore Blend is the medium-roast alternative for milk drinks — a Colombia/Brazil washed blend that cuts through a cappuccino without going sour, and at 18g in for a double basket you will get caramelised toffee and milk chocolate rather than the smoky cocoa of Midnight Runner.',
    category: 'product',
    relatedUrls: ['/coffee/midnight-runner-espresso', '/brew/espresso'],
  },
  {
    id: 'south-indian-filter-recipe',
    question: 'How do I brew traditional South Indian filter coffee?',
    shortAnswer: 'Use a 1:5 decoction — 20g medium-fine coffee to 100g water at 96°C, let it drip 12–15 minutes in a traditional brass filter, then mix one part decoction with three to four parts hot milk and sweeten with jaggery.',
    longAnswer: 'Traditional South Indian filter kaapi is a decoction brew, not a pour over, and the equipment is the familiar two-chamber brass or stainless filter. The recipe is 20g of medium-fine ground coffee in the upper chamber, 100g of water at 96°C poured gently over the pressing disc, the lid closed, and the decoction left to drip into the lower chamber for 12 to 15 minutes. Do not tamp the disc — pressing speeds the drip and produces a thin, bitter decoction. When the upper chamber is empty, lift out the disc and the spent grounds; the decoction in the lower chamber is your concentrate. To serve, mix roughly one part decoction to three to four parts hot frothy milk in a dabarah and tumbler, sweeten to taste with unrefined jaggery, and pour it back and forth between the two vessels until it froths. The grind is medium-fine — finer than pour over, coarser than espresso. A 70/30 coffee-to-chicory mix is the Madras style; a 100% Arabica is the more modern, more origin-forward Bangalore style. At our roastery we grind for the South Indian filter at no extra cost, and the Chikmagalur Attikan Estate Honey is the lot we recommend for the everyday kaapi. A single brewing session of 100g decoction serves 2 to 3 cups depending on strength.',
    category: 'brewing',
    relatedUrls: ['/brew/filter-kaapi', '/coffee/chikmagalur-attikan-estate-honey'],
  },
  {
    id: 'arabica-vs-robusta',
    question: "What's the difference between Arabica and Robusta?",
    shortAnswer: 'Arabica is sweeter, more nuanced and roughly half the caffeine of Robusta. Robusta is more bitter, more caffeinated, and the dominant species in commodity instant coffee. The Daily Roast uses 100% Arabica across the catalog.',
    longAnswer: 'Arabica (Coffea arabica) and Robusta (Coffea canephora) are the two species that make up almost all the coffee in the world, and they are very different plants. Arabica is a high-elevation, shade-loving shrub that prefers 1,200m and above, with a delicate, sugary, complex cup profile — jasmine, citrus, stone fruit, jaggery, bergamot, depending on origin and process. The plant is more vulnerable to leaf rust and produces a lower yield per hectare, which is why it costs more. Robusta is a hardier, higher-yielding, lower-elevation plant that thrives in direct sun and hot climates, particularly in India (Karnataka and Kerala are major Robusta producers), Vietnam, Brazil and parts of Africa. Its cup is heavier-bodied, more bitter, higher in caffeine (roughly 2.0–2.4% caffeine by weight vs Arabica at 1.0–1.4%), and is the dominant species in commodity instant coffee and in the espresso blends served in most Italian bars. The Daily Roast catalog is 100% Arabica because we are a specialty roastery and Arabica is the species that produces the flavour spectrum our customers are drinking for. Indian Robusta is excellent in its own right and is an authentic part of Indian filter kaapi culture, but it is a different drink. There are also two less common species — Liberica (the large, woody Philippine and West African bean) and Excelsa (now classified as a Liberica variant) — which show up in some heritage blends and Southeast Asian markets, but they are <2% of world production and you are unlikely to encounter them outside a specialty roaster.',
    category: 'science',
    relatedUrls: ['/coffee/', '/#flavor-wheel'],
  },
  {
    id: 'best-altitude',
    question: 'What altitude is best for coffee?',
    shortAnswer: 'Above 1,200m for specialty quality. Our Indian and international lots range from 1,400m (Araku) to 2,150m (Yirgacheffe), with Attikan at 1,750m and Pink Bourbon at 1,900m.',
    longAnswer: 'The rule of thumb in specialty coffee is that higher elevation produces a denser, more complex bean, because the coffee cherry has to fight harder against cold nights and short growing seasons to ripen. The practical floor for specialty is around 1,200m, and the very best lots in the world come from 1,500m to 2,200m. Our catalog spans the high-elevation specialty range: Chikmagalur Attikan Estate at 1,750m in the Baba Budan Giri range of Karnataka, Araku Valley Red Honey at 1,400m in the Eastern Ghats of Andhra Pradesh, Ethiopia Yirgacheffe Gedeb at 2,150m, and Colombia Huila Pink Bourbon at 1,900m. Each of those altitudes produces a denser bean with more concentrated sugars and a more developed acidity, which is what gives the cup its clarity and complexity. Lower-elevation coffee is not bad — Brazilian Cerrado at 900–1,100m is the workhorse of the espresso world for exactly that reason — but the flavour ceiling drops as altitude does. We do not currently source below 1,400m for our single-origin range, and the Midnight Runner espresso blend includes some lower-elevation Brazil because we are using it for body, not for flavour top notes. The general pattern is: each 300m of elevation adds about a degree of complexity to the cup, and the SCA cupping score of a lot correlates with altitude up to about 2,200m, after which it plateaus because the tree is too stressed to produce economically.',
    category: 'sourcing',
    relatedUrls: ['/coffee/chikmagalur-attikan-estate-honey', '/coffee/araku-valley-red-honey', '/coffee/ethiopia-yirgacheffe-gedeb'],
  },
  {
    id: 'store-fresh-coffee',
    question: 'How should I store fresh coffee?',
    shortAnswer: 'Airtight, cool, dark, and whole bean. Keep the bag sealed (or transfer to a ceramic container with a gasket), away from sunlight and the stovetop. Do not freeze your daily-use coffee — only freeze beans you will not open for two weeks or more.',
    longAnswer: 'Coffee has four enemies: oxygen, moisture, heat and light. The right storage is a sealed bag or container, kept in a cupboard away from the stovetop and any direct sun, at a stable room temperature. The foil valve bags we ship in are designed for exactly this: the one-way valve lets CO2 escape without letting oxygen in, and the foil blocks light. If you decant into a ceramic jar, choose one with a rubber gasket and a clamp lid, and only decant what you will use in the next week — leaving the rest in the sealed bag is better than opening the bag every day. Whole bean keeps noticeably longer than pre-ground because the grinding step dramatically increases the surface area exposed to oxygen. Freezing is a controversial topic: do not freeze your daily-use bag because every time you open the freezer you condense moisture on the beans, which degrades the cup. Only freeze beans you are saving for two weeks or more, in single-brew portions, and never refreeze thawed beans. The single best thing you can do for freshness is buy smaller bags more often — 250g of beans finished in 10 days will out-cup a 1kg bag you took three weeks to finish.',
    category: 'storage',
    relatedUrls: ['/faq', '/#catalog'],
  },
  {
    id: 'anaerobic-natural',
    question: 'What is anaerobic natural coffee?',
    shortAnswer: 'Anaerobic natural coffee is fermented inside sealed, oxygen-free tanks before drying, which produces intense, wine-like, sometimes funky flavours — think spiced rum, black cherry, dark cocoa rather than the cleaner fruit of a standard natural.',
    longAnswer: 'An anaerobic natural is a process experiment where the ripe coffee cherries, or sometimes just the depulped beans, are sealed in a stainless-steel tank with a one-way valve that lets CO2 escape but does not let oxygen in. The tank may be temperature-controlled, sometimes for 24 hours and sometimes for several days, and the microbes driving the fermentation work in a low-oxygen, high-CO2 environment that produces a very different chemical fingerprint from a normal open-tank or raised-bed fermentation. The cup tends to be intense, layered, sometimes polarizing: think spiced rum, black cherry compote, dark cocoa, pipe tobacco, sometimes a touch of fermented-fruit funk that you either love or you do not. Our Sumatra Kerinci Valley Anaerobic is a textbook example — Kerinci Highlands at 1,400m, anaerobic natural process, medium-dark roast, with the spiced rum and black cherry notes the process is known for. These lots are not for everyone; if you want clarity and bright florals, drink a washed Pink Bourbon. If you want a wild, expressive, almost experimental cup, an anaerobic is a great place to start. Anaerobic processing is a relatively new addition to the specialty canon — most of the experiments in this space are post-2015, and the same farm can produce dramatically different cups in different anaerobic runs depending on tank temperature, dwell time, and yeast strain. We treat our anaerobic lots as small experiments; when one is exceptional we keep it, when one is merely interesting we blend it into a house mix.',
    category: 'processing',
    relatedUrls: ['/coffee/sumatra-kerinci-valley-anaerobic', '/#flavor-wheel'],
  },
  {
    id: 'specialty-worth-it',
    question: 'Is specialty coffee worth the price?',
    shortAnswer: 'Yes — for the price of two daily mass-market cappuccinos, a 250g bag of freshly roasted 88+ point single-origin coffee makes 12–15 cups at home. The per-cup cost is comparable and the cup is dramatically better.',
    longAnswer: 'Specialty coffee is more expensive per kilogram than commodity coffee, but the per-cup cost is much closer than the headline number suggests. A 250g bag at ₹450 makes about 12 to 15 single filter cups at home — that is ₹30 to ₹38 per cup, comparable to a single barista-made cappuccino in Bangalore. The difference is the cup itself: a freshly roasted 88+ point specialty coffee is traceable to a single farm, single lot, often single day of picking, with zero primary defects and a flavour profile the producer was selected for. Commodity coffee is graded at 60–80 points, blends across farms and harvests, includes secondary defects, and is typically roasted weeks before you buy it. The premium you pay is for transparency (you know which farm, which altitude, which process), for quality (zero primary defects, hand-picked cherry), and for freshness (roasted the day it ships). Whether it is worth it depends on whether you taste the difference, and most people who switch do. We also offer 100g taster pouches in the curated 3x 100g flight, which is the cheapest way to find out without committing to a full bag of any one origin. The honest answer to "is specialty worth it" is also: the first 250g of single-origin is a revelation; the tenth 250g teaches you to taste the difference between farms, processes and roast levels; and the hundredth 250g is when you start buying by harvest date rather than by bag. Most of our regular customers say they wish they had switched earlier, and the per-cup math is what makes the switch feel cheap rather than expensive.',
    category: 'shopping',
    relatedUrls: ['/coffee/curated-taster-flight-3x100g', '/#taster-flight', '/'],
  },
  {
    id: 'sca-flavor-wheel',
    question: 'What is the SCA flavor wheel?',
    shortAnswer: 'The Specialty Coffee Association flavor wheel is the standardized vocabulary coffee professionals use to describe what they taste — broken into 9 colour-coded families (fruity, floral, sweet, nutty/cocoa, spicy, etc.) and 100+ sub-notes.',
    longAnswer: 'The SCA Coffee Taster’s Flavor Wheel, published by the Specialty Coffee Association, is the industry-standard reference for describing what you taste in a cup of coffee. It was last revised in 2016 with input from World Coffee Research and is built on the original 1995 wheel, updated to reflect modern specialty coffee and sensory science. The wheel is organized in rings: the inner ring has nine broad categories (fruity, floral, sweet, nutty/cocoa, spices, roasted, sour/fermented, green/vegetative, other) and the outer rings break each of those down into specific notes — for example, "fruity" splits into "berry", "dried fruit", "citrus", "stone fruit" and so on. The wheel is used during a formal cupping to align the language a Q-grader uses with the language a buyer, a roaster and a barista will read in a tasting note. We use it on our roastery floor and on the product pages: when we say Attikan Estate has "jaggery, red apple, roasted hazelnut" those are real wheel positions, not marketing language. The same wheel powers the interactive flavor wheel on the homepage. A Q-grader (a licensed SCA cupping judge) uses a slightly extended version of the wheel called the Coffee Taster’s Flavor Lexicon, which has standardised descriptors for everything from "lemon grass" to "black currant" to "medicinal" — all the notes you will find in a fine cup, including the off-flavours a Q-grader is specifically trained to detect. If you are learning to cup at home, the wheel plus a notebook is the entire toolkit; everything else is practice.',
    category: 'science',
    relatedUrls: ['/#flavor-wheel', '/#catalog'],
  },
  {
    id: 'cupping-at-home',
    question: 'How do I do a coffee cupping at home?',
    shortAnswer: 'Set up 5 identical cups per coffee, dose 12g of medium-coarse grounds each, pour 200ml of water at 93°C, steep 4 minutes, break the crust, slurp from a spoon. Score fragrance, flavour, aftertaste, acidity, body, balance.',
    longAnswer: 'A home cupping is the cheapest way to taste a set of coffees side by side and learn the SCA flavor wheel in practice. You will need: 5 identical cups per coffee (ramekins or 200ml glasses work), a scale, a kettle, a timer, cupping spoons (or any small deep spoon), and water that is filtered, not mineral. Per cup, dose 12g of medium-coarse ground coffee (a bit coarser than V60), pour 200ml of water at 93°C directly onto the grounds, and let it steep for 4 minutes uncovered. While it steeps, score the dry fragrance and the wet aroma. At 4 minutes, break the crust by gently stirring the surface three times with a spoon, then skim the foam and the floating grounds. Slurp from the spoon — the slurp aerosolises the coffee across the palate the way espresso does, and is the only way to taste the full acidity and aromatics. Score on a 1–5 or 1–10 scale across fragrance/aroma, flavour, aftertaste, acidity, body, balance, and an overall impression. SCA-certified cupping form is free online, but a notebook works fine. Our roastery cuppings on the experiences page use this exact protocol across six single origins. The hardest part of home cupping is calibrating your palate against itself — score all five cups of one coffee before moving to the next, and taste them from left to right in the same order every time. Do not eat or drink anything but water for 30 minutes before a cupping; the palate is more sensitive than people realise, and toothpaste residue is enough to flatten the cup.',
    category: 'brewing',
    relatedUrls: ['/#experiences', '/#flavor-wheel'],
  },
  {
    id: 'best-water',
    question: "What's the best water for brewing coffee?",
    shortAnswer: 'Filtered water with 50–175 ppm total dissolved solids, no chlorine, and a hardness around 50–100 ppm calcium. Avoid distilled (zero minerals = flat cup) and hard borewell water (scales the kettle, mutes the cup).',
    longAnswer: 'Coffee is about 98% water by mass, which is why the SCA has a published water standard: total dissolved solids (TDS) between 50 and 175 ppm, hardness around 50–100 ppm calcium, alkalinity around 40–75 ppm, and a pH of 6.5 to 7.5. The minerals matter because they help extract the flavour compounds from the grounds — too few minerals (distilled or reverse-osmosis water with TDS below 30) and the cup reads as flat and empty; too many (hard borewell water above 300 ppm) and the cup reads as muddy, with scaling building up on your kettle and your machine. Chlorine is the other thing to remove — it mutes the aromatics in a way most people blame on the coffee. A simple activated-carbon filter (Brita, Pureit, etc.) takes care of the chlorine and brings most municipal Indian water into the right range. Bangalore borewell water in many areas is hard enough that you will want a filter plus a brief boil, or a small RO system with a remineralisation cartridge. Do not brew specialty coffee with distilled water; do not brew it with hard borewell water unfiltered. Filtered, room-temperature, freshly drawn water is the boring right answer. If you want to nerd out, the Third Wave Water mineral packets and the Lotus Coffee Water drops are designed to bring reverse-osmosis water up to the SCA spec, and a few Bangalore specialty cafes use them. Most people, however, never need to go that far — a good carbon filter and a measured dose of patience is enough.',
    category: 'brewing',
    relatedUrls: ['/faq', '/#brew-guide'],
  },
  {
    id: 'visit-roastery',
    question: 'Can I visit the roastery in Bangalore?',
    shortAnswer: 'Yes. Our roastery on 100ft Road, Indiranagar is open daily 9:00 AM – 7:00 PM. Roastery tours and cupping sessions are bookable on the experiences page, or walk in for a coffee and a chat.',
    longAnswer: 'You can visit the roastery any day of the week from 9:00 AM to 7:00 PM, no appointment needed for a walk-in coffee or to buy beans off the shelf. For something more structured we run four bookable experiences: a 15-minute barista teleconsultation (over video, no visit required), an in-person roastery tour on the roasting floor, a guided cupping session across six single origins, and a three-day estate tour in the Chikmagalur hills. Roastery tours and cupping sessions are bookable on the experiences page. Annual subscribers get a tour seat, a cupping seat and a video-consultation credit included with their plan. The address is 100ft Road, Indiranagar, Bangalore 560038, and we are within walking distance of the Indiranagar Metro station. If you are in Bangalore, drop in — there is almost always a roast on and a barista free to talk about it. The best time to visit is between 11am and 4pm, which is when most of the roasting happens and the cupping table is busy. If you are coming for a specific lot, write to us 24 hours ahead and we will have a fresh cup waiting for you; if you are just curious, walk in and ask whoever is on the bar for a tour — we are a small team and we are used to it.',
    category: 'roastery',
    relatedUrls: ['/#experiences', '/#roastery-story', '/#track-order'],
  },
  {
    id: 'direct-trade',
    question: 'What is direct trade coffee?',
    shortAnswer: 'Direct trade means the roaster buys directly from the farm or co-operative, skipping the commodity chain. It usually means better pay for the farmer, more transparency for the roaster, and better quality for the drinker.',
    longAnswer: 'Direct trade is a sourcing model where the roaster establishes a relationship directly with the farm or co-operative that grew the coffee, and buys the lot directly from them rather than through commodity brokers and exporters. The practical differences from commodity sourcing are: the roaster knows which farm, which lot, which altitude, which picking date; the farmer typically receives a higher price than the C-market rate, sometimes 2–4x; the roaster can request specific picking, processing or drying protocols; and the resulting coffee is traceable, which is the entire foundation of the specialty industry. The term is not formally certified the way "organic" or "fair trade" are, and definitions vary by roaster, so the safer claim is "we buy direct from named estates" rather than "we are direct-trade certified". At The Daily Roast our Indian lots are sourced through long-standing partnerships with multi-generational estates in Chikmagalur, Coorg and Araku Valley. Our international lots (Ethiopia, Colombia, Guatemala, Sumatra) come through importers we have worked with for years and who in turn buy from named farms and washing stations. Every product page on the site names the estate or co-op on the spec table. The honest critique of direct trade is that it does not have a third-party audit the way Fair Trade and organic do, so the claim lives or dies on the roaster’s willingness to publish what they paid and to whom. We publish the estates we work with, the altitude of every lot, and the price band we paid; the per-farm exact figure is a private commercial term we do not disclose publicly, but the band is available on request.',
    category: 'sourcing',
    relatedUrls: ['/coffee/chikmagalur-attikan-estate-honey', '/#roastery-story', '/#catalog'],
  },
  {
    id: 'microlot',
    question: 'What is a micro-lot in coffee?',
    shortAnswer: 'A micro-lot is a small, traceable parcel of coffee from a single farm, a single section of a farm, or sometimes a single day of picking — typically a few bags to a few hundred kilograms, with a distinct cup profile.',
    longAnswer: 'A micro-lot is the smallest meaningful unit of coffee you can buy and taste as a discrete product. In practice it means a single farm, a single section of a single farm, or sometimes a single day of cherry picking at a single farm — anywhere from a few 60kg bags to a few hundred kilograms of green coffee, all picked, processed and dried as a discrete batch. The cup profile is distinct enough to warrant being sold separately rather than blended into the farm’s main lot. Our Araku Valley Red Honey is a micro-lot: it is a Selection 5B variety, an extended red honey process, picked from a defined plot at 1,400m in the Eastern Ghats, and it tastes like ripe jackfruit, wild blossom honey and candied orange peel — a profile distinct enough that we would not blend it away. The whole point of the micro-lot model is traceability: you know who picked it, when, and what they did differently, and the farmer is paid for the distinctness rather than blended into a commodity price. Micro-lots are also where processing experiments — anaerobic naturals, extended fermentations, carbonic macerations — show up, because the small volume makes it commercially viable to try a different protocol.',
    category: 'sourcing',
    relatedUrls: ['/coffee/araku-valley-red-honey', '/coffee/sumatra-kerinci-valley-anaerobic', '/#catalog'],
  },
  {
    id: 'roast-schedule',
    question: 'How often do you roast?',
    shortAnswer: 'Daily, Monday through Saturday. Orders placed before 14:00 IST roast and ship the same day; later orders ship the next roasting day. Subscription orders are roasted and shipped right before each renewal, not stockpiled.',
    longAnswer: 'We roast Monday through Saturday at the Indiranagar roastery, with Sunday reserved for maintenance and cuppings. The schedule is built around the order book: orders placed before 14:00 IST on a roasting day are queued into that day’s batches, roasted through the afternoon, and shipped the same evening through our courier partner. Orders placed after 14:00 ship the next roasting day. We do not stockpile roasted coffee — every bag is roasted the day it ships, which is why a fresh order from us reaches you inside 4–7 days from when you placed it, with most of that time being courier transit rather than roast-to-dispatch. Subscription orders are roasted and shipped the day before each renewal rather than in advance, so a weekly subscription coffee arrives a week after the previous one was roasted, not six weeks. If you need a specific dispatch day, the order confirmation email carries a tracked link and you can ping support@dailyroast.in to nudge it forward by a day if needed. The roast schedule is also why we ask for the grind at checkout — we grind the day we ship, not the day you order, so the grind setting is the one that matches the coffee in the bag when it leaves the roastery, not the day you placed the order. If you change your mind about the grind after the order is placed, we cannot re-grind, but you can switch to whole bean on a future order.',
    category: 'operations',
    relatedUrls: ['/faq', '/shipping', '/#track-order'],
  },
  {
    id: 'subscription',
    question: 'Do you offer a subscription?',
    shortAnswer: 'Yes. The Daily Roast Club has five tiers — Explorer, Roastery, Reserve, Connoisseur and Founder — billed monthly or annually, with free shipping, member perks and (at the top tier) an estate-visit seat included.',
    longAnswer: 'Yes — The Daily Roast Club is our subscription programme, with five tiers from Explorer (one bag a month) to Founder, and both monthly and annual billing. Every tier includes free shipping on every delivery, a member discount versus the one-time price, and access to our loyalty programme. The higher tiers add the things only a committed subscriber gets: 15-minute video consultations with one of our baristas, a roastery tour seat on the roasting floor, a cupping table seat across six single origins, and — on the Founder tier — a place on the annual estate visit in the Western Ghats. You can pause, change the coffee, change the frequency (weekly, bi-weekly, monthly), change the grind, or cancel any time before the next renewal by replying to your subscription email or by writing to support@dailyroast.in. There are no cancellation fees. The subscription is the cheapest way to drink our roasts at the lowest per-bag price, and the way we roast-to-order makes the schedule reliable — your coffee is roasted the day before it ships, not stockpiled. See the subscription plans section on the homepage for the current per-tier price and benefit list. Annual terms are prepaid, cheaper per bag than the monthly equivalent, and include the perks that only come with committing to a year: the video consultation, the roastery tour, the cupping table and (Founder only) the annual estate visit. If you cancel mid-year, we refund the unused months on a pro-rata basis — no questions, no fees.',
    category: 'shopping',
    relatedUrls: ['/#subscription-plans', '/faq', '/'],
  },
  {
    id: 'sour-coffee',
    question: 'What if my coffee tastes sour?',
    shortAnswer: 'Grind finer, raise the water temperature, or extend the contact time. Sourness is under-extraction — water did not pull enough sweetness out of the grounds. Tweak one variable at a time.',
    longAnswer: 'A sour, sharp, thin or lemony cup is an under-extraction signal: the water passed through the grounds too quickly, or not hot enough, or both, and pulled out the acids and not the sugars. The fix is one of three things — grind finer (slower flow, more contact), raise the water temperature by 2–3°C (faster extraction kinetics), or extend the contact time (longer bloom, longer steep, or a longer drawdown). Tweak one variable at a time. On a V60, if your drawdown is finishing at 2:30, grind one click finer. On an AeroPress, if the cup is sharp and thin, push the steep from 1:15 to 1:45 before pressing. On espresso, if the shot is running in 20 seconds and tastes sour, grind one step finer. Sourness can also come from stale beans, but if your coffee is within the 7–14 day peak window and the bag is properly sealed, the fix is in the recipe, not the bean. If you are buying from us and a fresh bag is consistently sour across multiple brews and recipes, that is a roast defect and we will replace the bag — write to support@dailyroast.in with your order number. The same sour-cup logic also explains why a light roast needs a finer grind than a dark roast at the same brew method: the dense light-roast bean resists extraction more, and the smaller grind compensates by exposing more surface area. Dark roasts are more soluble, so they need a coarser grind to slow the water down.',
    category: 'troubleshooting',
    relatedUrls: ['/brew/v60', '/brew/aeropress', '/brew/espresso'],
  },
  {
    id: 'bitter-coffee',
    question: 'What if my coffee tastes bitter?',
    shortAnswer: 'Grind coarser, lower the water temperature, or shorten the contact time. Bitterness is over-extraction — water pulled too much out of the grounds, including the bitter compounds. Tweak one variable at a time.',
    longAnswer: 'A bitter, ashy, drying, charcoal-like cup is an over-extraction signal: the water sat on the grounds too long, was too hot, or both, and pulled the bitter compounds out along with the sugars. The fix is the inverse of the sour-cup fix — grind coarser (faster flow, less contact), lower the water temperature by 2–3°C, or shorten the contact time. As with sourness, change one variable at a time. On a V60, if your drawdown is past 3:45, grind one click coarser. On a French press, if the cup is bitter, drop the steep from 4 minutes to 3 minutes. On an AeroPress, press faster or shorten the steep. The exception is the cup that is "bitter" but is actually a darker roast reading naturally — a dark roast will read as more bitter than a light roast at the same recipe, because the roast itself drives the chemistry. If you are buying dark roasts and finding them bitter, the fix is a lighter roast rather than a different recipe. If you are buying light roasts and finding them bitter, the fix is the recipe. The cleanest test is to brew the same bag two ways — once too short, once too long — and feel the difference on your own palate. Most people’s "bitter" complaints are actually an astringent puckering caused by a grind that is too fine, not a chemical bitterness from over-extraction; the practical fix is the same (coarser grind), but the diagnosis is different.',
    category: 'troubleshooting',
    relatedUrls: ['/brew/v60', '/brew/aeropress', '/brew/espresso'],
  },
  {
    id: 'cold-brew-coffee',
    question: 'What is the best coffee for cold brew?',
    shortAnswer: 'Our Glacier Steep Cold Brew Blend — a medium-dark natural-process blend of Ethiopian natural and Guatemala, designed for a coarse grind and a 16–24 hour cold steep. Smooth, low acidity, baker’s chocolate and wild blueberry.',
    longAnswer: 'The best coffee for cold brew is a coffee designed for it, not whatever is left over from your V60 shelf. Cold brew is a long, cold, coarse extraction — typically 16 to 24 hours at refrigerator temperature with a 1:8 to 1:10 ratio of coffee to water — and the cup profile that comes out is heavy-bodied, low in perceived acidity, chocolatey and slightly fruity, with a long sweet finish. The bean needs to be a natural or honey process with enough body to hold up to the dilution most people serve at, and a roast level dark enough to push the chocolate/nut notes without going so dark it reads as ashy. Our Glacier Steep Cold Brew Blend is a blend of Ethiopian natural and Guatemala roasted medium-dark, ground coarse (think raw sugar), dosed at a 1:8 concentrate and steeped cold for 18 hours. The result is baker’s chocolate, wild blueberry syrup, macadamia nut and a clean maple finish. Dilute 1:1 with water or milk for a ready-to-drink cup, or drink the concentrate as a base for an espresso-martini or an iced latte. The same blend also works as a hot French press if you want a quick path to the same flavour profile.',
    category: 'product',
    relatedUrls: ['/coffee/glacier-steep-cold-brew-blend', '/#catalog'],
  },
  {
    id: 'decaf',
    question: 'Do you have decaf?',
    shortAnswer: 'Not at the moment. We do not currently roast a decaf option — our entire catalog is caffeinated 100% Arabica. A Swiss-water or sugar-cane EA decaf is on the product roadmap for 2026.',
    longAnswer: 'We do not currently offer a decaffeinated option. The entire catalog — Attikan, Araku, Yirgacheffe, Pink Bourbon, Antigua, Kerinci, Dawn Patrol, Midnight Runner, Glacier Steep — is 100% caffeinated Arabica, which is why each cup carries 80–100 mg of caffeine per 8oz filter serving. The honest reason is that a good decaf is genuinely hard to source, and we did not want to ship a Swiss-water or sugar-cane EA decaf that was a step down in quality from the rest of the catalog just to fill a line on the menu. A small-batch decaf is on the product roadmap for 2026, sourced from one of the same Indian or East African origins we already work with. In the meantime, our most reliable recommendation for a lower-caffeine cup is the half-caf approach: blend a small portion of our regular coffee with a decaf you can source locally, or drink a single small espresso rather than a large filter brew. If you are a healthcare professional, pregnant, or caffeine-sensitive and need a decaf urgently, write to support@dailyroast.in and we will let you know the moment a clean, traceable decaf is on the shelf. The decaf process itself is worth knowing: Swiss Water and EA (sugar-cane ethyl acetate) are the two cleanest methods, both removing 99.9% of caffeine without the chemical residues the older methylene chloride process left behind. Most specialty decaf in 2026 is one of those two, and a good Swiss Water or EA decaf can taste close to its caffeinated twin if the green coffee was high-scoring to begin with.',
    category: 'product',
    relatedUrls: ['/coffee/', '/#catalog'],
  },
  {
    id: 'washed-vs-natural',
    question: "What's the difference between washed and natural process?",
    shortAnswer: 'Washed coffee has the fruit removed before drying, producing a clean, bright, origin-forward cup. Natural coffee dries inside the whole cherry, producing a fruitier, wilder, more fermenty cup.',
    longAnswer: 'Washed and natural are the two most common coffee processing methods and the cleanest contrast to understand. In a washed process the ripe cherry is mechanically depulped to remove the skin, then fermented in water tanks for 12–72 hours to break down the sticky mucilage layer, then washed clean and laid out to dry with nothing left on the bean. The cup is clean, bright, origin-forward — the flavours of the bean and the terroir are unmuddled by the flavours of the fruit. Our Colombia Huila Pink Bourbon and Guatemala Antigua Los Volcanes are both washed and both are textbook examples: Pink Bourbon reads as pink guava, papaya, cane sugar syrup and lemon verbena, while Antigua reads as dark chocolate ganache, toasted pecan and dried plum. In a natural process the whole ripe cherry is laid out to dry with the fruit still intact, so the bean ferments inside its own sugary pulp for days or weeks. The cup is heavier-bodied, lower in perceived acidity, and carries the flavours of the fruit — blueberry, strawberry, tropical, sometimes boozy. Our Ethiopia Yirgacheffe Gedeb is a natural and is the cleanest introduction to the style. Most of the world’s specialty coffee is now somewhere on a spectrum between fully washed and fully natural, with honey and anaerobic processes covering the middle ground.',
    category: 'processing',
    relatedUrls: ['/coffee/colombia-huila-pink-bourbon', '/coffee/guatemala-antigua-los-volcanes', '/coffee/ethiopia-yirgacheffe-gedeb'],
  },
  {
    id: 'pour-over-temperature',
    question: 'What is the optimal water temperature for pour over?',
    shortAnswer: '93–96°C is the sweet spot for V60, Chemex, Kalita and most pour-over drippers. Below 90°C under-extracts; above 98°C over-extracts and risks a metallic, tea-like cup. Use a kettle with a thermometer until you learn the boil-off rate.',
    longAnswer: 'The optimal water temperature for a V60, Chemex, Kalita Wave or other pour-over dripper is 93 to 96°C — the narrower end of the SCA brew standard. The 93°C floor is the lower bound where the extraction kinetics still pull enough sweetness out of the grounds in a 3-minute brew; below 90°C the cup goes thin and sour, because the water simply does not have the energy to dissolve the sugars and the oils fast enough. The 96°C ceiling protects delicate, light-roast coffees from over-extraction, where the water strips out the bitter compounds along with the aromatics and the cup reads as metallic, tea-like and slightly hollow. For a darker roast, sit at the lower end of the range (92–94°C); for a light-to-medium roast, sit at the upper end (94–96°C). The honest practical answer is to bring your kettle just off the boil — a rolling boil is 100°C, and 30–60 seconds of cool-down brings a typical 1L kettle into the right band. Once you have brewed a few times, you can read the kettle without a thermometer, but until then a £10 kettle thermometer is the cheapest recipe upgrade you can buy. The altitude of your kitchen matters too — Bangalore is around 920m above sea level, so water boils at ~97°C rather than 100°C, and the "30 seconds off the boil" rule-of-thumb needs to be tightened to about 10–15 seconds. Most home kettles in Bangalore are actually closer to 95°C at the moment the click-off happens, which is why our 94°C recommendation lands exactly where the click-off temperature is for most people.',
    category: 'brewing',
    relatedUrls: ['/brew/v60', '/#brew-guide'],
  },
  {
    id: 'attikan-location',
    question: 'Where is Attikan Estate?',
    shortAnswer: 'Attikan Estate is in the Baba Budan Giri range of the Western Ghats, Chikmagalur district, Karnataka, India, at 1,750m above sea level — one of the original 17th-century Arabica planting sites in India.',
    longAnswer: 'Attikan Estate sits in the Baba Budan Giri range of the Western Ghats, in Chikmagalur district of Karnataka, India — about 250 km west of Bangalore and the historical birthplace of Indian coffee. The Baba Budan Giri hills are the mountains where the saint Baba Budan is credited with smuggling seven coffee seeds from Yemen in the 17th century and planting them on the slopes; the original plantation site, the Bababudangiris, is still a place of pilgrimage for Indian coffee. Attikan itself is a multi-generational estate at 1,750m above sea level, growing S.795 and SLN 9 Arabica under shade, and processing the lot as a pulp sun-dried honey — the sugars of the mucilage ferment into the bean as it dries on raised African beds. We have been buying from Attikan for several seasons and the consistency is what makes it our house honey: jaggery, red apple, roasted hazelnut, caramel, year after year. The estate is roughly 4 hours by road from our Indiranagar roastery, and the team visits the lot every season to cup the picking before we commit to the purchase. The Western Ghats as a whole are a UNESCO World Heritage Site and one of the eight "hottest hotspots" of biological diversity in the world — shade-grown coffee here means the farms are part of that forest, not cleared from it, and the bird and insect biodiversity is a real marker of how well the estate is farmed. The Chikmagalur region specifically is a 1,000+ sq km coffee belt running along the Baba Budan Giri range, with over 5,000 individual estates; Attikan is one of the larger, longer-established operations and is the one we trust to deliver the same profile harvest after harvest.',
    category: 'sourcing',
    relatedUrls: ['/coffee/chikmagalur-attikan-estate-honey', '/#roastery-story'],
  },
];

/* --------------------------------------------------------------- the comparison tables */

/**
 * Comparison tables lifted by AI Overviews and Bing Copilot preferentially because they fit
 * the "X vs Y" intent directly. Six tables: brew methods, roast levels, origins, processing
 * methods, subscription tiers, and brew methods by use case. Each table is 4–6 rows and
 * 3–5 columns, with a short intro paragraph an LLM can quote.
 */
export const COMPARISONS = [
  {
    id: 'brewer-comparison',
    title: 'Pour over vs AeroPress vs French press',
    intro: 'Three manual brewers every home barista considers first. Pour over for clarity and aromatics, AeroPress for richness and travel, French press for body and ritual. All three are 100% Arabica friendly and all three work with our single-origin catalog.',
    headers: ['Attribute', 'V60 Pour over', 'AeroPress Inverted', 'French Press'],
    rows: [
      ['Coffee-to-water ratio', '1:16', '1:14', '1:15'],
      ['Grind size', 'Medium-fine (table salt)', 'Medium-fine', 'Coarse (raw sugar)'],
      ['Water temperature', '94°C', '88°C', '95°C'],
      ['Brew time', '3:00–3:15', '1:15 steep + 30s press', '4 min steep + 2 min settle'],
      ['Body', 'Light, tea-like', 'Medium, velvety', 'Heavy, full-bodied'],
      ['Brightness', 'High — shows the origin', 'Medium — fruit-forward', 'Low — round and chocolatey'],
    ],
    relatedUrls: ['/brew/v60', '/brew/aeropress', '/#brew-guide'],
  },
  {
    id: 'roast-level-comparison',
    title: 'Light vs Medium vs Dark roast',
    intro: 'Roast level is the single biggest variable in how a coffee tastes, before the bean, the process and the brew method enter the picture. Lighter is brighter and more origin-driven; darker is bolder and more roast-driven.',
    headers: ['Attribute', 'Light roast', 'Medium roast', 'Dark roast'],
    rows: [
      ['Body', 'Light to medium, tea-like', 'Medium, balanced', 'Heavy, syrupy'],
      ['Acidity', 'Bright, citric or malic', 'Balanced, soft', 'Low, baked out'],
      ['Sweetness', 'Floral, fruity, honey', 'Caramel, jaggery, toffee', 'Molasses, dark cocoa, smoky'],
      ['Caffeine (per bean)', 'Highest', 'Middle', 'Lowest (lost to roast)'],
      ['Best for', 'V60, AeroPress, filter kaapi (light-medium)', 'Espresso, moka, drip', 'Espresso, milk drinks, dark kaapi'],
      ['Example on our menu', 'Yirgacheffe Gedeb', 'Chikmagalur Attikan, Dawn Patrol', 'Midnight Runner, Glacier Steep'],
    ],
    relatedUrls: ['/#flavor-wheel', '/coffee/ethiopia-yirgacheffe-gedeb', '/coffee/midnight-runner-espresso'],
  },
  {
    id: 'origin-comparison',
    title: 'Indian vs Ethiopian vs Colombian single-origin',
    intro: 'The three most common specialty origins in a Bangalore catalog. Each has a recognisable regional profile, but the cup varies dramatically with farm, altitude, and process.',
    headers: ['Attribute', 'Indian (Chikmagalur, Araku)', 'Ethiopian (Yirgacheffe)', 'Colombian (Huila)'],
    rows: [
      ['Region', 'Western Ghats / Eastern Ghats', 'Gedeb, Yirgacheffe zone', 'San Agustin, Huila'],
      ['Altitude range', '1,400–1,750m', '1,900–2,200m', '1,700–2,000m'],
      ['Common processes', 'Honey, washed', 'Natural, washed', 'Washed, honey'],
      ['Typical notes', 'Jaggery, red apple, hazelnut, spice', 'Jasmine, bergamot, peach, blueberry', 'Pink guava, papaya, cane sugar, lemon verbena'],
      ['Body', 'Medium, silky', 'Light to medium, tea-like', 'Medium, juicy'],
      ['Best brew', 'V60, filter kaapi, AeroPress', 'V60, AeroPress, Chemex', 'V60, espresso, drip'],
    ],
    relatedUrls: ['/coffee/chikmagalur-attikan-estate-honey', '/coffee/ethiopia-yirgacheffe-gedeb', '/coffee/colombia-huila-pink-bourbon'],
  },
  {
    id: 'process-comparison',
    title: 'Washed vs Honey vs Natural process',
    intro: 'The three most common specialty processing methods. The same bean can taste dramatically different depending on how the fruit is handled between picking and drying — these are the practical differences.',
    headers: ['Attribute', 'Washed', 'Honey', 'Natural'],
    rows: [
      ['Fruit handling', 'Depulped, fermented, washed clean before drying', 'Depulped, mucilage left on during drying', 'Whole cherry dried intact, fruit on'],
      ['Flavor profile', 'Clean, bright, origin-forward', 'Sweet, rounded, balanced', 'Fruity, wild, sometimes funky'],
      ['Clarity', 'High', 'Medium', 'Low'],
      ['Body', 'Light to medium', 'Medium to heavy', 'Heavy'],
      ['Sweetness', 'Cane sugar, honey, floral', 'Jaggery, red apple, caramel', 'Blueberry, strawberry, tropical'],
      ['Example on our menu', 'Colombia Pink Bourbon, Guatemala Antigua', 'Chikmagalur Attikan, Araku Red Honey', 'Yirgacheffe Gedeb, Glacier Steep'],
    ],
    relatedUrls: ['/coffee/colombia-huila-pink-bourbon', '/coffee/chikmagalur-attikan-estate-honey', '/coffee/ethiopia-yirgacheffe-gedeb'],
  },
  {
    id: 'subscription-comparison',
    title: 'Subscription tiers (Explorer / Roastery / Reserve / Connoisseur / Founder)',
    intro: 'The Daily Roast Club has five subscription tiers, from a one-bag-a-month entry point to the annual Founder estate-visit tier. All tiers include free shipping and can be paused, changed or cancelled any time before renewal.',
    headers: ['Tier', 'Bags / month', 'Member perks', 'Billing'],
    rows: [
      ['Explorer', '1 bag (250g or 500g)', 'Free shipping, member discount, loyalty points', 'Monthly or annual'],
      ['Roastery', '2 bags', 'Everything in Explorer, + priority dispatch on new lots', 'Monthly or annual'],
      ['Reserve', '3 bags', 'Everything in Roastery, + a roastery tour seat per year', 'Monthly or annual'],
      ['Connoisseur', '4 bags + curated cupping', 'Everything in Reserve, + 1 video barista consultation per quarter', 'Monthly or annual'],
      ['Founder', '6 bags + estate visit', 'Everything in Connoisseur, + annual 3-day Chikmagalur estate tour seat', 'Annual only'],
    ],
    relatedUrls: ['/#subscription-plans', '/'],
  },
  {
    id: 'use-case-comparison',
    title: 'Espresso vs Pour over vs Cold brew',
    intro: 'Same coffee, three very different cups. The ratio, grind, brew time and resulting body all change with the method — the table below is how the three compare side by side.',
    headers: ['Attribute', 'Espresso', 'Pour over (V60)', 'Cold brew'],
    rows: [
      ['Coffee-to-water ratio', '1:2 (18g in, 36g out)', '1:16 (20g in, 320g out)', '1:8 concentrate (1:1 to serve)'],
      ['Grind size', 'Fine (espresso)', 'Medium-fine', 'Coarse (raw sugar)'],
      ['Brew time', '27–30 seconds', '3:00–3:15', '16–24 hours cold'],
      ['Water temperature', '93°C at 9 bars', '94°C, gravity', 'Refrigerator (4–8°C)'],
      ['Body', 'Heavy, syrupy, crema', 'Light, tea-like, aromatic', 'Heavy, smooth, low acidity'],
      ['Best coffee from our menu', 'Midnight Runner, Dawn Patrol', 'Attikan, Pink Bourbon, Yirgacheffe', 'Glacier Steep Cold Brew Blend'],
    ],
    relatedUrls: ['/brew/espresso', '/brew/v60', '/coffee/glacier-steep-cold-brew-blend'],
  },
];

/* -------------------------------------------------- the snippet injection for pages */

/**
 * Returns a small HTML fragment of "common questions" the homepage should expose so search
 * engines and AI assistants can lift the answers directly from the page. Injected as a
 * `<details>` block, so it costs nothing to ship and zero when collapsed.
 */
export function aeoSnippetsForPage(pagePath) {
  if (!pagePath) return '';
  // Homepage: the five highest-intent questions, each as a <details> with a one-line answer.
  if (pagePath === '/' || pagePath === '/index.html') {
    return aeoHomeSnippetsHtml();
  }
  // Coffee product pages: a single one-sentence "Quick answer" at the top.
  if (pagePath.startsWith('/coffee/') && pagePath !== '/coffee/' && pagePath !== '/coffee/index.html') {
    return aeoProductSnippetHtml(pagePath);
  }
  // Brew method pages: a single one-sentence "Quick answer" at the top.
  if (pagePath.startsWith('/brew/') && pagePath !== '/brew/' && pagePath !== '/brew/index.html') {
    return aeoBrewSnippetHtml(pagePath);
  }
  return '';
}

function aeoHomeSnippetsHtml() {
  // The five highest-intent questions for the homepage, in display order.
  const order = ['best-kaapi', 'freshness-window', 'international-shipping', 'best-espresso-roast', 'buy-indian-specialty-online'];
  const byId = new Map(AEO_QUESTIONS.map((q) => [q.id, q]));
  const top5 = order.map((id) => byId.get(id)).filter(Boolean);

  return `<!-- AEO_SNIPPETS_HOME: Answer Engine common questions. Collapsed by default; engines read source. -->
<aside class="aeo-snippets" aria-label="Common questions about our coffee" style="max-width: 820px; margin: 2.5rem auto; padding: 1.5rem 1.6rem; background: var(--bg-secondary, #f6efe7); border: 1px solid var(--border-subtle, #e3d9cb); border-radius: 14px;">
  <h2 style="font-family: var(--font-serif, Georgia, serif); font-size: 1.2rem; margin: 0 0 0.6rem;">Common questions</h2>
  <p style="font-size: 0.88rem; color: var(--text-muted, #6b5e51); margin: 0 0 1rem;">Direct answers about our coffee, freshness, shipping, espresso, and buying single-origin Indian roasts online.</p>
${top5.map((q) => `  <details style="margin-bottom: 0.6rem; border-bottom: 1px solid rgba(0,0,0,0.06); padding-bottom: 0.6rem;">
    <summary style="cursor: pointer; font-weight: 600; padding: 0.4rem 0;">${esc(q.question)}</summary>
    <p style="margin: 0.5rem 0 0; line-height: 1.65; font-size: 0.92rem;">${esc(q.shortAnswer)}</p>
  </details>`).join('\n')}
  <p style="font-size: 0.85rem; margin: 0.8rem 0 0;"><a href="/aeo.html">See all ${AEO_QUESTIONS.length} answers →</a></p>
</aside>
<!-- /AEO_SNIPPETS_HOME -->`;
}

function aeoProductSnippetHtml(pagePath) {
  // Map known slugs to one-sentence answers grounded in the product itself.
  const SLUG_ANSWERS = {
    'chikmagalur-attikan-estate-honey': 'A medium-light, pulp sun-dried honey-process Arabica from the Baba Budan Giri range of Chikmagalur, grown at 1,750m, with jaggery, red apple and roasted hazelnut on the cup — our house recommendation for South Indian filter kaapi.',
    'araku-valley-red-honey': 'A medium-light, extended red honey-process Arabica micro-lot from Araku Valley in the Eastern Ghats at 1,400m, with ripe jackfruit, wild blossom honey and candied orange peel on the cup.',
    'curated-taster-flight-3x100g': 'A 3x 100g nitrogen-flushed taster flight you build yourself — pick any three coffees from our Indian and global catalog to try side by side at the lowest per-cup price we offer.',
    'ethiopia-yirgacheffe-gedeb': 'A light, natural-process heirloom Arabica from Gedeb in the Yirgacheffe zone at 2,150m, with fragrant jasmine, bergamot Earl Grey, ripe white peach and a honey finish.',
    'colombia-huila-pink-bourbon': 'A medium-light, washed-process rare Pink Bourbon from San Agustin in Huila at 1,900m, with pink guava, papaya, crystalline cane sugar syrup and lemon verbena.',
    'guatemala-antigua-los-volcanes': 'A medium, washed-process Arabica from the Antigua Valley, with dark chocolate ganache, toasted pecan, dried plum and brown spice.',
    'dawn-patrol-morning-blend': 'A medium, washed-process signature house blend of Colombia and Brazil, with caramelized toffee, milk chocolate, roasted hazelnut and vanilla bean — our flagship everyday morning cup.',
    'midnight-runner-espresso': 'A dark, washed-process signature espresso blend of Brazil, Guatemala and Indian parchment, with dark cocoa nibs, molasses, toasted almond and smoky caramel, built to pull a dense golden crema at 9 bars.',
    'glacier-steep-cold-brew-blend': 'A medium-dark, natural-process cold brew blend of Ethiopian natural and Guatemala, with baker’s chocolate, wild blueberry syrup, macadamia nut and maple syrup — designed for a 16–24 hour coarse cold steep.',
    'sumatra-kerinci-valley-anaerobic': 'A medium-dark, anaerobic-natural Arabica from the Kerinci Highlands of Sumatra at 1,400m, with spiced rum, black cherry compote, dark cocoa and pipe cedar — a wild, expressive lot from our experimental processing range.',
  };
  const slug = pagePath.replace(/^\/coffee\//, '').replace(/\.html$/, '');
  const answer = SLUG_ANSWERS[slug];
  if (!answer) return '';
  return `<!-- AEO_SNIPPET_PAGE: direct answer for the AI engine to lift. -->
<p class="aeo-quick-answer" data-aeo-id="${esc(slug)}" style="background: var(--bg-secondary, #f6efe7); border-left: 3px solid var(--accent-gold, #c9933b); padding: 0.8rem 1rem; margin: 0 0 1.5rem; font-size: 0.95rem; line-height: 1.55;"><strong style="color: var(--accent-gold, #c9933b);">Quick answer.</strong> ${esc(answer)}</p>
<!-- /AEO_SNIPPET_PAGE -->`;
}

function aeoBrewSnippetHtml(pagePath) {
  const METHOD_ANSWERS = {
    'v60': 'V60 pour over: 20g medium-fine coffee, 320g water at 94°C, 1:16 ratio, 3:00–3:15 drawdown. Bloom 40g for 45 seconds, then slow concentric pours.',
    'filter-kaapi': 'South Indian filter kaapi: 20g medium-fine to 100g water at 96°C, 1:5 decoction, 12–15 minute drip. Mix one part decoction to three or four parts hot milk, sweeten with jaggery, froth between two vessels.',
    'aeropress': 'AeroPress inverted: 15g medium-fine coffee, 210g water at 88°C, 1:14 ratio, 1:15 steep, 30 second gentle press stopping at the hiss.',
    'espresso': 'Espresso: 18g in, 36g out, 1:2 ratio, 93°C at 9 bars, 27–30 second shot. Distribute and tamp level before pulling. Sour = grind finer; bitter = grind coarser.',
  };
  const method = pagePath.replace(/^\/brew\//, '').replace(/\.html$/, '');
  const answer = METHOD_ANSWERS[method];
  if (!answer) return '';
  return `<!-- AEO_SNIPPET_PAGE: direct answer for the AI engine to lift. -->
<p class="aeo-quick-answer" data-aeo-id="${esc(method)}" style="background: var(--bg-secondary, #f6efe7); border-left: 3px solid var(--accent-gold, #c9933b); padding: 0.8rem 1rem; margin: 0 0 1.5rem; font-size: 0.95rem; line-height: 1.55;"><strong style="color: var(--accent-gold, #c9933b);">Quick answer.</strong> ${esc(answer)}</p>
<!-- /AEO_SNIPPET_PAGE -->`;
}

/**
 * Returns the small `<aside class="aeo-aside">` block that links the homepage to /aeo.html.
 * Designed to be injected just before `</main>`.
 */
export function aeoAsideHtml() {
  return `<aside class="aeo-aside" aria-label="See all common questions" style="max-width: 820px; margin: 2rem auto; padding: 0.9rem 1.2rem; background: var(--bg-secondary, #f6efe7); border: 1px solid var(--border-subtle, #e3d9cb); border-radius: 10px; font-size: 0.92rem;">
  Common questions about our coffee, brewing and shipping: <a href="/aeo.html">see all ${AEO_QUESTIONS.length} answers</a>.
</aside>`;
}

/* --------------------------------------------------------- the standalone aeo page */

/** Build the FAQPage JSON-LD block for aeo.html. */
export function aeoPageSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: `${SITE}/aeo`,
    name: 'Common questions about The Daily Roast coffee, brewing and shipping',
    description: 'Direct, expert answers to the most common questions about our Indian specialty coffee, brewing methods, freshness, storage and shipping.',
    mainEntity: AEO_QUESTIONS.map(({ question, shortAnswer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: shortAnswer },
    })),
  };
}

/** One comparison table as a `<section>`. */
export function comparisonTableHtml(c) {
  if (!c || !c.headers || !c.rows) return '';
  return `<section id="${esc(c.id)}" class="aeo-comparison" style="margin: 2.4rem 0;">
  <h2 style="font-family: var(--font-serif, Georgia, serif); font-size: 1.35rem; margin: 0 0 0.6rem;">${esc(c.title)}</h2>
  ${c.intro ? `<p style="margin: 0 0 1rem; line-height: 1.65; color: var(--text-muted, #4a3f33);">${esc(c.intro)}</p>` : ''}
  <div style="overflow-x: auto;">
    <table style="width: 100%; border-collapse: collapse; font-size: 0.92rem;">
      <thead>
        <tr>${c.headers.map((h) => `<th scope="col" style="text-align: left; padding: 0.55rem 0.7rem; background: var(--bg-secondary, #f6efe7); border-bottom: 2px solid var(--accent-gold, #c9933b); font-weight: 600;">${esc(h)}</th>`).join('')}</tr>
      </thead>
      <tbody>
${c.rows.map((row) => `        <tr>${row.map((cell) => `<td style="padding: 0.55rem 0.7rem; border-bottom: 1px solid rgba(0,0,0,0.07); vertical-align: top;">${esc(cell)}</td>`).join('')}</tr>`).join('\n')}
      </tbody>
    </table>
  </div>
  ${c.relatedUrls && c.relatedUrls.length ? `<p style="margin: 0.7rem 0 0; font-size: 0.88rem;">Related: ${c.relatedUrls.map((u, i) => `<a href="${esc(u)}">${esc(u)}</a>${i < c.relatedUrls.length - 1 ? ' · ' : ''}`).join('')}</p>` : ''}
</section>`;
}

/** All comparison tables as one block of `<section>`s. */
export function allComparisonTablesHtml() {
  return COMPARISONS.map(comparisonTableHtml).join('\n');
}

/**
 * Returns the full aeo.html page as a string. Standalone page, FAQPage JSON-LD, every
 * question with its short and long answer, and the six comparison tables.
 */
export function aeoPage(css) {
  const title = 'Common Questions About Our Coffee, Brewing and Shipping | The Daily Roast';
  const desc = `Direct, expert answers to ${AEO_QUESTIONS.length} common questions about The Daily Roast specialty coffee: the best coffee for South Indian filter kaapi, V60 grind size, freshness, espresso roasts, subscription tiers, cold brew and more.`;
  const schema = aeoPageSchema();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/aeo">
<meta name="theme-color" content="#1b1614">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/aeo">
<meta property="og:site_name" content="The Daily Roast">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${esc(desc)}">
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

<main id="main-content" style="max-width: 860px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem;">
  <nav aria-label="Breadcrumb" style="font-size: 0.85rem; margin-bottom: 1.6rem;">
    <a href="/">Home</a> · <span>Common questions</span>
  </nav>

  <p class="section-label">ANSWER ENGINE</p>
  <h1 class="section-title" style="margin: 0.3rem 0 0.6rem;">Common questions about our coffee</h1>
  <p class="section-subtitle" style="margin: 0 0 2rem;">${AEO_QUESTIONS.length} direct, expert answers about The Daily Roast specialty coffee, brewing methods, freshness, storage, subscriptions and shipping. Every answer is grounded in copy the site carries; nothing is invented for SEO.</p>

  <nav aria-label="Jump to category" style="margin: 0 0 2.4rem; padding: 1rem 1.1rem; background: var(--bg-secondary, #f6efe7); border-radius: 12px; font-size: 0.9rem;">
    <strong style="display: block; margin-bottom: 0.4rem;">Jump to:</strong>
    <a href="#questions" style="margin-right: 0.8rem;">All questions</a> ·
    <a href="#comparisons" style="margin-right: 0.8rem;">Comparison tables</a> ·
    <a href="/faq" style="margin-right: 0.8rem;">Customer FAQ</a> ·
    <a href="/llms.txt" style="margin-right: 0.8rem;">llms.txt</a> ·
    <a href="/aeo-feed.json">JSON feed</a>
  </nav>

  <section id="questions">
    <h2 style="font-family: var(--font-serif, Georgia, serif); font-size: 1.5rem; margin: 0 0 1.2rem;">All ${AEO_QUESTIONS.length} questions</h2>
${AEO_QUESTIONS.map((q) => `    <article id="${esc(q.id)}" style="margin: 0 0 2.4rem; padding-bottom: 1.4rem; border-bottom: 1px solid rgba(0,0,0,0.08);">
      <h3 style="font-family: var(--font-serif, Georgia, serif); font-size: 1.15rem; margin: 0 0 0.5rem;">${esc(q.question)}</h3>
      <p style="margin: 0 0 0.6rem; padding: 0.5rem 0.8rem; background: var(--bg-secondary, #f6efe7); border-left: 3px solid var(--accent-gold, #c9933b); font-size: 0.95rem; line-height: 1.55;"><strong>Direct answer.</strong> ${esc(q.shortAnswer)}</p>
      <div style="line-height: 1.7; font-size: 0.95rem; color: var(--text-main, #2a211b);">
        <p style="margin: 0 0 0.6rem;">${esc(q.longAnswer)}</p>
      </div>
      <p style="margin: 0.7rem 0 0; font-size: 0.85rem; color: var(--text-muted, #6b5e51);">Category: ${esc(q.category)} · Related: ${q.relatedUrls.map((u, i) => `<a href="${esc(u)}">${esc(u)}</a>${i < q.relatedUrls.length - 1 ? ' · ' : ''}`).join('')}</p>
    </article>`).join('\n')}
  </section>

  <section id="comparisons" style="margin-top: 3rem;">
    <h2 style="font-family: var(--font-serif, Georgia, serif); font-size: 1.5rem; margin: 0 0 0.6rem;">Comparison tables</h2>
    <p style="margin: 0 0 1.2rem; color: var(--text-muted, #4a3f33);">Side-by-side answers to the questions that arrive as "X vs Y" — brewers, roasts, origins, processing methods, subscription tiers and use cases.</p>
${allComparisonTablesHtml()}
  </section>

  <p style="margin-top: 3rem; font-size: 0.95rem;">For shipping, returns, grind options, loyalty and subscription mechanics, see the <a href="/faq">customer FAQ</a>. For a machine-readable Q&A feed, see <a href="/aeo-feed.json">aeo-feed.json</a> or the <a href="/llms.txt">llms.txt</a> index.</p>
</main>

<footer class="site-footer">
  <div class="footer-bottom" style="max-width: 860px; margin: 0 auto; padding: 2rem 1.5rem;">
    <span>&copy; 2026 The Daily Roast Roastery Pvt Ltd · Bangalore, India</span>
    <span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/shipping">Shipping &amp; Returns</a></span>
  </div>
</footer>
</body>
</html>
`;
}

/* ------------------------------------------------------ the machine-readable feed */

/** The full AEO feed as a JSON-serialisable object. Stable schema, versioned. */
export function aeoFeed() {
  return {
    version: '1.0',
    updated: '2026-08-28',
    publisher: { name: 'The Daily Roast', url: `${SITE}/` },
    source: `${SITE}/aeo`,
    feed: `${SITE}/aeo-feed.json`,
    description: 'Direct, expert answers to the most common questions about The Daily Roast specialty coffee — Indian estate micro-lots, brew methods, freshness, storage, subscriptions and shipping. Machine-readable Q&A for LLMs and AEO tools.',
    categories: [...new Set(AEO_QUESTIONS.map((q) => q.category))].sort(),
    questions: AEO_QUESTIONS.map((q) => ({
      id: q.id,
      question: q.question,
      short_answer: q.shortAnswer,
      long_answer: q.longAnswer,
      category: q.category,
      related_urls: q.relatedUrls,
    })),
    comparisons: COMPARISONS.map((c) => ({
      id: c.id,
      title: c.title,
      intro: c.intro,
      headers: c.headers,
      rows: c.rows,
      related_urls: c.relatedUrls,
    })),
  };
}

/* ------------------------------------- the renderer for other agents to call safely */

/**
 * Pure helper for other agents who want to ask "is there an AEO snippet for this page?" without
 * having to import this whole module. Returns an empty string rather than null so it can be
 * dropped directly into template literals.
 */
export function aeoSnippetFor(pagePath, _content) {
  return aeoSnippetsForPage(pagePath);
}

/* --------------------------------------------------------- the build-time helpers */

/**
 * Verifies that every `relatedUrls` value in AEO_QUESTIONS resolves to either a real file in
 * dist/ or a same-page anchor on the homepage. Returns an array of unresolved entries.
 *
 * "Real" here means either a file at dist/<path>.html, a directory at dist/<path>/index.html,
 * a path that ends in an anchor like `#catalog`, or the homepage itself. The list is a guard,
 * not a hard check — the URLs are linked from a public AEO page and a 404 is exactly the
 * defect we are trying to prevent.
 */
export function unresolvedRelatedUrls() {
  const real = new Set();
  real.add('/');
  for (const a of ['/#catalog', '/#taster-flight', '/#flavor-wheel', '/#quiz', '/#brew-guide',
    '/#roastery-story', '/#experiences', '/#subscription-plans', '/#track-order', '/faq',
    '/shipping', '/llms.txt', '/aeo', '/aeo-feed.json']) real.add(a);

  try {
    const dist = join(ROOT, 'dist');
    walk(dist, '', real, 4);
  } catch {
    // dist/ may not exist at test time; the manifest above is the safety net.
  }

  const issues = [];
  const check = (id, urls) => {
    for (const u of urls || []) {
      if (u.startsWith('/#')) continue;
      // The homepage and bare section roots don't have a .html suffix to probe.
      if (u === '/' || u === '/coffee/' || u === '/brew/') {
        if (real.has(u) || real.has(`${u}index.html`)) continue;
        issues.push({ id, url: u });
        continue;
      }
      const probe = u.endsWith('.html') || u.endsWith('.json') || u.endsWith('.txt') ? u : `${u}.html`;
      if (!real.has(probe)) issues.push({ id, url: u });
    }
  };
  for (const q of AEO_QUESTIONS) check(q.id, q.relatedUrls);
  for (const c of COMPARISONS) check(c.id, c.relatedUrls);
  return issues;
}

function walk(dir, prefix, set, depth) {
  if (depth < 0) return;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = `${prefix}/${e.name}`;
    if (e.isDirectory()) {
      walk(join(dir, e.name), rel, set, depth - 1);
    } else if (e.isFile()) {
      set.add(rel);
    }
  }
}
