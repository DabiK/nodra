import { isRecord } from "./codex-json-rpc-types.js";

const secretKey = /(^|_)(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)($|_)/i;
const secretValue = /(bearer\s+)[^\s"']+|(sk-[a-z0-9_-]{12,})|((?:token|api[_-]?key|password|secret)=)[^\s]+/gi;

export class CodexRedactor {
  redact(value: unknown): unknown {
    if (typeof value === "string") return value.replace(secretValue, "$1$3[REDACTED]");
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      secretKey.test(key) ? "[REDACTED]" : this.redact(item)
    ]));
  }
}
