export class D1BackupService {
    db;
    r2Bucket;
    constructor(db, r2Bucket) {
        this.db = db;
        this.r2Bucket = r2Bucket;
    }
    async performNightlyExport() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupKey = `backups/d1_snapshot_${timestamp}.json`;
        const tables = [
            'categories',
            'products',
            'product_variants',
            'inventory',
            'inventory_movements',
            'orders',
            'order_items',
            'payments',
            'refunds',
            'coupons',
            'audit_log',
        ];
        const snapshot = {};
        let totalRows = 0;
        for (const table of tables) {
            try {
                const { results } = await this.db.prepare(`SELECT * FROM ${table}`).all();
                snapshot[table] = results || [];
                totalRows += (results || []).length;
            }
            catch (err) {
                console.warn(`Failed reading table ${table} during backup:`, err);
                snapshot[table] = [];
            }
        }
        const payload = JSON.stringify({
            schema_version: '1.0.0',
            exported_at: new Date().toISOString(),
            platform: 'Cloudflare D1',
            total_rows: totalRows,
            data: snapshot,
        }, null, 2);
        if (this.r2Bucket) {
            await this.r2Bucket.put(backupKey, payload, {
                httpMetadata: { contentType: 'application/json' },
                customMetadata: { totalRows: totalRows.toString(), environment: 'production' },
            });
            console.log(`[D1 BACKUP] Successfully uploaded snapshot to R2: ${backupKey} (${totalRows} total rows)`);
        }
        else {
            console.log(`[D1 BACKUP SIMULATION] Generated backup payload for ${backupKey} (${totalRows} rows)`);
        }
        return {
            success: true,
            key: backupKey,
            rowCount: totalRows,
        };
    }
}
