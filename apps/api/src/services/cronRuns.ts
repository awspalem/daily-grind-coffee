import type { Env } from '../types/env';

export type CronStatus = 'RUNNING' | 'OK' | 'ERROR';

export interface CronRunRecord {
  job_name: string;
  trigger_type: 'hourly' | 'nightly';
  status: CronStatus;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Records a single cron tick against the cron_runs table. Called by the
 * scheduled handler in index.ts at the start and end of every job.
 */
export async function recordCronRun(env: Env, run: CronRunRecord): Promise<number> {
  if (!env.DB) throw new Error('recordCronRun called without D1 binding');
  const result = await env.DB.prepare(`
    INSERT INTO cron_runs (
      job_name, trigger_type, status, started_at, finished_at, duration_ms, error_message, metadata_json
    ) VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?)
  `).bind(
    run.job_name,
    run.trigger_type,
    run.status,
    run.started_at || null,
    run.finished_at || null,
    run.duration_ms ?? null,
    run.error_message || null,
    run.metadata ? JSON.stringify(run.metadata) : null
  ).run();
  return Number((result as any)?.meta?.last_row_id ?? 0);
}

/**
 * Returns the most recent run per job — used by /api/health.
 */
export async function getLastCronRuns(env: Env): Promise<Array<{
  job_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
}>> {
  if (!env.DB) return [];
  const { results } = await env.DB.prepare(`
    SELECT cr.job_name, cr.status, cr.started_at, cr.finished_at, cr.duration_ms, cr.error_message
    FROM cron_runs cr
    INNER JOIN (
      SELECT job_name, MAX(started_at) AS max_started
      FROM cron_runs
      GROUP BY job_name
    ) latest ON latest.job_name = cr.job_name AND latest.max_started = cr.started_at
    ORDER BY cr.job_name ASC
  `).all<{
    job_name: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    error_message: string | null;
  }>();
  return (results || []) as any;
}
