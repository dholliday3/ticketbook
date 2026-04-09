import { describe, test, expect } from "bun:test";
import {
  parseContextRefs,
  splitByContextRefs,
  renderContextRefMarker,
} from "./context-refs.js";

describe("parseContextRefs", () => {
  test("parses a task marker with title", () => {
    const text = 'Check <task id="TKTB-025" title="Agent handoff" /> before shipping.';
    const refs = parseContextRefs(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "task",
      id: "TKTB-025",
      title: "Agent handoff",
    });
    expect(text.slice(refs[0].start, refs[0].end)).toBe(
      '<task id="TKTB-025" title="Agent handoff" />',
    );
  });

  test("parses a plan marker without title", () => {
    const text = '<plan id="PLAN-006" />';
    const refs = parseContextRefs(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "plan",
      id: "PLAN-006",
      title: null,
    });
  });

  test("parses multiple markers in order", () => {
    const text =
      'Start with <task id="TKTB-001" /> then <plan id="PLAN-006" title="Rename" />.';
    const refs = parseContextRefs(text);
    expect(refs).toHaveLength(2);
    expect(refs[0].kind).toBe("task");
    expect(refs[0].id).toBe("TKTB-001");
    expect(refs[1].kind).toBe("plan");
    expect(refs[1].id).toBe("PLAN-006");
    expect(refs[1].title).toBe("Rename");
  });

  test("decodes HTML entities in title", () => {
    const text = '<task id="TKTB-099" title="A &quot;tricky&quot; one" />';
    const refs = parseContextRefs(text);
    expect(refs[0].title).toBe('A "tricky" one');
  });

  test("ignores malformed tags", () => {
    const text = '<task id="TKTB-001"> not self-closing </task>';
    expect(parseContextRefs(text)).toHaveLength(0);
  });

  test("ignores unknown kinds", () => {
    const text = '<issue id="X-1" />';
    expect(parseContextRefs(text)).toHaveLength(0);
  });

  test("tolerates extra whitespace before self-close", () => {
    const text = '<task id="TKTB-001"    />';
    expect(parseContextRefs(text)).toHaveLength(1);
  });
});

describe("splitByContextRefs", () => {
  test("returns a single text span when no markers", () => {
    expect(splitByContextRefs("just words")).toEqual([
      { type: "text", content: "just words" },
    ]);
  });

  test("returns an empty array for empty input", () => {
    expect(splitByContextRefs("")).toEqual([]);
  });

  test("interleaves text and refs in order", () => {
    const text =
      'See <task id="TKTB-025" title="Foo" /> and <plan id="PLAN-006" /> please.';
    const spans = splitByContextRefs(text);
    expect(spans).toHaveLength(5);
    expect(spans[0]).toEqual({ type: "text", content: "See " });
    expect(spans[1].type).toBe("ref");
    expect(spans[2]).toEqual({ type: "text", content: " and " });
    expect(spans[3].type).toBe("ref");
    expect(spans[4]).toEqual({ type: "text", content: " please." });
  });

  test("handles leading and trailing refs without empty spans", () => {
    const text = '<task id="TKTB-001" /><plan id="PLAN-002" />';
    const spans = splitByContextRefs(text);
    expect(spans).toHaveLength(2);
    expect(spans[0].type).toBe("ref");
    expect(spans[1].type).toBe("ref");
  });
});

describe("renderContextRefMarker", () => {
  test("renders with title", () => {
    expect(
      renderContextRefMarker({ kind: "task", id: "TKTB-025", title: "Hello" }),
    ).toBe('<task id="TKTB-025" title="Hello" />');
  });

  test("renders without title", () => {
    expect(renderContextRefMarker({ kind: "plan", id: "PLAN-006" })).toBe(
      '<plan id="PLAN-006" />',
    );
  });

  test("encodes HTML-dangerous characters in title", () => {
    expect(
      renderContextRefMarker({
        kind: "task",
        id: "TKTB-099",
        title: 'Fix "this" & <that>',
      }),
    ).toBe('<task id="TKTB-099" title="Fix &quot;this&quot; &amp; &lt;that&gt;" />');
  });

  test("round-trips through parse", () => {
    const marker = renderContextRefMarker({
      kind: "task",
      id: "TKTB-100",
      title: 'Has "quotes" and & ampersands',
    });
    const refs = parseContextRefs(`prefix ${marker} suffix`);
    expect(refs).toHaveLength(1);
    expect(refs[0].title).toBe('Has "quotes" and & ampersands');
  });
});
