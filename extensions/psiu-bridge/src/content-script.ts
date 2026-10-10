(() => {
  const chromeApi: any = (globalThis as any).chrome;
  type Command = 'probe' | 'uid' | 'status' | 'signal' | 'inputsel' | 'samplerate' | 'sampling' | 'audio' | 'audio-cancel';
  type PageRequest = { channel: 'wally-psiu-bridge'; type: 'request'; requestId: string; command: Command; running?: boolean; xlr?: boolean; hz?: number; targetRequestId?: string };
  const channel = 'wally-psiu-bridge';
  const commands = new Set<Command>(['probe', 'uid', 'status', 'signal', 'inputsel', 'samplerate', 'sampling', 'audio', 'audio-cancel']);
  let port: any;
  const audioBytes = new Map<string, number>();
  const nextAudioTraceAt = new Map<string, number>();
  const trace = (event: string, details: Record<string, unknown> = {}) => console.info('[Wally PSIU Bridge content]', event, details);
  const connect = () => {
    const next = chromeApi.runtime.connect({ name: channel });
    next.onMessage.addListener((message: any) => {
      if (message?.type === 'audio-start') { audioBytes.set(message.requestId, 0); nextAudioTraceAt.set(message.requestId, 256 * 1024); trace('audio-forward-start', { requestId: message.requestId, totalBytes: message.totalBytes }); }
      if (message?.type === 'audio-chunk' && typeof message.data === 'string') { const bytes = Math.floor(message.data.length * 3 / 4); const received = (audioBytes.get(message.requestId) ?? 0) + bytes; audioBytes.set(message.requestId, received); if (received >= (nextAudioTraceAt.get(message.requestId) ?? 0)) { trace('audio-forward-progress', { requestId: message.requestId, receivedBytes: received }); nextAudioTraceAt.set(message.requestId, received + 256 * 1024); } }
      if (message?.type === 'audio-complete' || message?.type === 'error') { trace('audio-forward-terminal', { requestId: message.requestId, type: message.type, message: message.message }); audioBytes.delete(message.requestId); nextAudioTraceAt.delete(message.requestId); }
      window.postMessage({ channel, type: 'response', ...(message as object) }, window.location.origin);
    });
    next.onDisconnect.addListener(() => { trace('port-disconnect'); if (port === next) port = undefined; });
    port = next;
    trace('port-connect');
  };
  const post = (message: object) => {
    if (!port) connect();
    try { port.postMessage(message); }
    catch (error) { trace('port-reconnect', { message: error instanceof Error ? error.message : String(error) }); port = undefined; connect(); port.postMessage(message); }
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
