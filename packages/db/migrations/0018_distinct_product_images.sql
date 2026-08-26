-- 0018: stop three pairs of coffees sharing one photograph.
--
-- Seven photos covered ten products, so /coffee/guatemala-antigua-los-volcanes and
-- /coffee/curated-taster-flight-3x100g led with the identical image, as did Colombia/Araku and
-- Ethiopia/Chikmagalur. On the storefront grid that reads as a mistake; on the generated product
-- pages and their social cards it is worse, because two different coffees shared one og:image.
--
-- The Indian estate coffees keep the photograph they had. The second of each pair gets its own,
-- chosen to suit the coffee: a burlap origin sack for the Guatemalan estate lot, a close roast
-- texture for the Colombian, and a pour-over for the floral washed Ethiopian.
--
-- These are stock photographs standing in until real product shots exist. They are not pictures
-- of these specific lots, and nothing in the copy claims they are.

UPDATE products
SET image_url = 'https://images.unsplash.com/photo-1524350876685-274059332603?auto=format&fit=crop&w=800&q=80'
WHERE slug = 'guatemala-antigua-los-volcanes';

UPDATE products
SET image_url = 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=800&q=80'
WHERE slug = 'colombia-huila-pink-bourbon';

UPDATE products
SET image_url = 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=800&q=80'
WHERE slug = 'ethiopia-yirgacheffe-gedeb';
