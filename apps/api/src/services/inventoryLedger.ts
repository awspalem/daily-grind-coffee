import type { D1DatabaseLike } from '@daily-grind/db';
import type { InventoryMovementType } from '@daily-grind/shared-types';

export class InventoryLedgerService {
  constructor(private db: D1DatabaseLike) {}

  /**
   * Records an immutable movement in the inventory_movements ledger
   * and updates the current inventory snapshot table.
   */
  async recordMovement(params: {
    variantId: string;
    movementType: InventoryMovementType;
    delta: number;
    referenceType?: 'ORDER' | 'CART' | 'ADMIN' | 'SUPPLIER';
    referenceId?: string;
    reason?: string;
    actor?: string;
  }): Promise<{ success: boolean; newAvailableStock: number }> {
    const { variantId, movementType, delta, referenceType, referenceId, reason, actor = 'SYSTEM' } = params;

    // Fetch current inventory
    const current = await this.db.prepare(
      'SELECT available_stock, reserved_stock FROM inventory WHERE variant_id = ?'
    ).bind(variantId).first<{ available_stock: number; reserved_stock: number }>();

    const curAvailable = current ? Number(current.available_stock) : 0;
    const curReserved = current ? Number(current.reserved_stock) : 0;

    let newAvailable = curAvailable;
    let newReserved = curReserved;

    switch (movementType) {
      case 'INITIAL_STOCK':
      case 'RESTOCK':
        newAvailable += delta;
        break;

      case 'PURCHASE_RESERVE':
        if (curAvailable < Math.abs(delta)) {
          throw new Error(`Insufficient available stock for variant ${variantId}. Available: ${curAvailable}, Requested: ${Math.abs(delta)}`);
        }
        newAvailable -= Math.abs(delta);
        newReserved += Math.abs(delta);
        break;

      case 'ORDER_FULFILLED':
        // Converted from reserved to fulfilled (deducted from reserved)
        newReserved = Math.max(0, newReserved - Math.abs(delta));
        break;

      case 'RESERVATION_EXPIRED':
        // Return reserved stock back to available
        newReserved = Math.max(0, newReserved - Math.abs(delta));
        newAvailable += Math.abs(delta);
        break;

      case 'DAMAGE_ADJUSTMENT':
        newAvailable = Math.max(0, newAvailable - Math.abs(delta));
        break;

      case 'RETURN_RESTOCK':
        newAvailable += Math.abs(delta);
        break;
    }

    const movementId = 'mov_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    // Run in batch/transaction
    await this.db.batch([
      // Update inventory table
      this.db.prepare(`
        INSERT INTO inventory (variant_id, sku, available_stock, reserved_stock, updated_at)
        VALUES (?, (SELECT sku FROM product_variants WHERE id = ?), ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(variant_id) DO UPDATE SET
          available_stock = ?,
          reserved_stock = ?,
          updated_at = CURRENT_TIMESTAMP
      `).bind(variantId, variantId, newAvailable, newReserved, newAvailable, newReserved),

      // Append immutable log
      this.db.prepare(`
        INSERT INTO inventory_movements (
          id, variant_id, movement_type, quantity_delta, stock_after, reference_type, reference_id, reason, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        movementId,
        variantId,
        movementType,
        delta,
        newAvailable,
        referenceType || null,
        referenceId || null,
        reason || null,
        actor
      )
    ]);

    return {
      success: true,
      newAvailableStock: newAvailable
    };
  }

  async getInventorySnapshot(variantId: string) {
    return this.db.prepare(`
      SELECT
        i.*,
        v.sku,
        v.weight_grams,
        p.name as product_name
      FROM inventory i
      JOIN product_variants v ON i.variant_id = v.id
      JOIN products p ON v.product_id = p.id
      WHERE i.variant_id = ?
    `).bind(variantId).first();
  }

  /**
   * Reserves stock for an entire order in a single round-trip pair: one SELECT
   * of the current snapshot for every variant, then one batched write of the
   * computed inventory updates and the corresponding ledger rows. A 5-item
   * checkout used to do 10 D1 round-trips (5 SELECT + 5 batches); it now does 2.
   *
   * Either every variant is reserved or none of them are — the batch is
   * committed as a single D1 batch, so a mid-flight failure can't leave a
   * partial reservation behind. Returns the per-variant post-reservation stock
   * so the caller can render an honest confirmation page.
   */
  async reserveMany(
    items: Array<{ variantId: string; quantity: number }>,
    opts: { referenceType?: 'ORDER' | 'CART'; referenceId?: string; actor?: string; reason?: string } = {}
  ): Promise<{ success: boolean; perVariant: Array<{ variantId: string; newAvailableStock: number }> }> {
    if (!items.length) return { success: true, perVariant: [] };
    const { referenceType, referenceId, actor = 'SYSTEM', reason } = opts;
    const variantIds = items.map((i) => i.variantId);

    // D1 doesn't support a clean IN (...) array bind, so use the documented
    // `IN (?, ?, ...)` with the same number of placeholders as variants.
    const placeholders = variantIds.map(() => '?').join(', ');
    const { results: snapshot } = await this.db.prepare(
      `SELECT variant_id, available_stock, reserved_stock FROM inventory WHERE variant_id IN (${placeholders})`
    ).bind(...variantIds).all<{ variant_id: string; available_stock: number; reserved_stock: number }>();

    const byId = new Map(snapshot.map((row) => [row.variant_id, row]));

    // Validate first; we don't want to half-write if one variant is short.
    const computed: Array<{ variantId: string; requested: number; newAvailable: number; newReserved: number; movementId: string }> = [];
    for (const item of items) {
      const row = byId.get(item.variantId);
      const curAvailable = row ? Number(row.available_stock) : 0;
      const curReserved = row ? Number(row.reserved_stock) : 0;
      const need = Math.abs(item.quantity);
      if (curAvailable < need) {
        throw new Error(`Insufficient available stock for variant ${item.variantId}. Available: ${curAvailable}, Requested: ${need}`);
      }
      computed.push({
        variantId: item.variantId,
        requested: item.quantity,
        newAvailable: curAvailable - need,
        newReserved: curReserved + need,
        movementId: 'mov_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16),
      });
    }

    // One single batch — every inventory update + every ledger row go in one
    // db.batch() call. If any statement fails, none of them persist.
    const statements: any[] = [];
    for (const c of computed) {
      statements.push(
        this.db.prepare(`
          INSERT INTO inventory (variant_id, sku, available_stock, reserved_stock, updated_at)
          VALUES (?, (SELECT sku FROM product_variants WHERE id = ?), ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(variant_id) DO UPDATE SET
            available_stock = ?,
            reserved_stock = ?,
            updated_at = CURRENT_TIMESTAMP
        `).bind(c.variantId, c.variantId, c.newAvailable, c.newReserved, c.newAvailable, c.newReserved)
      );
      statements.push(
        this.db.prepare(`
          INSERT INTO inventory_movements (
            id, variant_id, movement_type, quantity_delta, stock_after, reference_type, reference_id, reason, created_by
          ) VALUES (?, ?, 'PURCHASE_RESERVE', ?, ?, ?, ?, ?, ?)
        `).bind(
          c.movementId,
          c.variantId,
          c.requested,
          c.newAvailable,
          referenceType || null,
          referenceId || null,
          reason || null,
          actor
        )
      );
    }
    await this.db.batch(statements);

    return {
      success: true,
      perVariant: computed.map((c) => ({ variantId: c.variantId, newAvailableStock: c.newAvailable })),
    };
  }

  async getRecentMovements(limit: number = 50) {
    const { results } = await this.db.prepare(`
      SELECT 
        m.*,
        v.sku,
        p.name as product_name
      FROM inventory_movements m
      JOIN product_variants v ON m.variant_id = v.id
      JOIN products p ON v.product_id = p.id
      ORDER BY m.created_at DESC
      LIMIT ?
    `).bind(limit).all();

    return results || [];
  }
}
