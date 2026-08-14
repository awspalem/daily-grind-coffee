export class InventoryLedgerService {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Records an immutable movement in the inventory_movements ledger
     * and updates the current inventory snapshot table.
     */
    async recordMovement(params) {
        const { variantId, movementType, delta, referenceType, referenceId, reason, actor = 'SYSTEM' } = params;
        // Fetch current inventory
        const current = await this.db.prepare('SELECT available_stock, reserved_stock FROM inventory WHERE variant_id = ?').bind(variantId).first();
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
      `).bind(movementId, variantId, movementType, delta, newAvailable, referenceType || null, referenceId || null, reason || null, actor)
        ]);
        return {
            success: true,
            newAvailableStock: newAvailable
        };
    }
    async getInventorySnapshot(variantId) {
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
    async getRecentMovements(limit = 50) {
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
