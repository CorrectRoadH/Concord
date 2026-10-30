import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { Schema } from "effect";

import { IssuePlanCorrupt } from "../../model/index.js";

import { IssuePlanReceiptSchema, type IssuePlanReceipt } from "../../model/index.js";

export const receiptName = (receipt: IssuePlanReceipt): string => {
  if (!/^[0-9a-f-]{36}$/u.test(receipt.id)) throw new IssuePlanCorrupt({ receiptId: receipt.id, message: "receipt id is not a UUID" });
  return `${receipt.id}.json`;
};
export const encoded = (receipt: IssuePlanReceipt) => JSON.stringify(Schema.decodeUnknownSync(IssuePlanReceiptSchema, { onExcessProperty: "error" })(receipt));
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const detail = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
export const isCode = (cause: unknown, code: string) => typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;

export async function gitDirectory(root: string): Promise<string> {
  const dotGit = resolve(root, ".git");
  const stat = await lstat(dotGit);
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) throw new Error(".git is neither a directory nor a gitdir file");
  const source = await readFile(dotGit, "utf8");
  const match = /^gitdir:\s*(.+)\s*$/u.exec(source);
  if (match?.[1] === undefined) throw new Error(".git gitdir file is malformed");
  return isAbsolute(match[1]) ? resolve(match[1]) : resolve(dirname(dotGit), match[1]);
}
