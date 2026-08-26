export function rankingWorkerUrl(serverModuleUrl: string): URL {
  const filename = new URL(serverModuleUrl).pathname.endsWith('.ts')
    ? 'ranking-worker-runner.js'
    : 'ranking-worker.js';
  return new URL(`./enhancing/${filename}`, serverModuleUrl);
}
