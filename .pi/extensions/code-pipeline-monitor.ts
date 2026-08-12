import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

type ActionExecution = { status?: string };
type StageState = {
  stageName?: string;
  latestExecution?: ActionExecution;
  actionStates?: Array<{ latestExecution?: ActionExecution }>;
};

type PipelineState = { stageStates?: StageState[] };

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
        'get-pipeline-state',
        '--name', pipelineName,
        '--output', 'json',
      ], { timeout: 8_000 });

      if (result.code !== 0) {
        const message = result.stderr.trim() || 'AWS CLI request failed';
        ctx.ui.setStatus(statusKey, ctx.ui.theme.fg('error', 'pipeline: unavailable'));
        if (notifyOnError) ctx.ui.notify(`CodePipeline monitor: ${message}`, 'error');
        return;
      }

      const state = JSON.parse(result.stdout) as PipelineState;
      const stages = ['Source', 'Validate', 'Deploy'].map((name) => ({
        name,
        status: stageStatus(state.stageStates, name),
      }));
      const rendered = stages.map((stage) => renderStage(ctx, stage.name, stage.status)).join(' · ');
      ctx.ui.setStatus(statusKey, `pipeline: ${rendered}`);
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

function stageStatus(stages: StageState[] | undefined, stageName: string): string | undefined {
  const stage = stages?.find((candidate) => candidate.stageName === stageName);
  return stage?.latestExecution?.status
    ?? stage?.actionStates?.map((action) => action.latestExecution?.status).find(Boolean);
}

function renderStage(ctx: ExtensionContext, name: string, status: string | undefined): string {
  const shortName = name === 'Validate' ? 'Validate' : name;
  switch (status) {
    case 'Succeeded':
      return ctx.ui.theme.fg('success', `${shortName} ✓`);
    case 'InProgress':
      return ctx.ui.theme.fg('warning', `${shortName} …`);
    case 'Failed':
      return ctx.ui.theme.fg('error', `${shortName} ✗`);
    case 'Stopped':
    case 'Abandoned':
      return ctx.ui.theme.fg('warning', `${shortName} ${status.toLowerCase()}`);
    default:
      return ctx.ui.theme.fg('dim', `${shortName} —`);
  }
}
