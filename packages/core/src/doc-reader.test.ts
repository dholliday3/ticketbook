import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listDocs,
  getDoc,
  searchDocs,
  getDocProjects,
  getDocTags,
} from "./doc-reader.js";
import { createDoc } from "./doc-writer.js";

describe("doc-reader", () => {
  let tasksDir: string;
  let docsDir: string;

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-doc-reader-"));
    tasksDir = join(root, ".tasks");
    docsDir = join(root, ".docs");
    await mkdir(tasksDir, { recursive: true });
    await mkdir(docsDir, { recursive: true });
    await writeFile(join(docsDir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(tasksDir, { recursive: true, force: true });
    await rm(docsDir, { recursive: true, force: true });
  });

  test("listDocs returns empty array for empty directory", async () => {
    expect(await listDocs(docsDir)).toEqual([]);
  });

  test("listDocs returns empty array for non-existent directory", async () => {
    expect(await listDocs(join(docsDir, "missing"))).toEqual([]);
  });

  test("listDocs finds created docs", async () => {
    await createDoc(tasksDir, docsDir, { title: "First Doc" });
    await createDoc(tasksDir, docsDir, { title: "Second Doc" });

    const docs = await listDocs(docsDir);
    expect(docs).toHaveLength(2);
  });

  test("listDocs filters by project", async () => {
    await createDoc(tasksDir, docsDir, { title: "Alpha", project: "alpha" });
    await createDoc(tasksDir, docsDir, { title: "Beta", project: "beta" });

    const docs = await listDocs(docsDir, { project: "alpha" });
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Alpha");
  });

  test("listDocs filters by tags", async () => {
    await createDoc(tasksDir, docsDir, {
      title: "Tagged",
      tags: ["editor", "ux"],
    });
    await createDoc(tasksDir, docsDir, { title: "Other", tags: ["infra"] });

    const docs = await listDocs(docsDir, { tags: ["editor"] });
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Tagged");
  });

  test("listDocs filters by search", async () => {
    await createDoc(tasksDir, docsDir, {
      title: "Editor Architecture",
      body: "Rendering and layout notes",
    });
    await createDoc(tasksDir, docsDir, { title: "Unrelated" });

    const docs = await listDocs(docsDir, { search: "layout" });
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Editor Architecture");
  });

  test("getDoc returns a doc by ID", async () => {
    const created = await createDoc(tasksDir, docsDir, { title: "Find Me" });
    const found = await getDoc(docsDir, created.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Find Me");
  });

  test("searchDocs finds matches in title and body", async () => {
    await createDoc(tasksDir, docsDir, {
      title: "Workbench",
      body: "Sidebar and tabs",
    });
    await createDoc(tasksDir, docsDir, { title: "Other" });

    const docs = await searchDocs(docsDir, "sidebar");
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Workbench");
  });

  test("getDocProjects returns unique project names", async () => {
    await createDoc(tasksDir, docsDir, { title: "A", project: "alpha" });
    await createDoc(tasksDir, docsDir, { title: "B", project: "beta" });
    await createDoc(tasksDir, docsDir, { title: "C", project: "alpha" });

    expect(await getDocProjects(docsDir)).toEqual(["alpha", "beta"]);
  });

  test("getDocTags returns unique tags", async () => {
    await createDoc(tasksDir, docsDir, { title: "A", tags: ["editor", "ux"] });
    await createDoc(tasksDir, docsDir, { title: "B", tags: ["editor", "layout"] });

    expect(await getDocTags(docsDir)).toEqual(["editor", "layout", "ux"]);
  });
});
