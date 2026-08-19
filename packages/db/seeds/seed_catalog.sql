-- The Daily Roast: Catalog Seeds

-- Categories
INSERT OR IGNORE INTO categories (id, slug, name, description, display_order) VALUES
('cat_so', 'single-origin', 'Single Origin', 'Exceptional single-estate coffees sourced from distinct microclimates around the globe.', 1),
('cat_bl', 'signature-blends', 'Signature Blends', 'Masterfully balanced blends crafted for rich complexity, morning rituals, and milk drinks.', 2),
('cat_es', 'espresso-roasts', 'Espresso Roasts', 'Dense, aromatic profiles optimized for intense crema and balanced extraction.', 3),
('cat_cb', 'cold-brew', 'Cold Brew & Steep', 'Heavy-bodied roasts highlighting cocoa, brown sugar, and stone fruit when slow-extracted.', 4),
('cat_ie', 'indian-estates', 'Indian Micro-Lots', 'Exceptional shade-grown coffees from Chikmagalur, Coorg, and Araku Valley.', 5);

-- Products
INSERT OR IGNORE INTO products (
    id, slug, name, tagline, description, category_id,
    origin_country, region, farm_or_coop, altitude_meters, variety,
    process_method, roast_level, tasting_notes,
    acidity_score, body_score, sweetness_score,
    image_url, is_featured, is_active
) VALUES
(
    'prod_chik_attikan',
    'chikmagalur-attikan-estate-honey',
    'Chikmagalur Attikan Estate Honey',
    'Sweet sugarcane jaggery, red apple & roasted hazelnut.',
    'Shade-grown at 1,750m in the Baba Budan Giri range of Chikmagalur, Karnataka. Pulp sun-dried honey process producing a silky, medium body with balanced citric brightness and rich jaggery sweetness.',
    'cat_ie',
    'India', 'Chikmagalur, Karnataka', 'Attikan Estate', 1750, 'S.795 & SLN 9',
    'HONEY', 'MEDIUM_LIGHT',
    '["Jaggery", "Red Apple", "Hazelnut", "Caramel"]',
    4, 4, 5,
    'https://images.unsplash.com/photo-1587734195503-904fca47e0e9?auto=format&fit=crop&w=800&q=80',
    1, 1
),
(
    'prod_araku_honey',
    'araku-valley-red-honey',
    'Araku Valley Red Honey Micro-Lot',
    'Ripe jackfruit, wild blossom honey & candied orange peel.',
    'Cultivated by indigenous tribal farmers in the Eastern Ghats of Andhra Pradesh. High-elevation shade canopy and extended honey mucilage drying creates immense fruit complexity and buttery body.',
    'cat_ie',
    'India', 'Araku Valley, Andhra Pradesh', 'Smallholder Tribal Collective', 1400, 'Selection 5B',
    'HONEY', 'MEDIUM_LIGHT',
    '["Jackfruit", "Wild Honey", "Orange Peel", "Floral"]',
    4, 4, 5,
    'https://images.unsplash.com/photo-1611854779393-1b2da9d400fe?auto=format&fit=crop&w=800&q=80',
    1, 1
),
(
    'prod_taster_flight',
    'curated-taster-flight-3x100g',
    'Curated 3x 100g Roastery Taster Flight',
    'Pick 3 distinct 100g micro-lots from our Indian and global roastery.',
    'Explore three rare micro-lot profiles in custom nitrogen-flushed 100g sample pouches. Choose your favorite trio from Chikmagalur Attikan, Araku Valley Red Honey, Ethiopia Yirgacheffe, Dawn Patrol, and more.',
    'cat_so',
    'India & Global', 'Bangalore Roastery Selection', 'Multi-Estate Micro-Lots', 1800, 'Curated Trio',
    'WASHED', 'MEDIUM',
    '["Discovery Flight", "3x 100g Pouches", "Custom Trio", "Freshly Roasted"]',
    4, 4, 5,
    'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=800&q=80',
    1, 1
),
(
    'prod_eth_yirg',
    'ethiopia-yirgacheffe-gedeb',
    'Ethiopia Yirgacheffe Gedeb',
    'Ethereal floral jasmine, bergamot tea, and ripe peach finish.',
    'Harvested by smallholders in the high-altitude Gedeb micro-region of Yirgacheffe. Dried carefully on raised African beds for 21 days. This natural process brings vibrant citrus brightness, honeysuckle sweetness, and an intoxicating peach fragrance.',
    'cat_so',
    'Ethiopia', 'Gedeb, Yirgacheffe', 'Gedeb Smallholder Washing Station', 2150, 'Heirloom / Kurume',
    'NATURAL', 'LIGHT',
    '["Jasmine", "Bergamot", "Ripe White Peach", "Honey Florals"]',
    5, 2, 4,
    'https://images.unsplash.com/photo-1587734195503-904fca47e0e9?auto=format&fit=crop&w=800&q=80',
    1, 1
),
(
    'prod_col_geisha',
    'colombia-huila-pink-bourbon',
    'Colombia Huila Pink Bourbon',
    'Papaya, pink guava, cane sugar syrup, and crisp malic brightness.',
    'Grown by the master producers of San Agustin in Huila on volcanic soil. The rare Pink Bourbon mutation yields a unique cup profile that bridges silky stone fruit notes with crystalline sweetness and sparkling acidity.',
    'cat_so',
    'Colombia', 'San Agustin, Huila', 'Finca El Paraiso', 1900, 'Pink Bourbon',
    'WASHED', 'MEDIUM_LIGHT',
    '["Pink Guava", "Papaya", "Sugar Cane", "Lemon Verbena"]',
    4, 3, 5,
    'https://images.unsplash.com/photo-1611854779393-1b2da9d400fe?auto=format&fit=crop&w=800&q=80',
    1, 1
),
(
    'prod_gua_antigua',
    'guatemala-antigua-los-volcanes',
    'Guatemala Antigua Los Volcanes',
    'Dark chocolate ganache, toasted pecan, and dried plum sweetness.',
    'Nestled between three majestic volcanoes in the Antigua valley. Volcanic pumice soil and sun-drenched days with crisp nights slow cherry maturation, delivering a deep, structured cup with rich chocolate and velvety mouthfeel.',
    'cat_so',
    'Guatemala', 'Antigua Valley', 'Finca Medina & La Folie', 1650, 'Bourbon, Caturra',
    'WASHED', 'MEDIUM',
    '["Dark Chocolate", "Toasted Pecan", "Dried Plum", "Brown Spice"]',
    2, 4, 4,
    'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=800&q=80',
    1, 1
),
(
    'prod_sum_kerinci',
    'sumatra-kerinci-valley-anaerobic',
    'Sumatra Kerinci Anaerobic Natural',
    'Spiced rum, black cherry compote, dark cacao, and forest cedar.',
    'A pioneering lot from the Kerinci Highlands of Sumatra. Fermented in sealed anaerobic tanks before sun-drying on covered patios. Eliminates traditional earthy defects, replacing them with syrupy dark fruit, spiced pipe tobacco, and cocoa liquor.',
    'cat_so',
    'Indonesia', 'Kerinci Highlands, Sumatra', 'ALKO Koerintji Cooperative', 1600, 'Andung Sari, Sigarar Utang',
    'ANAEROBIC', 'MEDIUM_DARK',
    '["Spiced Rum", "Black Cherry", "Dark Cocoa", "Pipe Cedar"]',
    2, 5, 4,
    'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80',
    0, 1
),
(
    'prod_blend_dawn',
    'dawn-patrol-morning-blend',
    'Dawn Patrol Signature Blend',
    'Caramelized toffee, milk chocolate, and roasted hazelnut.',
    'Our flagship daily drinker. A harmonious blend of washed Colombian Excelso and natural Brazilian Cerrado. Crafted to brew effortlessly in drip machines, French press, or pour-over, pairing flawlessly with milk or enjoyed black.',
    'cat_bl',
    'Blend', 'Colombia & Brazil', 'Regional Co-ops', 1450, 'Bourbon, Catuai, Typica',
    'WASHED', 'MEDIUM',
    '["Caramel Toffee", "Milk Chocolate", "Roasted Hazelnut", "Vanilla Bean"]',
    2, 4, 4,
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=800&q=80',
    1, 1
),
(
    'prod_esp_midnight',
    'midnight-runner-espresso',
    'Midnight Runner Dark Roast Espresso',
    'Dark cocoa nibs, molasses, toasted almond, and heavy crema.',
    'For those who demand robust body, zero sharpness, and a thick, creamy head of golden crema. Roasted slightly darker into the second crack to caramelize natural sugars without imparting bitter carbon astringency.',
    'cat_es',
    'Blend', 'Brazil, Guatemala & India Parchment', 'Select Estate Lots', 1300, 'Mixed Heirloom & Robusta AA',
    'WASHED', 'DARK',
    '["Cocoa Nibs", "Dark Molasses", "Toasted Almond", "Smoky Caramel"]',
    1, 5, 3,
    'https://images.unsplash.com/photo-1511920170033-f8396924c348?auto=format&fit=crop&w=800&q=80',
    0, 1
),
(
    'prod_cb_nitro',
    'glacier-steep-cold-brew-blend',
    'Glacier Steep Cold Brew Blend',
    'Smooth baker’s chocolate, blueberry syrup, and creamy macadamia.',
    'Specifically roasted and coarse-blended to maximize low-temperature extraction over 16-24 hours. Naturally sweet and heavy-bodied, with completely muted bitterness and a refreshing fruity undertone.',
    'cat_cb',
    'Blend', 'Ethiopia Natural & Guatemala', 'Highland Farmers', 1700, 'Caturra & Heirloom',
    'NATURAL', 'MEDIUM_DARK',
    '["Baker’s Chocolate", "Wild Blueberry", "Macadamia Nut", "Maple Syrup"]',
    1, 5, 4,
    'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=800&q=80',
    1, 1
);

