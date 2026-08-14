import type { Product, Category, ProductVariant, Inventory, InventoryMovement, Cart, CartItem, Order, OrderItem, BrewingGuide } from '@daily-grind/shared-types';

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]>;
  exec(query: string): Promise<D1ExecResultLike>;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1ResultLike<T>>;
  run<T = unknown>(): Promise<D1ResponseLike>;
}

export interface D1ResultLike<T = unknown> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export interface D1ResponseLike {
  success: boolean;
  meta: Record<string, unknown>;
}

export interface D1ExecResultLike {
  count: number;
  duration: number;
}

export class CoffeeDatabase {
  constructor(private db: D1DatabaseLike) {}

  async getAllCategories(): Promise<Category[]> {
    const { results } = await this.db.prepare(
      'SELECT id, slug, name, description, display_order FROM categories ORDER BY display_order ASC'
    ).all<Category>();
    return results || [];
  }

  async getAllProducts(categoryId?: string, roastLevel?: string): Promise<Product[]> {
    let query = `
      SELECT 
        p.*, 
        c.name as category_name
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
    `;
    const params: unknown[] = [];

    if (categoryId) {
      query += ' AND (p.category_id = ? OR c.slug = ?)';
      params.push(categoryId, categoryId);
    }
    if (roastLevel) {
      query += ' AND p.roast_level = ?';
      params.push(roastLevel);
    }

    query += ' ORDER BY p.is_featured DESC, p.created_at DESC';

    const { results: rawProducts } = await this.db.prepare(query).bind(...params).all<Record<string, unknown>>();

    if (!rawProducts || rawProducts.length === 0) {
      return [];
    }

    // Fetch variants for all returned products
    const productIds = rawProducts.map((p) => p.id as string);
    const placeholders = productIds.map(() => '?').join(',');
    const { results: rawVariants } = await this.db.prepare(`
      SELECT 
        v.*,
        COALESCE(i.available_stock, 0) as stock_quantity
      FROM product_variants v
      LEFT JOIN inventory i ON v.id = i.variant_id
      WHERE v.product_id IN (${placeholders}) AND v.is_active = 1
      ORDER BY v.weight_grams ASC
    `).bind(...productIds).all<Record<string, unknown>>();

    const variantsByProductId: Record<string, ProductVariant[]> = {};
    for (const v of rawVariants) {
      const pid = v.product_id as string;
      if (!variantsByProductId[pid]) variantsByProductId[pid] = [];
      variantsByProductId[pid].push({
        id: v.id as string,
        product_id: pid,
        sku: v.sku as string,
        weight_grams: Number(v.weight_grams),
        price_cents: Number(v.price_cents),
        grind_options: typeof v.grind_options === 'string' ? JSON.parse(v.grind_options) : v.grind_options,
        is_active: Boolean(v.is_active),
        stock_quantity: Number(v.stock_quantity || 0),
      });
    }

    return rawProducts.map((p) => ({
      id: p.id as string,
      slug: p.slug as string,
      name: p.name as string,
      tagline: (p.tagline as string) || '',
      description: p.description as string,
      category_id: p.category_id as string,
      category_name: p.category_name as string,
      origin_country: p.origin_country as string,
      region: p.region as string,
      farm_or_coop: p.farm_or_coop as string,
      altitude_meters: p.altitude_meters ? Number(p.altitude_meters) : undefined,
      variety: p.variety as string,
      process_method: p.process_method as any,
      roast_level: p.roast_level as any,
      tasting_notes: typeof p.tasting_notes === 'string' ? JSON.parse(p.tasting_notes) : (p.tasting_notes as string[]),
      acidity_score: Number(p.acidity_score || 3),
      body_score: Number(p.body_score || 3),
      sweetness_score: Number(p.sweetness_score || 3),
      image_url: p.image_url as string,
      is_featured: Boolean(p.is_featured),
      is_active: Boolean(p.is_active),
      variants: variantsByProductId[p.id as string] || [],
      created_at: p.created_at as string,
      updated_at: p.updated_at as string,
    }));
  }

  async getProductBySlugOrId(identifier: string): Promise<Product | null> {
    const raw = await this.db.prepare(`
      SELECT p.*, c.name as category_name
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE (p.id = ? OR p.slug = ?) AND p.is_active = 1
      LIMIT 1
    `).bind(identifier, identifier).first<Record<string, unknown>>();

    if (!raw) return null;

    const { results: rawVariants } = await this.db.prepare(`
      SELECT v.*, COALESCE(i.available_stock, 0) as stock_quantity
      FROM product_variants v
      LEFT JOIN inventory i ON v.id = i.variant_id
      WHERE v.product_id = ? AND v.is_active = 1
      ORDER BY v.weight_grams ASC
    `).bind(raw.id).all<Record<string, unknown>>();

    const variants: ProductVariant[] = (rawVariants || []).map((v) => ({
      id: v.id as string,
      product_id: v.product_id as string,
      sku: v.sku as string,
      weight_grams: Number(v.weight_grams),
      price_cents: Number(v.price_cents),
      grind_options: typeof v.grind_options === 'string' ? JSON.parse(v.grind_options as string) : (v.grind_options as any),
      is_active: Boolean(v.is_active),
      stock_quantity: Number(v.stock_quantity || 0),
    }));

    return {
      id: raw.id as string,
      slug: raw.slug as string,
      name: raw.name as string,
      tagline: (raw.tagline as string) || '',
      description: raw.description as string,
      category_id: raw.category_id as string,
      category_name: raw.category_name as string,
      origin_country: raw.origin_country as string,
      region: raw.region as string,
      farm_or_coop: raw.farm_or_coop as string,
      altitude_meters: raw.altitude_meters ? Number(raw.altitude_meters) : undefined,
      variety: raw.variety as string,
      process_method: raw.process_method as any,
      roast_level: raw.roast_level as any,
      tasting_notes: typeof raw.tasting_notes === 'string' ? JSON.parse(raw.tasting_notes as string) : (raw.tasting_notes as string[]),
      acidity_score: Number(raw.acidity_score || 3),
      body_score: Number(raw.body_score || 3),
      sweetness_score: Number(raw.sweetness_score || 3),
      image_url: raw.image_url as string,
      is_featured: Boolean(raw.is_featured),
      is_active: Boolean(raw.is_active),
      variants,
      created_at: raw.created_at as string,
      updated_at: raw.updated_at as string,
    };
  }

  async getBrewingGuides(): Promise<BrewingGuide[]> {
    const { results } = await this.db.prepare('SELECT * FROM brewing_guides').all<Record<string, unknown>>();
    return (results || []).map((r) => ({
      id: r.id as string,
      slug: r.slug as string,
      name: r.name as string,
      grind_recommendation: r.grind_recommendation as any,
      ratio_description: r.ratio_description as string,
      water_temp_celsius: Number(r.water_temp_celsius),
      brew_time_seconds: Number(r.brew_time_seconds),
      steps: typeof r.steps_json === 'string' ? JSON.parse(r.steps_json) : [],
      pro_tips: typeof r.pro_tips_json === 'string' ? JSON.parse(r.pro_tips_json) : [],
    }));
  }
}
