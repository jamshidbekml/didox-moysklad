import { randomUUID } from 'crypto';

/**
 * In-process registry of async import jobs.
 *
 * MoySklad's vendor API allows up to 24 hours between issuing an
 * asyncProcessId and calling /button/complete with it. For MVP we keep
 * state in memory — a process restart drops all in-flight jobs (the user
 * will see a stale "in progress" toast for up to 24h, and we simply won't
 * call /button/complete for it; acceptable for now).
 *
 * Promote to DB-backed when there's a real reliability requirement.
 */

export type JobStatus = 'running' | 'done' | 'failed';

export interface ImportJob {
  id: string;
  accountId: string;
  startedAt: Date;
  finishedAt?: Date;
  status: JobStatus;
  /** Free-form summary set by the pipeline on success. */
  result?: {
    total: number;
    imported: number;
    skipped: number;
    failed: number;
  };
  /** Human-readable error message on failure. */
  error?: string;
}

const jobs = new Map<string, ImportJob>();

/**
 * Register a new running job and return its id (used as asyncProcessId
 * in the response to MoySklad).
 */
export function createJob(accountId: string): ImportJob {
  const job: ImportJob = {
    id: randomUUID(),
    accountId,
    startedAt: new Date(),
    status: 'running',
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): ImportJob | undefined {
  return jobs.get(id);
}

export function completeJob(id: string, result: ImportJob['result']): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'done';
  job.result = result;
  job.finishedAt = new Date();
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'failed';
  job.error = error;
  job.finishedAt = new Date();
}
