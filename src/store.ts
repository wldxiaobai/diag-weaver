import { mkdir, readdir, readFile, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SnapshotInfo } from "./types.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function defaultStoreRoot(): string {
  if (process.env.DIAG_WEAVER_STORE) return path.resolve(process.env.DIAG_WEAVER_STORE);
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "diag-weaver");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "diag-weaver");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "diag-weaver");
}

export function sanitizeLabel(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/\.+$/g, "")
    .slice(0, 80);
  return cleaned || "snapshot";
}

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function labelFromFile(file: string): string {
  const stem = file.replace(/\.drawio$/i, "");
  return stem.replace(/^\d{8}-\d{6}-/, "");
}

export class SnapshotStore {
  constructor(private readonly root: string = defaultStoreRoot()) {}

  rootDir(): string {
    return this.root;
  }

  currentFile(): string {
    return path.join(this.root, "current.drawio");
  }

  snapshotsDir(): string {
    return path.join(this.root, "snapshots");
  }

  async hasRoot(): Promise<boolean> {
    return exists(this.root);
  }

  async hasCurrent(): Promise<boolean> {
    return exists(this.currentFile());
  }

  async readCurrent(): Promise<string | null> {
    if (!(await this.hasCurrent())) return null;
    return readFile(this.currentFile(), "utf8");
  }

  async writeCurrent(xml: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.currentFile(), xml, "utf8");
  }

  async snapshot(label: string, xml: string): Promise<SnapshotInfo> {
    await this.writeCurrent(xml);
    await mkdir(this.snapshotsDir(), { recursive: true });
    const createdAt = new Date().toISOString();
    const safe = sanitizeLabel(label);
    const file = `${stamp()}-${safe}.drawio`;
    const dest = path.join(this.snapshotsDir(), file);
    await writeFile(dest, xml, "utf8");
    return { label: safe, file, path: dest, createdAt };
  }

  async list(): Promise<SnapshotInfo[]> {
    if (!(await exists(this.snapshotsDir()))) return [];
    const names = await readdir(this.snapshotsDir());
    return names
      .filter((name) => name.toLowerCase().endsWith(".drawio"))
      .sort()
      .reverse()
      .map((file) => ({
        label: labelFromFile(file),
        file,
        path: path.join(this.snapshotsDir(), file),
        createdAt: "",
      }));
  }

  async restore(label: string): Promise<string> {
    const list = await this.list();
    const needle = sanitizeLabel(label);
    const exact = list.filter(
      (item) => item.label === needle || item.label === label.trim() || item.file === label,
    );
    const hits = exact.length ? exact : list.filter((item) => item.label.includes(needle) || item.file.includes(needle));
    if (hits.length === 0) {
      const known = list.map((item) => item.label).join(", ") || "(none)";
      throw new Error(`snapshot not found: ${label}. known: ${known}`);
    }
    if (hits.length > 1 && exact.length !== 1) {
      throw new Error(`snapshot label is ambiguous: ${label}. matches: ${hits.map((h) => h.file).join(", ")}`);
    }
    const chosen = exact.length === 1 ? exact[0] : hits[0];
    const xml = await readFile(chosen.path, "utf8");
    await this.writeCurrent(xml);
    return xml;
  }

  async exportTo(absPath: string, xml: string): Promise<void> {
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, xml, "utf8");
  }
}
