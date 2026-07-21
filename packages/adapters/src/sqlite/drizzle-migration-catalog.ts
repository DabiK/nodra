import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { MigrationIntegrityError } from "./migration-integrity-error.js";

interface DrizzleJournalEntry {
  idx: number;
  tag: string;
  when: number;
  breakpoints: boolean;
}

interface DrizzleJournal {
  entries: DrizzleJournalEntry[];
}

export interface DrizzleMigration {
  version: number;
  tag: string;
  checksum: string;
}

const invalidJournal = (detail: string): MigrationIntegrityError =>
  new MigrationIntegrityError(`Invalid Drizzle migration journal: ${detail}`, "MIGRATION_JOURNAL_INVALID");

const parseJournal = (source: string): DrizzleJournal => {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw invalidJournal("meta/_journal.json is not valid JSON");
  }
  if (!value || typeof value !== "object" || !("entries" in value) || !Array.isArray(value.entries)) {
    throw invalidJournal("entries must be an array");
  }
  const entries = value.entries.map((entry, position) => {
    if (
      !entry
      || typeof entry !== "object"
      || !("idx" in entry)
      || !("tag" in entry)
      || !("when" in entry)
      || !("breakpoints" in entry)
    ) {
      throw invalidJournal(`entry ${position} is incomplete`);
    }
    const { idx, tag, when, breakpoints } = entry;
    if (
      !Number.isInteger(idx)
      || Number(idx) < 0
      || typeof tag !== "string"
      || !tag
      || basename(tag) !== tag
      || typeof when !== "number"
      || !Number.isFinite(when)
      || when < 0
      || typeof breakpoints !== "boolean"
    ) {
      throw invalidJournal(`entry ${position} has invalid Drizzle metadata`);
    }
    return { idx: Number(idx), tag, when, breakpoints };
  });
  if (!entries.length) throw invalidJournal("at least one migration is required");
  entries.forEach((entry, position) => {
    if (entry.idx !== position) {
      throw invalidJournal(`entry ${position} must use idx ${position}, received ${entry.idx}`);
    }
    const previous = entries[position - 1];
    if (previous && entry.when <= previous.when) {
      throw invalidJournal(`entry ${position} must have a later timestamp than entry ${position - 1}`);
    }
  });
  return { entries };
};

export const readDrizzleMigrationCatalog = async (migrationsDirectory: string): Promise<DrizzleMigration[]> => {
  let journalSource: string;
  try {
    journalSource = await readFile(join(migrationsDirectory, "meta", "_journal.json"), "utf8");
  } catch {
    throw new MigrationIntegrityError(
      "Missing Drizzle migration journal meta/_journal.json",
      "MIGRATION_MISSING"
    );
  }
  const journal = parseJournal(journalSource);
  return Promise.all(journal.entries.map(async ({ idx, tag }) => {
    let source: string;
    try {
      source = await readFile(join(migrationsDirectory, `${tag}.sql`), "utf8");
    } catch {
      throw new MigrationIntegrityError(`Missing Drizzle migration file ${tag}.sql`, "MIGRATION_MISSING");
    }
    return {
      version: idx + 1,
      tag,
      checksum: createHash("sha256").update(source).digest("hex")
    };
  }));
};
