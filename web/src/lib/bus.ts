// Simulates the physical QR hand-off between the attendee's phone and the
// gate scanner. BroadcastChannel works across tabs and within one page, so
// the side-by-side demo view and separate-tab views both work.

export type ScanPayload = {
  tokenId: string; // bigint as string for structured-clone safety
  code: string; // the venue code the attendee typed
  sig: string;
  holder: string;
  seat: string;
};

const CHANNEL = "tickets-gate-scan";

export function presentToGate(payload: ScanPayload) {
  new BroadcastChannel(CHANNEL).postMessage(payload);
}

export function onScan(handler: (p: ScanPayload) => void): () => void {
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e) => handler(e.data as ScanPayload);
  return () => ch.close();
}

// Gate → attendee result notifications (so the phone shows the outcome).
const RESULT_CHANNEL = "tickets-gate-result";

export type ScanResult = { tokenId: string; ok: boolean; message: string };

export function announceResult(r: ScanResult) {
  new BroadcastChannel(RESULT_CHANNEL).postMessage(r);
}

export function onResult(handler: (r: ScanResult) => void): () => void {
  const ch = new BroadcastChannel(RESULT_CHANNEL);
  ch.onmessage = (e) => handler(e.data as ScanResult);
  return () => ch.close();
}
