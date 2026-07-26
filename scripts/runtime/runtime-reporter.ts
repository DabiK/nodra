import type { DoctorReport, RuntimeStatus } from "./runtime-types.js";

export class RuntimeReporter {
  status(status: RuntimeStatus): string {
    const summary = status.components.map((component) => {
      const endpoint = component.url ?? component.address ?? "-";
      const pid = component.identity?.pid ?? "-";
      return `${component.name.padEnd(8)} ${component.health.padEnd(8)} ${
        component.ownership.padEnd(8)
      } pid=${pid} endpoint=${endpoint} ${component.detail ?? ""}`;
    });
    const exports = Object.entries(status.environment).map(
      ([name, value]) => `export ${name}=${this.shellQuote(value)}`
    );
    return `${JSON.stringify(status, null, 2)}\n\n${summary.join("\n")}${
      exports.length ? `\n\n${exports.join("\n")}` : ""
    }`;
  }

  doctor(report: DoctorReport): string {
    const summary = report.checks.map((check) =>
      `${check.status.toUpperCase().padEnd(7)} ${check.name}: ${check.detail}`
    );
    return `${JSON.stringify(report, null, 2)}\n\n${summary.join("\n")}`;
  }

  private shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
  }
}
