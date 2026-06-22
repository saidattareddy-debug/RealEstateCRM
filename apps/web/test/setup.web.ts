import { beforeAll } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

/**
 * Runtime no-external-IO trap. Phase 7A integration services must never perform
 * external network IO. This setup replaces every network primitive with a thrower
 * so any accidental provider call FAILS the test (complementing the static
 * `verify:no-external-io` scan). Allowed: in-memory fakes, local crypto.
 */
const BLOCK = 'PHASE_7A_NO_EXTERNAL_IO: network IO is forbidden in integration tests';

beforeAll(() => {
  // fetch
  (globalThis as { fetch?: unknown }).fetch = () => {
    throw new Error(BLOCK);
  };
  // http/https request + get
  const throwIo = () => {
    throw new Error(BLOCK);
  };
  http.request = throwIo as unknown as typeof http.request;
  http.get = throwIo as unknown as typeof http.get;
  https.request = throwIo as unknown as typeof https.request;
  https.get = throwIo as unknown as typeof https.get;
  // raw sockets
  net.connect = throwIo as unknown as typeof net.connect;
  (net.Socket.prototype.connect as unknown) = throwIo;
  tls.connect = throwIo as unknown as typeof tls.connect;
});

export const NO_IO_MESSAGE = BLOCK;