-- Product Variants
INSERT OR IGNORE INTO product_variants (id, product_id, sku, weight_grams, price_cents, grind_options, is_active) VALUES
-- Chikmagalur Attikan Estate
('var_att_250', 'prod_chik_attikan', 'TDG-ATT-250G', 250, 1850, '["WHOLE_BEAN", "POUR_OVER", "SOUTH_INDIAN_FILTER", "AEROPRESS", "ESPRESSO"]', 1),
('var_att_500', 'prod_chik_attikan', 'TDG-ATT-500G', 500, 3400, '["WHOLE_BEAN", "POUR_OVER", "SOUTH_INDIAN_FILTER", "AEROPRESS", "ESPRESSO"]', 1),
('var_att_1000', 'prod_chik_attikan', 'TDG-ATT-1KG', 1000, 6200, '["WHOLE_BEAN", "POUR_OVER", "SOUTH_INDIAN_FILTER", "AEROPRESS", "ESPRESSO"]', 1),

-- Araku Valley Red Honey
('var_ara_250', 'prod_araku_honey', 'TDG-ARA-250G', 250, 1950, '["WHOLE_BEAN", "POUR_OVER", "AEROPRESS", "ESPRESSO"]', 1),
('var_ara_500', 'prod_araku_honey', 'TDG-ARA-500G', 500, 3600, '["WHOLE_BEAN", "POUR_OVER", "AEROPRESS", "ESPRESSO"]', 1),

