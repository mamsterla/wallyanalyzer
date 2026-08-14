import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

type PipelineExecution = { pipelineExecutionId?: string; status?: string };
type PipelineExecutionList = { pipelineExecutionSummaries?: PipelineExecution[] };

const statusKey = 'code-pipeline-monitor';
const defaultPipelineName = 'wally-analyzer-production';
const refreshIntervalMs = 15_000;

export default function codePipelineMonitor(pi: ExtensionAPI) {
  let refreshTimer: NodeJS.Timeout | undefined;
  let pipelineName: string | undefined;
  let refreshing = false;

  const stop = (ctx: ExtensionContext) => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = undefined;
    pipelineName = undefined;
    ctx.ui.setStatus(statusKey, undefined);
  };

  const refresh = async (ctx: ExtensionContext, notifyOnError = false) => {
    if (!pipelineName || refreshing) return;
    refreshing = true;
    try {
      const profile = process.env.AWS_PROFILE ?? 'wallyanalyzer';
      const region = process.env.AWS_REGION ?? 'us-east-1';
      const result = await pi.exec('aws', [
        '--profile', profile,
        '--region', region,
        'codepipeline',
        'list-pipeline-executions',
        '--pipeline-name', pipelineName,
        '--max-results', '1',
        '--output', 'json',
      ], { timeout: 8_000 });

      if (result.code !== 0) {
        const message = result.stderr.trim() || 'AWS CLI request failed';
        ctx.ui.setStatus(statusKey, ctx.ui.theme.fg('error', 'pipeline: unavailable'));
        if (notifyOnError) ctx.ui.notify(`CodePipeline monitor: ${message}`, 'error');
        return;
      }

      const executions = JSON.parse(result.stdout) as PipelineExecutionList;
      ctx.ui.setStatus(statusKey, renderExecution(ctx, executions.pipelineExecutionSummaries?.[0]));
    } catch (error) {
      ctx.ui.setStatus(statusKey, ctx.ui.theme.fg('error', 'pipeline: unavailable'));
      if (notifyOnError) {
        const message = error instanceof Error ? error.message : 'unknown monitor error';
        ctx.ui.notify(`CodePipeline monitor: ${message}`, 'error');
      }
    } finally {
      refreshing = false;
    }
  };

  pi.on('session_shutdown', (_event, ctx) => stop(ctx));

  pi.registerCommand('code-pipeline-monitor', {
    description: 'Monitor AWS CodePipeline state in the status line; optional pipeline name argument',
    handler: async (args, ctx) => {
      const requestedName = args.trim() || defaultPipelineName;
      if (refreshTimer) clearInterval(refreshTimer);
      pipelineName = requestedName;
      await refresh(ctx, true);
      refreshTimer = setInterval(() => void refresh(ctx), refreshIntervalMs);
      ctx.ui.notify(`Monitoring CodePipeline: ${pipelineName}`, 'info');
    },
  });

  pi.registerCommand('code-pipeline-close', {
    description: 'Stop the CodePipeline status-line monitor',
    handler: async (_args, ctx) => {
      const previous = pipelineName;
      stop(ctx);
      ctx.ui.notify(previous ? `Stopped CodePipeline monitor: ${previous}` : 'CodePipeline monitor is not running.', 'info');
    },
  });
}

function renderExecution(ctx: ExtensionContext, execution: PipelineExecution | undefined): string {
  const status = execution?.status;
  if (status === 'Succeeded') return ctx.ui.theme.fg('success', 'pipeline: succeeded');
  if (status === 'InProgress') return ctx.ui.theme.fg('warning', 'pipeline: running');
  if (status === 'Failed') return ctx.ui.theme.fg('error', 'pipeline: failed');
  if (status === 'Stopped' || status === 'Stopping') return ctx.ui.theme.fg('warning', `pipeline: ${status.toLowerCase()}`);
  return ctx.ui.theme.fg('dim', 'pipeline: unavailable');
}
