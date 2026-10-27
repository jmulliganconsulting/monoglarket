// Server-Sent Events response for one live channel. The first event is the current state, so a reconnect is always complete.
import { LiveBusy, subscribe } from './hub.ts';

const encoder = new TextEncoder();
const frame = (event: string, data: string) => encoder.encode(`event: ${event}\ndata: ${data}\n\n`);

export function openStream(key: string, userId: number, event: string, initial: string, signal: AbortSignal): Response {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  // Subscribe before the body exists, so a refused connection becomes a plain status code (see busyResponse).
  const leave = subscribe(key, userId, (ev, data) => ctrl.enqueue(frame(ev, data)));
  signal.addEventListener('abort', leave);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      c.enqueue(frame(event, initial));
    },
    cancel() {
      leave();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' } });
}

export function busyResponse(e: unknown): Response {
  if (!(e instanceof LiveBusy)) throw e;
  return new Response('Live prices are busy. The page still works; reload to refresh.', { status: e.status, headers: { 'retry-after': '15' } });
}
