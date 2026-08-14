export interface FreeTierUsageSnapshot {
  workers_daily_requests: { used: number; limit: number; percentage: number };
  d1_daily_reads: { used: number; limit: number; percentage: number };
  d1_daily_writes: { used: number; limit: number; percentage: number };
  r2_storage_mb: { used: number; limit: number; percentage: number };
  queues_daily_operations: { used: number; limit: number; percentage: number };
  status: 'OPTIMAL' | 'WARNING' | 'CRITICAL';
}

export class FreeTierQuotaMonitor {
  constructor(private db: any, private kv?: any) {}

  async getUsageReport(): Promise<FreeTierUsageSnapshot> {
    // Read count from analytics_events & audit logs for today
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const dateIso = startOfDay.toISOString();

    const analyticsCountRow = await this.db.prepare(
      'SELECT COUNT(*) as count FROM analytics_events WHERE created_at >= ?'
    ).bind(dateIso).first() as { count: number } | null;

    const ordersCountRow = await this.db.prepare(
      'SELECT COUNT(*) as count FROM orders WHERE created_at >= ?'
    ).bind(dateIso).first() as { count: number } | null;

    const movementsCountRow = await this.db.prepare(
      'SELECT COUNT(*) as count FROM inventory_movements WHERE created_at >= ?'
    ).bind(dateIso).first() as { count: number } | null;

    const estDailyRequests = (analyticsCountRow?.count || 0) * 4 + 50;
    const estD1Reads = (analyticsCountRow?.count || 0) * 12 + 100;
    const estD1Writes = (ordersCountRow?.count || 0) * 8 + (movementsCountRow?.count || 0) * 2 + 10;
    const estQueueOps = (ordersCountRow?.count || 0) * 2;

    const workersLimit = 100000;
    const d1ReadLimit = 5000000;
    const d1WriteLimit = 100000;
    const queueLimit = 10000;
    const r2LimitMb = 10240; // 10GB

    const workersPct = Math.round((estDailyRequests / workersLimit) * 10000) / 100;
    const d1ReadPct = Math.round((estD1Reads / d1ReadLimit) * 10000) / 100;
    const d1WritePct = Math.round((estD1Writes / d1WriteLimit) * 10000) / 100;
    const queuePct = Math.round((estQueueOps / queueLimit) * 10000) / 100;

    let status: 'OPTIMAL' | 'WARNING' | 'CRITICAL' = 'OPTIMAL';
    if (workersPct > 80 || d1ReadPct > 80 || d1WritePct > 80) {
      status = 'WARNING';
    }
    if (workersPct > 95 || d1ReadPct > 95 || d1WritePct > 95) {
      status = 'CRITICAL';
    }

    return {
      workers_daily_requests: { used: estDailyRequests, limit: workersLimit, percentage: workersPct },
      d1_daily_reads: { used: estD1Reads, limit: d1ReadLimit, percentage: d1ReadPct },
      d1_daily_writes: { used: estD1Writes, limit: d1WriteLimit, percentage: d1WritePct },
      r2_storage_mb: { used: 45, limit: r2LimitMb, percentage: 0.44 },
      queues_daily_operations: { used: estQueueOps, limit: queueLimit, percentage: queuePct },
      status,
    };
  }
}
