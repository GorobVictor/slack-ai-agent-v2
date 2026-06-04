import type { LoggerPort, LogFields, LogLevel } from "../../ports/logger.port";

interface ConsoleLogRecord extends LogFields {
  event: string;
  level: LogLevel;
  timestamp: string;
}

export class ConsoleLoggerAdapter implements LoggerPort {
  debug(event: string, fields: LogFields = {}): void {
    this.write("debug", event, fields);
  }

  info(event: string, fields: LogFields = {}): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write("error", event, fields);
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    const record: ConsoleLogRecord = {
      ...fields,
      event,
      level,
      timestamp: new Date().toISOString()
    };
    const serialized = JSON.stringify(record);

    if (level === "error") {
      console.error(serialized);
      return;
    }

    if (level === "warn") {
      console.warn(serialized);
      return;
    }

    console.log(serialized);
  }
}
