import { describe, expect, it } from 'vitest';
import { assertConsumerName } from './idempotency.js';

describe('logical consumer names', () => {
  it('accepts stable service-role names', () => {
    for (const name of ['activity-service', 'cache-invalidator', 'realtime-service']) {
      expect(assertConsumerName(name)).toBe(name);
    }
  });

  it('rejects names that look like hosts, tasks or arbitrary values', () => {
    for (const name of [
      '',
      'a',
      'Activity-Service',
      'ip-10-40-0-12.us-east-2.compute.internal',
      '7f3a2c1e-activity',
      'activity service',
      `a${'b'.repeat(63)}`,
    ]) {
      expect(() => assertConsumerName(name), name).toThrow('invalid consumer name');
    }
  });
});
