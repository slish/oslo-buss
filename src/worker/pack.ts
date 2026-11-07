// Gzip of a string and back, with the streams of the platform: the timetable is 1.7 to 2.7 MB of text but only a third of that
// packed, which is what fits comfortably in one value of the Durable Object's storage.

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function pack(text: string): Promise<Uint8Array> {
  const source = new Blob([text]).stream() as ReadableStream<Uint8Array>;
  return collect(source.pipeThrough(new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
}

export async function unpack(bytes: Uint8Array): Promise<string> {
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  return new Response(source.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).text();
}
