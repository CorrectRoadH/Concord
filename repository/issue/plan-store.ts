import { createHash, randomUUID } from "node:crypto";
import { lstat, link, mkdir, readFile, unlink, writeFile, open, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { Effect, Layer, Schema } from "effect";

import { IssuePlanConsumed, IssuePlanCorrupt, IssuePlanExpired, IssuePlanIoError, IssuePlanNotPlanned } from "./errors.js";
import { IssuePlanStore, type IssuePlanStoreService } from "./domain.js";
import { IssuePlanReceiptSchema, type IssuePlanReceipt } from "./model.js";

const receiptName = (receipt: IssuePlanReceipt): string => {
  if (!/^[0-9a-f-]{36}$/u.test(receipt.id)) throw new IssuePlanCorrupt({ receiptId: receipt.id, message: "receipt id is not a UUID" });
  return `${receipt.id}.json`;
};
const encoded = (receipt: IssuePlanReceipt) => JSON.stringify(Schema.decodeUnknownSync(IssuePlanReceiptSchema, { onExcessProperty: "error" })(receipt));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const detail = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const isCode = (cause: unknown, code: string) => typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;

async function gitDirectory(root: string): Promise<string> {
  const dotGit = resolve(root, ".git");
  const stat = await lstat(dotGit);
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) throw new Error(".git is neither a directory nor a gitdir file");
  const source = await readFile(dotGit, "utf8");
  const match = /^gitdir:\s*(.+)\s*$/u.exec(source);
  if (match?.[1] === undefined) throw new Error(".git gitdir file is malformed");
  return isAbsolute(match[1]) ? resolve(match[1]) : resolve(dirname(dotGit), match[1]);
}

/** Git-private, cross-process receipt coordination. No authorization is stored here. */
export const makeNodeIssuePlanStore = (root: string): IssuePlanStoreService => {
  const base = async () => {
    const directory = join(await gitDirectory(root), "concord", "issue-plan", "v1");
    await Promise.all([mkdir(join(directory, "planned"), { recursive: true, mode: 0o700 }), mkdir(join(directory, "consumed"), { recursive: true, mode: 0o700 })]);
    return directory;
  };
  const pathFor = async (receipt: IssuePlanReceipt, state: "planned" | "consumed") => join(await base(), state, receiptName(receipt));
  const validateId = (id: string) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id)) throw new IssuePlanCorrupt({ receiptId: id, message: "receipt id is not a UUID" }); };
  return {
    read: (id) => Effect.tryPromise({
      try: async () => {
        validateId(id);
        const directory = await base();
        const consumed = join(directory, "consumed", `${id}.json`);
        try { await lstat(consumed); throw new IssuePlanConsumed({ receiptId: id }); }
        catch (cause) { if (!isCode(cause, "ENOENT")) throw cause; }
        let source: string;
        try { source = await readFile(join(directory, "planned", `${id}.json`), "utf8"); }
        catch (cause) { if (isCode(cause, "ENOENT")) throw new IssuePlanNotPlanned({ receiptId: id }); throw cause; }
        try {
          const receipt = Schema.decodeUnknownSync(IssuePlanReceiptSchema, { onExcessProperty: "error" })(JSON.parse(source));
          if (receipt.id !== id) throw new Error("receipt ID differs");
          return receipt;
        } catch { throw new IssuePlanCorrupt({ receiptId: id, message: "stored receipt is invalid" }); }
      },
      catch: cause => cause instanceof IssuePlanConsumed || cause instanceof IssuePlanNotPlanned || cause instanceof IssuePlanCorrupt ? cause : new IssuePlanIoError({ operation: "read", path: root, message: detail(cause) }),
    }),
    outcome: (receipt, outcome) => Effect.tryPromise({
      try: async () => {
        const destination = (await pathFor(receipt, "consumed")).replace(/\.json$/u, ".outcome.json");
        const temporary = `${destination}.tmp-${randomUUID()}`;
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(outcome), "utf8"); await file.sync(); } finally { await file.close(); }
        await rename(temporary, destination);
      },
      catch: cause => new IssuePlanIoError({ operation: "outcome", path: root, message: detail(cause) }),
    }),
    plan: (receipt) => Effect.tryPromise({
      try: async () => {
        const path = await pathFor(receipt, "planned");
        const source = encoded(receipt);
        try { await writeFile(path, source, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
        catch (cause) {
          if (isCode(cause, "EEXIST")) throw new IssuePlanCorrupt({ receiptId: receipt.id, message: "receipt id is already planned" });
          throw cause;
        }
      },
      catch: (cause) => cause instanceof IssuePlanCorrupt ? cause : new IssuePlanIoError({ operation: "plan", path: root, message: detail(cause) }),
    }),
    consume: (receipt, now) => Effect.tryPromise({
      try: async () => {
        if (now >= receipt.expiresAt) throw new IssuePlanExpired({ receiptId: receipt.id });
        const planned = await pathFor(receipt, "planned");
        const consumed = await pathFor(receipt, "consumed");
        let stored: string;
        try { stored = await readFile(planned, "utf8"); }
        catch (cause) {
          if (isCode(cause, "ENOENT")) {
            try { await lstat(consumed); throw new IssuePlanConsumed({ receiptId: receipt.id }); }
            catch (status) { if (status instanceof IssuePlanConsumed) throw status; if (isCode(status, "ENOENT")) throw new IssuePlanNotPlanned({ receiptId: receipt.id }); throw status; }
          }
          throw cause;
        }
        if (stored !== encoded(receipt)) throw new IssuePlanCorrupt({ receiptId: receipt.id, message: `stored receipt digest ${digest(stored)} does not match supplied receipt` });
        try { await link(planned, consumed); }
        catch (cause) {
          if (isCode(cause, "EEXIST")) throw new IssuePlanConsumed({ receiptId: receipt.id });
          if (isCode(cause, "ENOENT")) throw new IssuePlanConsumed({ receiptId: receipt.id });
          throw cause;
        }
        try { await unlink(planned); }
        catch (cause) { throw new IssuePlanIoError({ operation: "consume", path: planned, message: detail(cause) }); }
      },
      catch: (cause) => cause instanceof IssuePlanExpired || cause instanceof IssuePlanConsumed || cause instanceof IssuePlanNotPlanned || cause instanceof IssuePlanCorrupt || cause instanceof IssuePlanIoError
        ? cause
        : new IssuePlanIoError({ operation: "consume", path: root, message: detail(cause) }),
    }),
  };
};

/** Applications provide this at their Node composition edge. */
export const NodeIssuePlanStoreLive = (root: string) => Layer.succeed(IssuePlanStore, makeNodeIssuePlanStore(root));
