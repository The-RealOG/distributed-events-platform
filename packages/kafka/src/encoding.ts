import { partitionKeyOf, type DomainEvent } from '@dpp/contracts';
import type { IHeaders, Message } from 'kafkajs';

/**
 * Wire format: UTF-8 JSON value, key = projectId, plus headers mirroring a few envelope
 * fields so tools can route or inspect messages without parsing the body. The body is
 * authoritative; consumers validate it and do not trust headers.
 */
export function encodeDomainEvent(event: DomainEvent): Message & { key: string } {
  return {
    key: partitionKeyOf(event),
    value: JSON.stringify(event),
    timestamp: String(Date.parse(event.occurredAt)),
    headers: {
      'content-type': 'application/json',
      'event-id': event.eventId,
      'event-type': event.eventType,
      'schema-version': String(event.schemaVersion),
      'correlation-id': event.correlationId,
    },
  };
}

export function headersToStrings(headers: IHeaders | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === undefined) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) out[name] = first.toString();
  }
  return out;
}
