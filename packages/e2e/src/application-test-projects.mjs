import { join } from 'node:path';

// Projects own separate workers and fixtures. Share the bounded pool instead of
// serializing whole projects; retain explicitly serial projects in their own group.
export function applicationTestProject(config, files, source, workers) {
  const serial = config.test?.fileParallelism === false || config.test?.maxWorkers === 1;
  return { ...config, extends: false, test: { ...config.test,
    include: files.map(file => join(source, file)),
    maxWorkers: serial ? 1 : workers,
    sequence: { ...config.test?.sequence, groupOrder: serial ? 1 : 0 },
  } };
}
