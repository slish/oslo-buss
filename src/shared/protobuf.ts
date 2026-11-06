// A small protobuf reader for GTFS-realtime TripUpdates. Adapted from joelhagvall/under-stockholm (MIT), see NOTICE.md.
// Nothing here needs Node: it runs in a browser, a Worker or a script.

export interface StopEvent { time?: number; delay?: number }
export interface StopUpdate { sequence?: number; stopId?: string; arrival?: StopEvent; departure?: StopEvent; skipped: boolean }
export interface TripUpdate { tripId: string; canceled: boolean; stops: StopUpdate[] }

export class Reader {
  at = 0;
  // Reading past the end throws, so a cut or broken feed fails whole instead of parsing in part.
  constructor(readonly bytes: Uint8Array, readonly end = bytes.length) {}

  /** A varint as a signed 64-bit number (negative int32/int64 values are sent as ten bytes). */
  varint(): number {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 7; i++) {
      const b = this.byte();
      result += (b & 0x7f) * scale;
      if (b < 0x80) return result;
      scale *= 128;
    }
    let big = BigInt(result);
    let shift = 49n;
    for (let i = 7; i < 10; i++) {
      const b = this.byte();
      if (i === 9 && b > 1) throw new Error('Invalid protobuf varint');
      big |= BigInt(b & 0x7f) << shift;
      if (b < 0x80) return Number(BigInt.asIntN(64, big));
      shift += 7n;
    }
    throw new Error('Invalid protobuf varint');
  }

  private byte(): number {
    if (this.at >= this.end) throw new Error('Truncated protobuf');
    return this.bytes[this.at++];
  }

  each(field: (n: number, wire: number) => void): void {
    while (this.at < this.end) {
      const key = this.varint();
      field(Math.floor(key / 8), key & 7);
    }
    if (this.at > this.end) throw new Error('Truncated protobuf');
  }

  sub(): Reader {
    const length = this.length();
    const r = new Reader(this.bytes, this.at + length);
    r.at = this.at;
    this.at += length;
    return r;
  }

  private length(): number {
    const length = this.varint();
    if (!Number.isSafeInteger(length) || length < 0 || length > 0x7fffffff) throw new Error('Invalid protobuf length');
    if (length > this.end - this.at) throw new Error('Truncated protobuf');
    return length;
  }

  string(): string {
    const r = this.sub();
    return new TextDecoder().decode(this.bytes.subarray(r.at, r.end));
  }

  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.at += 8;
    else if (wire === 2) {
      // Read the length first: `this.at += this.length()` would add it to the position before the length's own bytes.
      const length = this.length();
      this.at += length;
    }
    else if (wire === 5) this.at += 4;
    else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
}

function stopTimeEvent(r: Reader): StopEvent {
  const event: StopEvent = {};
  r.each((n, wire) => {
    if (n === 1 && wire === 0) event.delay = r.varint();
    else if (n === 2 && wire === 0) event.time = r.varint();
    else r.skip(wire);
  });
  return event;
}

/** StopTimeUpdate: stop_sequence = 1, arrival = 2, departure = 3, stop_id = 4, schedule_relationship = 5 (1 is SKIPPED). */
function stopTimeUpdate(r: Reader): StopUpdate {
  const stop: StopUpdate = { skipped: false };
  r.each((n, wire) => {
    if (n === 1 && wire === 0) stop.sequence = r.varint();
    else if (n === 2 && wire === 2) stop.arrival = stopTimeEvent(r.sub());
    else if (n === 3 && wire === 2) stop.departure = stopTimeEvent(r.sub());
    else if (n === 4 && wire === 2) stop.stopId = r.string();
    else if (n === 5 && wire === 0) stop.skipped = r.varint() === 1;
    else r.skip(wire);
  });
  return stop;
}

/** TripUpdate: trip = 1 (TripDescriptor: trip_id = 1, schedule_relationship = 4, 3 is CANCELED), stop_time_update = 2. */
function tripUpdate(r: Reader): TripUpdate {
  const update: TripUpdate = { tripId: '', canceled: false, stops: [] };
  r.each((n, wire) => {
    if (n === 1 && wire === 2) {
      const trip = r.sub();
      trip.each((m, w) => {
        if (m === 1 && w === 2) update.tripId = trip.string();
        else if (m === 4 && w === 0) update.canceled = trip.varint() === 3;
        else trip.skip(w);
      });
    } else if (n === 2 && wire === 2) update.stops.push(stopTimeUpdate(r.sub()));
    else r.skip(wire);
  });
  return update;
}

/**
 * Every trip update in a GTFS-realtime FeedMessage (FeedMessage.entity = 2, FeedEntity.trip_update = 3).
 * `wanted` drops every other trip, which is most of the feed.
 */
export function parseTripUpdates(bytes: Uint8Array, wanted?: (tripId: string) => boolean): TripUpdate[] {
  const updates: TripUpdate[] = [];
  const feed = new Reader(bytes);
  feed.each((n, wire) => {
    if (n !== 2 || wire !== 2) return feed.skip(wire);
    const entity = feed.sub();
    entity.each((m, w) => {
      if (m !== 3 || w !== 2) return entity.skip(w);
      const update = tripUpdate(entity.sub());
      if (update.tripId && (!wanted || wanted(update.tripId))) updates.push(update);
    });
  });
  return updates;
}
