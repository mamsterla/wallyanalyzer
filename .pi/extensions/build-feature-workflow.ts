import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Small command wrapper around the project prompt workflow.
 * Keep orchestration policy in .pi/prompts/build-feature-workflow.md so it is
 * visible, reviewable, and easy to adjust as this project grows.
 */
export default function buildFeatureWorkflow(pi: ExtensionAPI) {
  pi.registerCommand('build-feature', {
    description: 'Run Wally Analyzer scoped feature delivery workflow',
    handler: async (args, ctx) => {
      const prompt = `/build-feature-workflow${args.trim() ? ` ${args.trim()}` : ''}`;
      ctx.ui.notify(`Queued ${prompt}`, 'info');
      pi.sendUserMessage(prompt, { deliverAs: 'followUp' });
    },
  });
}