-- Curated 3x 100g Roastery Taster Flight
('var_flight_300', 'prod_taster_flight', 'TDG-FLIGHT-300G', 300, 2400, '["WHOLE_BEAN", "POUR_OVER", "SOUTH_INDIAN_FILTER", "ESPRESSO", "AEROPRESS", "FRENCH_PRESS", "COLD_BREW"]', 1),

-- Ethiopia Yirgacheffe
('var_eth_250', 'prod_eth_yirg', 'TDG-ETH-YIRG-250G', 250, 1950, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO", "AEROPRESS", "DRIP", "FRENCH_PRESS"]', 1),
('var_eth_500', 'prod_eth_yirg', 'TDG-ETH-YIRG-500G', 500, 3600, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO", "AEROPRESS", "DRIP", "FRENCH_PRESS"]', 1),
('var_eth_1000', 'prod_eth_yirg', 'TDG-ETH-YIRG-1KG', 1000, 6400, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO", "AEROPRESS", "DRIP", "FRENCH_PRESS"]', 1),

-- Colombia Huila Pink Bourbon
('var_col_250', 'prod_col_geisha', 'TDG-COL-PB-250G', 250, 2200, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO", "AEROPRESS", "DRIP"]', 1),
('var_col_500', 'prod_col_geisha', 'TDG-COL-PB-500G', 500, 4000, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO", "AEROPRESS", "DRIP"]', 1),

-- Guatemala Antigua
('var_gua_250', 'prod_gua_antigua', 'TDG-GUA-ANT-250G', 250, 1750, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO", "DRIP", "FRENCH_PRESS", "COLD_BREW"]', 1),
('var_gua_500', 'prod_gua_antigua', 'TDG-GUA-ANT-500G', 500, 3200, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO", "DRIP", "FRENCH_PRESS", "COLD_BREW"]', 1),

-- Sumatra Kerinci
('var_sum_250', 'prod_sum_kerinci', 'TDG-SUM-KER-250G', 250, 1850, '["WHOLE_BEAN", "POUR_OVER", "FRENCH_PRESS", "DRIP", "COLD_BREW"]', 1),
('var_sum_500', 'prod_sum_kerinci', 'TDG-SUM-KER-500G', 500, 3400, '["WHOLE_BEAN", "POUR_OVER", "FRENCH_PRESS", "DRIP", "COLD_BREW"]', 1),

-- Dawn Patrol Blend
('var_dawn_250', 'prod_blend_dawn', 'TDG-BLD-DWN-250G', 250, 1600, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO", "DRIP", "FRENCH_PRESS", "AEROPRESS"]', 1),
('var_dawn_500', 'prod_blend_dawn', 'TDG-BLD-DWN-500G', 500, 2900, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO", "DRIP", "FRENCH_PRESS", "AEROPRESS"]', 1),
('var_dawn_1000', 'prod_blend_dawn', 'TDG-BLD-DWN-1KG', 1000, 5200, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO", "DRIP", "FRENCH_PRESS", "AEROPRESS"]', 1),

-- Midnight Runner Espresso
('var_mid_250', 'prod_esp_midnight', 'TDG-ESP-MID-250G', 250, 1650, '["WHOLE_BEAN", "ESPRESSO", "MOKA_POT", "FRENCH_PRESS"]', 1),
('var_mid_500', 'prod_esp_midnight', 'TDG-ESP-MID-500G', 500, 3000, '["WHOLE_BEAN", "ESPRESSO", "MOKA_POT", "FRENCH_PRESS"]', 1),

-- Glacier Steep Cold Brew
('var_gla_500', 'prod_cb_nitro', 'TDG-CLD-GLA-500G', 500, 2800, '["WHOLE_BEAN", "COLD_BREW", "FRENCH_PRESS"]', 1),
('var_gla_1000', 'prod_cb_nitro', 'TDG-CLD-GLA-1KG', 1000, 4900, '["WHOLE_BEAN", "COLD_BREW", "FRENCH_PRESS"]', 1);

-- Inventory Initialization
INSERT OR IGNORE INTO inventory (variant_id, sku, available_stock, reserved_stock, low_stock_threshold) VALUES
('var_att_250', 'TDG-ATT-250G', 80, 0, 15),
('var_att_500', 'TDG-ATT-500G', 50, 0, 10),
('var_att_1000', 'TDG-ATT-1KG', 30, 0, 5),
('var_ara_250', 'TDG-ARA-250G', 60, 0, 12),
('var_ara_500', 'TDG-ARA-500G', 35, 0, 8),
('var_flight_300', 'TDG-FLIGHT-300G', 100, 0, 20),
('var_eth_250', 'TDG-ETH-YIRG-250G', 45, 0, 10),
('var_eth_500', 'TDG-ETH-YIRG-500G', 30, 0, 8),
('var_eth_1000', 'TDG-ETH-YIRG-1KG', 15, 0, 5),
('var_col_250', 'TDG-COL-PB-250G', 35, 0, 8),
('var_col_500', 'TDG-COL-PB-500G', 20, 0, 5),
('var_gua_250', 'TDG-GUA-ANT-250G', 60, 0, 15),
('var_gua_500', 'TDG-GUA-ANT-500G', 40, 0, 10),
('var_sum_250', 'TDG-SUM-KER-250G', 28, 0, 8),
('var_sum_500', 'TDG-SUM-KER-500G', 18, 0, 5),
('var_dawn_250', 'TDG-BLD-DWN-250G', 120, 0, 20),
('var_dawn_500', 'TDG-BLD-DWN-500G', 85, 0, 15),
('var_dawn_1000', 'TDG-BLD-DWN-1KG', 50, 0, 10),
('var_mid_250', 'TDG-ESP-MID-250G', 75, 0, 15),
('var_mid_500', 'TDG-ESP-MID-500G', 45, 0, 10),
('var_gla_500', 'TDG-CLD-GLA-500G', 55, 0, 12),
('var_gla_1000', 'TDG-CLD-GLA-1KG', 30, 0, 8);

-- Initial Inventory Movements Log
INSERT OR IGNORE INTO inventory_movements (id, variant_id, movement_type, quantity_delta, stock_after, reference_type, reason, created_by) VALUES
('inv_init_01', 'var_eth_250', 'INITIAL_STOCK', 45, 45, 'SUPPLIER', 'Initial roast batch launch', 'SYSTEM'),
('inv_init_02', 'var_col_250', 'INITIAL_STOCK', 35, 35, 'SUPPLIER', 'Initial roast batch launch', 'SYSTEM'),
('inv_init_03', 'var_dawn_250', 'INITIAL_STOCK', 120, 120, 'SUPPLIER', 'Initial roast batch launch', 'SYSTEM');

-- Coupons
INSERT OR IGNORE INTO coupons (id, code, discount_type, discount_value, minimum_order_cents, max_uses, times_used, is_active) VALUES
('coup_welcome10', 'WELCOME10', 'PERCENT', 10, 2500, 500, 12, 1),
('coup_freshroast', 'FRESHROAST', 'FIXED', 500, 3500, 200, 5, 1),
('coup_barista20', 'BARISTA20', 'PERCENT', 20, 5000, 100, 3, 1);

-- Marketing Hub: Communication Channels
INSERT OR IGNORE INTO communication_channels (id, name, channel_type, handle_or_address, status, notes) VALUES
('chan_ig', 'Instagram — @dailyroast.in', 'INSTAGRAM', '@dailyroast.in', 'ACTIVE', 'Primary visual channel for roast drops and brew content'),
('chan_email', 'Weekly Roast Notes newsletter', 'EMAIL', 'support@dailyroast.in', 'ACTIVE', 'Weekly email digest of new lots and brewing guides'),
('chan_whatsapp', 'WhatsApp Broadcast', 'WHATSAPP', '+91-80-4000-1234', 'PLANNED', 'Planned for limited-edition drop alerts to repeat customers');

-- Marketing Hub: Social Campaigns
INSERT OR IGNORE INTO social_campaigns (id, name, channel_id, objective, status, start_date, end_date, notes) VALUES
('camp_diwali', 'Diwali Gifting Push', 'chan_ig', 'Drive gift-box orders through the festive season', 'SCHEDULED', '2026-10-15', '2026-11-05', 'Reels featuring the Taster Flight as a gifting option'),
('camp_launch_araku', 'Araku Honey Relaunch', 'chan_email', 'Re-introduce Araku Valley Red Honey after a roast profile update', 'LIVE', '2026-08-01', '2026-08-31', NULL);

-- Marketing Hub: Limited Editions
INSERT OR IGNORE INTO limited_editions (id, name, description, product_name, product_id, sku, launch_date, end_date, total_units, units_sold, status) VALUES
('ltd_monsoon_reserve', 'Monsoon Malabar Reserve Cask', 'Small-batch cask-aged Monsoon Malabar, 120 bags only', 'Monsoon Malabar Reserve', NULL, 'TDG-MON-RESERVE-250G', '2026-07-01', '2026-09-01', 120, 87, 'LIVE'),
('ltd_holiday_flight', 'Holiday Estate Taster Flight', 'Limited holiday edition of the 3x100g taster flight with seasonal packaging', 'Curated Taster Flight (Holiday)', 'prod_taster_flight', 'TDG-FLIGHT-HOLIDAY-300G', '2026-12-01', '2026-12-31', 300, 0, 'UPCOMING');

-- Marketing Hub: Sales & Promotions
INSERT OR IGNORE INTO promotions (id, name, description, promo_type, start_date, end_date, linked_coupon_id, status) VALUES
('promo_launch_week', 'Bangalore Launch Week Sale', 'Storewide launch promotion for the Bangalore roastery opening', 'SEASONAL', '2026-08-01', '2026-08-15', 'coup_barista20', 'ACTIVE'),
('promo_clearance_q3', 'Q3 Green Stock Clearance', 'Clearance pricing on aging green stock ahead of new harvest arrivals', 'CLEARANCE', '2026-09-01', '2026-09-14', NULL, 'SCHEDULED');

-- Brewing Guides
INSERT OR IGNORE INTO brewing_guides (id, slug, name, grind_recommendation, ratio_description, water_temp_celsius, brew_time_seconds, steps_json, pro_tips_json) VALUES
(
    'guide_v60',
    'hario-v60-pour-over',
    'Hario V60 Single-Cup Pour Over',
    'POUR_OVER',
    '1:16 Ratio (15g coffee to 240g water)',
    94,
    210,
    '[
        {"step_number": 1, "instruction": "Rinse paper filter with boiling water to eliminate paper taste and preheat the glass server. Discard rinse water.", "duration_seconds": 30},
        {"step_number": 2, "instruction": "Add 15g medium-fine coffee. Create a small divot in the center bed.", "duration_seconds": 15},
        {"step_number": 3, "instruction": "Bloom: Pour 45g of 94°C water in gentle spirals. Gently swirl or excavate bed with spoon. Wait 45 seconds.", "duration_seconds": 45},
        {"step_number": 4, "instruction": "Second Pour: Pour steadily up to 150g in concentric circles, keeping flow rate constant.", "duration_seconds": 45},
        {"step_number": 5, "instruction": "Final Pour: Pour gently up to 240g total water. Give one gentle swirl. Allow bed to drain completely flat.", "duration_seconds": 75}
    ]',
    '["Use filtered water between 75-120 ppm total hardness.", "If drawdown finishes in under 2:30, grind finer. If over 4:00, grind coarser.", "Light roasts thrive at 94-96°C; darker roasts shine at 88-91°C."]'
),
(
    'guide_aeropress',
    'inverted-aeropress',
    'Inverted Aeropress Quick Extraction',
    'AEROPRESS',
    '1:14 Ratio (18g coffee to 250g water)',
    88,
    120,
    '[
        {"step_number": 1, "instruction": "Position the AeroPress upside down with the plunger at the number 4 mark.", "duration_seconds": 15},
        {"step_number": 2, "instruction": "Add 18g medium-fine coffee directly into chamber.", "duration_seconds": 15},
        {"step_number": 3, "instruction": "Pour 250g water at 88°C in 20 seconds. Stir vigorously 5 times.", "duration_seconds": 30},
        {"step_number": 4, "instruction": "Fasten cap with pre-rinsed paper filter. Let steep until timer reaches 1:15.", "duration_seconds": 30},
        {"step_number": 5, "instruction": "Flip onto decanter smoothly and press down with steady body weight for 30 seconds until soft hiss.", "duration_seconds": 30}
    ]',
    '["Stop pressing when you hear the air hiss to avoid astringent fine migration.", "Dilute with 30-50ml hot water if you prefer a cleaner Americano mouthfeel."]'
),
(
    'guide_french_press',
    'french-press-immersion',
    'Classic French Press Full Immersion',
    'FRENCH_PRESS',
    '1:15 Ratio (30g coffee to 450g water)',
    95,
    360,
    '[
        {"step_number": 1, "instruction": "Coarsely grind 30g fresh coffee beans (resembling kosher sea salt).", "duration_seconds": 30},
        {"step_number": 2, "instruction": "Add coffee to beaker, pour 450g near-boiling water (95°C) saturating all grounds.", "duration_seconds": 30},
        {"step_number": 3, "instruction": "Place lid on top to retain heat, but DO NOT press plunger yet. Let steep 4 minutes.", "duration_seconds": 240},
        {"step_number": 4, "instruction": "At 4:00, use two spoons to break the coffee crust and skim off floating foam and residual chaff.", "duration_seconds": 60},
        {"step_number": 5, "instruction": "Insert plunger just below surface level, let grounds settle for 2 minutes, then pour gently without plunging all the way down.", "duration_seconds": 60}
    ]',
    '["Skimming the surface foam removes bitter micro-fines and yields an ultra-clean, heavy-bodied cup.", "Never leave brewed coffee sitting on the grounds in the press."]'
);
