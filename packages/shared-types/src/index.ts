export type RoastLevel = 'LIGHT' | 'MEDIUM_LIGHT' | 'MEDIUM' | 'MEDIUM_DARK' | 'DARK';

export type GrindType = 
  | 'WHOLE_BEAN'
  | 'ESPRESSO'
  | 'POUR_OVER'
  | 'AEROPRESS'
  | 'DRIP'
  | 'FRENCH_PRESS'
  | 'COLD_BREW';

export type ProcessMethod = 'WASHED' | 'NATURAL' | 'HONEY' | 'ANAEROBIC' | 'WET_HULLED';

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  display_order: number;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string;
  weight_grams: number;
  price_cents: number; // USD cents for backward compat
  price_inr: number;   // INR ₹ (default)
  price_usd_cents?: number; // USD $ cents
  discount_percent?: number; // 0 to 100%
  grind_options: GrindType[];
  is_active: boolean;
  stock_quantity?: number;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category_id: string;
  category_name?: string;
  origin_country: string;
  region: string;
  farm_or_coop?: string;
  altitude_meters?: number;
  variety?: string;
  process_method: ProcessMethod;
  roast_level: RoastLevel;
  tasting_notes: string[];
  acidity_score: number; // 1 to 5
  body_score: number;    // 1 to 5
  sweetness_score: number; // 1 to 5
  image_url: string;
  is_featured: boolean;
  is_active: boolean;
  variants: ProductVariant[];
  created_at: string;
  updated_at: string;
}

export type InventoryMovementType = 
  | 'INITIAL_STOCK'
  | 'PURCHASE_RESERVE'
  | 'ORDER_FULFILLED'
  | 'RESTOCK'
  | 'DAMAGE_ADJUSTMENT'
  | 'RETURN_RESTOCK'
  | 'RESERVATION_EXPIRED';

export interface Inventory {
  variant_id: string;
  sku: string;
  available_stock: number;
  reserved_stock: number;
  low_stock_threshold: number;
  last_restocked_at?: string;
  updated_at: string;
}

export interface InventoryMovement {
  id: string;
  variant_id: string;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  stock_after: number;
  reference_type?: 'ORDER' | 'CART' | 'ADMIN' | 'SUPPLIER';
  reference_id?: string;
  reason?: string;
  created_by?: string;
  created_at: string;
}

export interface CartItem {
  id: string;
  cart_id: string;
  variant_id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  image_url: string;
  weight_grams: number;
  grind_type: GrindType;
  price_cents: number;
  quantity: number;
  line_total_cents: number;
}

export interface Cart {
  id: string;
  customer_id?: string;
  session_token: string;
  items: CartItem[];
  subtotal_cents: number;
  discount_cents: number;
  applied_coupon_code?: string;
  total_cents: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export type OrderStatus = 
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'ROASTING'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface OrderItem {
  id: string;
  order_id: string;
  variant_id: string;
  product_id?: string;
  product_name: string;
  weight_grams: number;
  grind_type: GrindType;
  unit_price_cents: number;
  quantity: number;
  total_price_cents: number;
}

export interface ShippingAddress {
  name: string;
  email: string;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id?: string;
  customer_email: string;
  status: OrderStatus;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
  currency: string;
  shipping_address: ShippingAddress;
  stripe_session_id?: string;
  stripe_payment_intent_id?: string;
  tracking_number?: string;
  carrier?: string;
  items: OrderItem[];
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  order_id: string;
  stripe_payment_intent_id: string;
  amount_cents: number;
  currency: string;
  status: 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'REFUNDED';
  payment_method_type: string;
  idempotency_key: string;
  created_at: string;
}

export interface Coupon {
  id: string;
  code: string;
  discount_type: 'PERCENT' | 'FIXED';
  discount_value: number; // e.g. 15 for 15% or 500 for $5.00
  minimum_order_cents: number;
  max_uses?: number;
  times_used: number;
  expires_at?: string;
  is_active: boolean;
}

export interface BrewingGuide {
  id: string;
  slug: string;
  name: string;
  grind_recommendation: GrindType;
  ratio_description: string;
  water_temp_celsius: number;
  brew_time_seconds: number;
  steps: { step_number: number; instruction: string; duration_seconds?: number }[];
  pro_tips: string[];
}

export interface AgentChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
  timestamp: string;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  requires_confirmation?: boolean;
  confirmation_token?: string;
}

export interface AgentActionConfirmation {
  confirmation_token: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  summary: string;
  impact_description: string;
  expires_at: number;
}
