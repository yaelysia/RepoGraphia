import { start } from './ui/start';
import { dispatch } from './core/run';
import type { Job } from './types/job';
export function launch(job: Job) { return start(job) + dispatch(job); }
