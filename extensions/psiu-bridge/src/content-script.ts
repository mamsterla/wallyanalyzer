(() => {
  const chromeApi: any = (globalThis as any).chrome;
  type Command = 'probe' | 'uid' | 'status' | 'sampling' | 'audio';
  type PageRequest = { channel: 'wally-psiu-bridge'; type: 'request'; requestId: string; command: Command; running?: boolean };
  const channel = 'wally-psiu-bridge';
  const commands = new Set<Command>(['probe', 'uid', 'status', 'sampling', 'audio']);
  const port = chromeApi.runtime.connect({ name: channel });

  port.onMessage.addListener((message: unknown) => {
    window.postMessage({ channel, type: 'response', ...(message as object) }, window.location.origin);
  });

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const value = event.data as Partial<PageRequest> | null;
    if (!value || value.channel !== channel || value.type !== 'request' || typeof value.requestId !== 'string' || !commands.has(value.command as Command)) return;
    if (value.command === 'sampling' && typeof value.running !== 'boolean') return;
    port.postMessage({ type: 'request', requestId: value.requestId, command: value.command, ...(value.command === 'sampling' ? { running: value.running } : {}) });
  });

  window.postMessage({ channel, type: 'ready' }, window.location.origin);
})();
