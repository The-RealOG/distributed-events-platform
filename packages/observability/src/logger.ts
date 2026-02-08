import { stdTimeFunctions, type LoggerOptions } from 'pino';

/**
 * Shared Pino configuration: JSON lines with ISO timestamps, a `service` field on every
 * record, and redaction of credentials that could otherwise reach logs via serializers.
 */
export function createLoggerOptions(service: string, level: string): LoggerOptions {
  return {
    level,
    base: { service },
    timestamp: stdTimeFunctions.isoTime,
    messageKey: 'message',
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        '*.password',
        '*.token',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
  };
}
