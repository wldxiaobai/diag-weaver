import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SnapshotStore } from "../src/store.js";

const temps: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "diag-weaver-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SnapshotStore", () => {
  it("does not create directories on construct, list, or read", async () => {
    const root = path.join(await tempDir(), "store");
    const store = new SnapshotStore(root);
    expect(await store.hasRoot()).toBe(false);
    expect(await store.hasCurrent()).toBe(false);
    expect(await store.readCurrent()).toBeNull();
    expect(await store.list()).toEqual([]);
    expect(await store.hasRoot()).toBe(false);
  });

  it("creates the store root only when writing current", async () => {
    const root = path.join(await tempDir(), "store");
    const store = new SnapshotStore(root);
    await store.writeCurrent("<mxfile/>");
    expect(await store.hasRoot()).toBe(true);
    expect(await store.readCurrent()).toBe("<mxfile/>");
  });

  it("snapshots and restores by label", async () => {
    const root = path.join(await tempDir(), "store");
    const store = new SnapshotStore(root);
    const first = await store.snapshot("评审前", "<mxfile>a</mxfile>");
    await store.snapshot("broken", "<mxfile>b</mxfile>");
    expect(first.label).toBe("评审前");
    const xml = await store.restore("评审前");
    expect(xml).toBe("<mxfile>a</mxfile>");
    expect(await store.readCurrent()).toBe("<mxfile>a</mxfile>");
  });

  it("exportTo writes only the explicit path", async () => {
    const workspace = await tempDir();
    const root = path.join(await tempDir(), "store");
    const store = new SnapshotStore(root);
    const dest = path.join(workspace, "docs", "architecture.drawio");
    await store.exportTo(dest, "<mxfile>x</mxfile>");
    expect(await readFile(dest, "utf8")).toBe("<mxfile>x</mxfile>");
    expect(await readdir(workspace)).toEqual(["docs"]);
    expect(await store.hasRoot()).toBe(false);
  });
});
