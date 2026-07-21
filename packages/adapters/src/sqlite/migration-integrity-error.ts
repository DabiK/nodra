export type MigrationIntegrityErrorCode =
  | "MIGRATION_CHANGED"
  | "MIGRATION_MISSING"
  | "MIGRATION_JOURNAL_INVALID";

export class MigrationIntegrityError extends Error {
  constructor(
    message: string,
    readonly code: MigrationIntegrityErrorCode
  ) {
    super(message);
    this.name = "MigrationIntegrityError";
  }
}
