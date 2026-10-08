(() => {
  const chromeApi: any = (globalThis as any).chrome;
  type Command = 'probe' | 'uid' | 'status' | 'signal' | 'inputsel' | 'samplerate' | 'sampling' | 'audio' | 'audio-cancel';
  type PageRequest = { channel: 'wally-psiu-bridge'; type: 'request'; requestId: string; command: Command; running?: boolean; xlr?: boolean; hz?: number; targetRequestId?: string };
  const channel = 'wally-psiu-bridge';
  const commands = new Set<Command>(['probe', 'uid', 'status', 'signal', 'inputsel', 'samplerate', 'sampling', 'audio', 'audio-cancel']);
  let port: any;
  const connect = () => {
    const next = chromeApi.runtime.connect({ name: channel });
    next.onMessage.addListener((message: unknown) => {
      window.postMessage({ channel, type: 'response', ...(message as object) }, window.location.origin);
    });
    next.onDisconnect.addListener(() => { if (port === next) port = undefined; });
    port = next;
  };
  const post = (message: object) => {
    if (!port) connect();
    try { port.postMessage(message); }
    catch { port = undefined; connect(); port.postMessage(message); }
  };
  connect();

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const value = event.data as Partial<PageRequest> | null;
    if (!value || value.channel !== channel || value.type !== 'request' || typeof value.requestId !== 'string' || !commands.has(value.command as Command)) return;
    if (value.command === 'sampling' && typeof value.running !== 'boolean') return;
    if (value.command === 'inputsel' && typeof value.xlr !== 'boolean') return;
    if (value.command === 'samplerate' && value.hz !== 96_000 && value.hz !== 192_000) return;
    if (value.command === 'audio-cancel' && typeof value.targetRequestId !== 'string') return;
    post({ type: 'request', requestId: value.requestId, command: value.command, ...(value.command === 'sampling' ? { running: value.running } : {}), ...(value.command === 'inputsel' ? { xlr: value.xlr } : {}), ...(value.command === 'samplerate' ? { hz: value.hz } : {}), ...(value.command === 'audio-cancel' ? { targetRequestId: value.targetRequestId } : {}) });
  });

  window.postMessage({ channel, type: 'ready' }, window.location.origin);
})();
