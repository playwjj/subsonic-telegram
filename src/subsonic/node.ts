// Generic tree for building a Subsonic REST API response, serializable to
// either JSON or XML from the same construction. `single` children render as
// a nested object (JSON) / nested element (XML); `lists` children always
// render as an array (JSON) / repeated sibling elements (XML), even with one
// item, matching the real Subsonic server's convention for repeatable fields.
export interface SNode {
  tag: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  text?: string;
  single?: Record<string, SNode>;
  lists?: Record<string, SNode[]>;
}

export function node(
  tag: string,
  attrs?: SNode["attrs"],
  opts?: { text?: string; single?: SNode["single"]; lists?: SNode["lists"] },
): SNode {
  return { tag, attrs, text: opts?.text, single: opts?.single, lists: opts?.lists };
}
