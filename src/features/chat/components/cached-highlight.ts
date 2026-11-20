import rehypeHighlight from "rehype-highlight";

type Highlight = ReturnType<typeof rehypeHighlight>;
type Tree = Parameters<Highlight>[0];
type Element = Extract<Tree["children"][number], { type: "element" }>;

// Language registration is independent of the message and need not repeat
// on every ReactMarkdown processor construction.
const highlight = rehypeHighlight();

function closedFence(node: Element, source: string): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start == null || end == null) return false;
  const raw = source.slice(start, end);
  const opening = /^ {0,3}(`{3,}|~{3,})[^\r\n]*\r?\n/.exec(raw);
  if (!opening) return false;
  const lastLine = raw.slice(raw.lastIndexOf("\n") + 1).replace(/\r$/, "");
  const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lastLine);
  return !!closing && closing[1][0] === opening[1][0] &&
    closing[1].length >= opening[1].length;
}

/** A bounded cache owned by one Markdown component. Keep parsing the complete
 * Markdown document so later reference definitions, tables and list context
 * remain correct; reuse only syntax-highlighted code children.
 */
export function createCachedHighlighter(
  transform: Highlight = highlight,
  limits = { entries: 32, characters: 256_000 },
) {
  const cache = new Map<string, { children: Element["children"]; className: Element["properties"]["className"] }>();
  let characters = 0;
  return function cachedHighlight(options: { streaming?: boolean } = {}): Highlight {
    return (tree, file) => {
      const source = typeof file.value === "string" ? file.value : "";
      function walk(parent: Tree | Element) {
        for (const node of parent.children) {
          if (node.type !== "element") continue;
          if (parent.type === "element" && parent.tagName === "pre" && node.tagName === "code") {
            // Complex/nested fences without an unambiguous source closing
            // marker stay plain until settled, as in the previous live view.
            if (options.streaming && !closedFence(node, source)) continue;
            // The fixed Markdown pipeline gives code plain text children.
            // Fall back rather than caching unexpected structured input.
            const plain = node.children.every(child => child.type === "text");
            const key = plain ? JSON.stringify([node.properties.className ?? null,
              node.children.map(child => child.type === "text" ? child.value : "").join("")]) : "";
            const cached = key ? cache.get(key) : undefined;
            if (cached) {
              cache.delete(key);
              cache.set(key, cached);
              node.children = cached.children;
              if (cached.className !== undefined) node.properties.className = cached.className;
              continue;
            }
            // Delegate all language aliases, escaping and unknown-language
            // behavior to the existing highlighter.
            transform({ type: "root", children: [{ ...parent, children: [node] }] }, file);
            if (key && key.length <= limits.characters && limits.entries > 0) {
              while (cache.size >= limits.entries || characters + key.length > limits.characters) {
                const oldest = cache.keys().next().value;
                if (oldest === undefined) break;
                cache.delete(oldest);
                characters -= oldest.length;
              }
              cache.set(key, { children: node.children, className: node.properties.className });
              characters += key.length;
            }
          } else {
            walk(node);
          }
        }
      }
      walk(tree);
    };
  };
}

/** Shared bounded syntax-highlight cache across Markdown mounts: switching tabs
 *  or scrolling rows in/out of the virtualizer reuses highlighted code trees
 *  instead of re-running highlight.js from scratch. Callers with external
 *  mutating rehype plugins must bypass this shared cache. */
export const sharedCachedHighlighter = createCachedHighlighter(highlight, {
  entries: 256,
  characters: 2_000_000,
});
