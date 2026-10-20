import { leaf } from './leaf';
import type { Job } from '../types/job';
export function run() { return leaf(); }
export function dispatch(job: Job) { return job.run(); }
