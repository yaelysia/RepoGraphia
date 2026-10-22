import { parentPort, workerData } from 'node:worker_threads';
import { analyze } from './analyze.js';
import type { AnalysisInputs } from './project.js';

try {
  let inputs: AnalysisInputs | undefined;
  const graph = analyze(workerData.root, { project: workerData.project, includeSource: true, onInputs: captured => { inputs = captured; } });
  if (!inputs) throw new Error('Analysis did not capture its inputs');
  parentPort?.postMessage({ graph, inputs });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
