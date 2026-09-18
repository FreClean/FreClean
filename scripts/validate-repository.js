#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "dist"]);
const forbidden = new RegExp(["c", "U", "S", "D"].join(""), "i");
const migrationDir = path.join(root, "database", "migrations");
const migrations = readdirSync(migrationDir).filter((file) => file.endsWith(".sql")).sort();

if (migrations.some((file) => !/^\d{4}_[a-z0-9-]+\.sql$/.test(file))) {
  throw new Error("Migration names must match NNNN_description.sql");
}
if (new Set(migrations).size !== migrations.length) {
  throw new Error("Duplicate migration filenames detected");
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

for (const file of walk(root)) {
  if (forbidden.test(readFileSync(file, "utf8"))) {
    throw new Error(`Forbidden legacy asset reference found in ${path.relative(root, file)}`);
  }
}

console.log(`Validated ${migrations.length} migration(s) and repository policy.`);
