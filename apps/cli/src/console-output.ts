import type { CliOutput } from "./nodra-cli.js";

export class ConsoleOutput implements CliOutput {
  write(value: string): void {
    process.stdout.write(`${value}\n`);
  }
}
