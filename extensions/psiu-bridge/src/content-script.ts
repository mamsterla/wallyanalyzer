(() => {
  const chromeApi: any = (globalThis as any).chrome;
  type Command = 'probe' | 'uid' | 'status' | 'signal' | 'inputsel' | 'samplerate' | 'sampling' | 'audio' | 'audio-resume' | 'audio-cancel';
  type PageRequest = { channel: 'wally-psiu-bridge'; type: 'request'; requestId: string; command: Command; running?: boolean; xlr?: boolean; hz?: number; targetRequestId?: string; receivedBytes?: number };
  const channel = 'wally-psiu-bridge';
  const commands = new Set<Command>(['probe', 'uid', 'status', 'signal', 'inputsel', 'samplerate', 'sampling', 'audio', 'audio-resume', 'audio-cancel']);
  let port: any;
  let reconnecting = false;
  const trace = (event: string, details: Record<string, unknown> = {}) => console.info('[Wally PSIU Bridge content]', event, details);
  const connect = () => {
    try {
      const next = chromeApi.runtime.connect({ name: channel });
      next.onMessage.addListener((message: unknown) => window.postMessage({ channel, type: 'response', ...(message as object) }, window.location.origin));
      next.onDisconnect.addListener(() => {
        if (port !== next) return;
        port = undefined;
        trace('port-disconnect', { message: chromeApi.runtime.lastError?.message });
        reconnecting = true;
        queueMicrotask(connect);
      });
      port = next;
      trace('port-connect', { reconnected: reconnecting });
      if (reconnecting) { reconnecting = false; window.postMessage({ channel, type: 'bridge-reconnected' }, window.location.origin); }
    } catch (error) { trace('port-connect-failed', { message: error instanceof Error ? error.message : String(error) }); }
  };
  const post = (message: object) => {
    if (!port) connect();
    if (!port) throw new Error('Wally PSIU Bridge is unavailable. Reload this page after enabling the extension.');
    try { port.postMessage(message); }
    catch (error) { trace('port-reconnect', { message: error instanceof Error ? error.message : String(error) }); port = undefined; reconnecting = true; connect(); if (port) port.postMessage(message); }
  };
  connect();

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const value = event.data as Partial<PageRequest> | null;
    if (!value || value.channel !== channel || value.type !== 'request' || typeof value.requestId !== 'string' || !commands.has(value.command as Command)) return;
    if (value.command === 'sampling' && typeof value.running !== 'boolean') return;
    if (value.command === 'inputsel' && typeof value.xlr !== 'boolean') return;
    if (value.command === 'samplerate' && value.hz !== 96_000 && value.hz !== 192_000) return;
    if ((value.command === 'audio-cancel' || value.command === 'audio-resume') && typeof value.targetRequestId !== 'string') return;
    if (value.command === 'audio-resume' && (!Number.isSafeInteger(value.receivedBytes) || (value.receivedBytes ?? -1) < 0)) return;
    post({ type: 'request', requestId: value.requestId, command: value.command, ...(value.command === 'sampling' ? { running: value.running } : {}), ...(value.command === 'inputsel' ? { xlr: value.xlr } : {}), ...(value.command === 'samplerate' ? { hz: value.hz } : {}), ...((value.command === 'audio-cancel' || value.command === 'audio-resume') ? { targetRequestId: value.targetRequestId } : {}), ...(value.command === 'audio-resume' ? { receivedBytes: value.receivedBytes } : {}) });
  });

  window.postMessage({ channel, type: 'ready' }, window.location.origin);
})();
