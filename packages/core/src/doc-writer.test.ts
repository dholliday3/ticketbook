import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import {
  createDoc,
  updateDoc,
  deleteDoc,
  restoreDoc,
} from "./doc-writer.js";

describe("doc-writer", () => {
  let rootDir: string;
  let docsDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "relay-doc-writer-"));
    docsDir = join(rootDir, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFile(join(docsDir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("creates a doc file with correct frontmatter", async () => {
    const doc = await createDoc(rootDir, docsDir, { title: "Reference Doc" });

    expect(doc.id).toBe("DOC-001");
    expect(doc.title).toBe("Reference Doc");

    const files = await readdir(docsDir);
    const mdFile = files.find((file) => file.endsWith(".md"));
    expect(mdFile).toBe("DOC-001-reference-doc.md");

    const raw = await readFile(join(docsDir, mdFile!), "utf-8");
    const { data } = matter(raw);
    expect(data.id).toBe("DOC-001");
    expect(data.title).toBe("Reference Doc");
  });

  test("normalizes tags on write", async () => {
    const doc = await createDoc(rootDir, docsDir, {
      title: "Tagged",
      tags: ["  Editor  ", "EDITOR", "ux"],
    });
    expect(doc.tags).toEqual(["editor", "ux"]);
  });

  test("includes body content", async () => {
    const doc = await createDoc(rootDir, docsDir, {
      title: "With Body",
      body: "## Notes\n\nSomething useful",
    });
    expect(doc.body).toBe("## Notes\n\nSomething useful");
  });

  test("uses custom prefix from config", async () => {
    await writeFile(
      join(rootDir, "config.yaml"),
      "prefix: TKT\nplanPrefix: PLAN\ndocPrefix: REF\n",
      "utf-8",
    );
    const doc = await createDoc(rootDir, docsDir, { title: "Custom Prefix" });
    expect(doc.id).toBe("REF-001");
  });

  test("updates frontmatter fields", async () => {
    const doc = await createDoc(rootDir, docsDir, { title: "Original" });
    const updated = await updateDoc(docsDir, doc.id, {
      project: "relay",
      tags: ["editor"],
    });

    expect(updated.project).toBe("relay");
    expect(updated.tags).toEqual(["editor"]);
  });

  test("clears optional fields when set to null", async () => {
    const doc = await createDoc(rootDir, docsDir, {
      title: "Project",
      project: "relay",
    });
    const updated = await updateDoc(docsDir, doc.id, { project: null });
    expect(updated.project).toBeUndefined();
  });

  test("updates body content", async () => {
    const doc = await createDoc(rootDir, docsDir, {
      title: "Body",
      body: "Original",
    });
    const updated = await updateDoc(docsDir, doc.id, { body: "Updated" });
    expect(updated.body).toBe("Updated");
  });

  test("archives a doc by default", async () => {
    const doc = await createDoc(rootDir, docsDir, { title: "To Archive" });
    await deleteDoc(rootDir, docsDir, doc.id);

    const mainFiles = await readdir(docsDir);
    expect(mainFiles.filter((file) => file.endsWith(".md"))).toHaveLength(0);

    const archiveFiles = await readdir(join(docsDir, ".archive"));
    expect(archiveFiles.filter((file) => file.endsWith(".md"))).toHaveLength(1);
  });

  test("hard-deletes a doc when config says so", async () => {
    await writeFile(
      join(rootDir, "config.yaml"),
      "prefix: TASK\nplanPrefix: PLAN\ndocPrefix: DOC\ndeleteMode: hard\n",
      "utf-8",
    );
    const doc = await createDoc(rootDir, docsDir, { title: "To Delete" });
    await deleteDoc(rootDir, docsDir, doc.id);

    const files = await readdir(docsDir);
    expect(files.filter((file) => file.endsWith(".md"))).toHaveLength(0);
  });

  test("restores an archived doc", async () => {
    const doc = await createDoc(rootDir, docsDir, { title: "Archived" });
    await deleteDoc(rootDir, docsDir, doc.id);

    const restored = await restoreDoc(docsDir, doc.id);
    expect(restored.id).toBe(doc.id);
    expect(restored.title).toBe("Archived");
  });
});
