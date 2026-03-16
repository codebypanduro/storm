import matter from "gray-matter";
import type { PrimitiveFrontmatter } from "../core/types.js";

export interface ParsedPrimitive {
  frontmatter: PrimitiveFrontmatter;
  body: string;
}

export function parsePrimitive(content: string): ParsedPrimitive {
  const { data, content: body } = matter(content);

  const frontmatter: PrimitiveFrontmatter = {
    command: data.command as string | undefined,
    description: data.description as string | undefined,
    enabled: data.enabled !== false, // default true
    timeout: data.timeout as number | undefined,
    completable: data.completable as boolean | undefined,
  };

  return { frontmatter, body: body.trim() };
}
