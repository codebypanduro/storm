import { describe, it, expect } from "bun:test";
import { parsePrimitive } from "../primitives/frontmatter.js";

describe("parsePrimitive", () => {
  it("parses all frontmatter fields", () => {
    const content = `---
command: bun test
description: Run tests
enabled: true
timeout: 30000
completable: true
---
Body text here`;

    const { frontmatter, body } = parsePrimitive(content);
    expect(frontmatter.command).toBe("bun test");
    expect(frontmatter.description).toBe("Run tests");
    expect(frontmatter.enabled).toBe(true);
    expect(frontmatter.timeout).toBe(30000);
    expect(frontmatter.completable).toBe(true);
    expect(body).toBe("Body text here");
  });

  it("defaults enabled to true when not specified", () => {
    const content = `---
command: echo hi
---
body`;
    const { frontmatter } = parsePrimitive(content);
    expect(frontmatter.enabled).toBe(true);
  });

  it("sets enabled to false when explicitly false", () => {
    const content = `---
enabled: false
---
body`;
    const { frontmatter } = parsePrimitive(content);
    expect(frontmatter.enabled).toBe(false);
  });

  it("handles missing optional fields as undefined", () => {
    const content = `---
command: ls
---
body`;
    const { frontmatter } = parsePrimitive(content);
    expect(frontmatter.description).toBeUndefined();
    expect(frontmatter.timeout).toBeUndefined();
    expect(frontmatter.completable).toBeUndefined();
  });

  it("trims whitespace from body", () => {
    const content = `---
command: ls
---

  body with whitespace
`;
    const { body } = parsePrimitive(content);
    expect(body).toBe("body with whitespace");
  });

  it("handles content with no frontmatter", () => {
    const content = "Just some plain body text";
    const { frontmatter, body } = parsePrimitive(content);
    expect(frontmatter.command).toBeUndefined();
    expect(frontmatter.enabled).toBe(true);
    expect(body).toBe("Just some plain body text");
  });

  it("handles empty frontmatter block", () => {
    const content = `---
---
body`;
    const { frontmatter, body } = parsePrimitive(content);
    expect(frontmatter.command).toBeUndefined();
    expect(frontmatter.enabled).toBe(true);
    expect(body).toBe("body");
  });

  it("handles multiline body", () => {
    const content = `---
command: test
---
Line one
Line two
Line three`;
    const { body } = parsePrimitive(content);
    expect(body).toBe("Line one\nLine two\nLine three");
  });
});
