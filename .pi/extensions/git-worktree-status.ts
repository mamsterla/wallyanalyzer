import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { basename } from 'node:path';

const statusKey = 'git-worktree-status';

export default function gitWorktreeStatus(pi: ExtensionAPI) {
  const refresh = async (ctx: ExtensionContext) => {
    const root = await git(pi, ['rev-parse', '--show-toplevel']);
    if (!root) {
      ctx.ui.setStatus(statusKey, undefined);
      return;
    }

    const branch = await git(pi, ['branch', '--show-current'])
      ?? await git(pi, ['rev-parse', '--short', 'HEAD'])
      ?? 'unknown';
    const [gitDir, commonGitDir] = await Promise.all([
      git(pi, ['rev-parse', '--path-format=absolute', '--git-dir']),
      git(pi, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    ]);
    const isLinkedWorktree = Boolean(gitDir && commonGitDir && gitDir !== commonGitDir);
    const label = isLinkedWorktree ? `worktree: ${basename(root)} · ${branch}` : `branch: ${branch}`;
    ctx.ui.setStatus(statusKey, ctx.ui.theme.fg('dim', label));
  };

  pi.on('session_start', async (_event, ctx) => refresh(ctx));
  pi.on('turn_end', async (_event, ctx) => refresh(ctx));

  pi.registerCommand('git-status', {
    description: 'Refresh the current Git branch or worktree footer status',
    handler: async (_args, ctx) => refresh(ctx),
  });
}

async function git(pi: ExtensionAPI, args: string[]): Promise<string | undefined> {
  try {
    const result = await pi.exec('git', args, { timeout: 3_000 });
    return result.code === 0 ? result.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}
