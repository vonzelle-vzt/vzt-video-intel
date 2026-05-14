// Optional Mux URL citation generator. Lets Claude cite specific moments by
// timestamp via a Mux playback URL with #t=start,end fragment.

export function muxCitation(base: string, startMs: number, endMs: number): string {
  if (!base) return "";
  const startSec = (startMs / 1000).toFixed(2);
  const endSec = (endMs / 1000).toFixed(2);
  return `${base}#t=${startSec},${endSec}`;
}
