import { node, type SNode } from "./node";

const API_VERSION = "1.16.1";

export function subsonicSuccess(body?: SNode): SNode {
  return node(
    "subsonic-response",
    { status: "ok", version: API_VERSION },
    body ? { single: { [body.tag]: body } } : undefined,
  );
}

export function subsonicError(code: number, message: string): SNode {
  return node(
    "subsonic-response",
    { status: "failed", version: API_VERSION },
    { single: { error: node("error", { code, message }) } },
  );
}

function attrsToJSON(attrs?: SNode["attrs"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined) out[k] = v;
  return out;
}

export function toJSON(root: SNode): unknown {
  function conv(n: SNode): unknown {
    const out: Record<string, unknown> = attrsToJSON(n.attrs);
    if (n.text !== undefined) out.value = n.text;
    if (n.single) for (const [key, child] of Object.entries(n.single)) out[key] = conv(child);
    if (n.lists) for (const [key, arr] of Object.entries(n.lists)) out[key] = arr.map(conv);
    return out;
  }
  return { [root.tag]: conv(root) };
}

function escapeXML(v: unknown): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toXML(root: SNode): string {
  function conv(n: SNode, isRoot = false): string {
    const attrPairs = Object.entries(n.attrs ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}="${escapeXML(v)}"`);
    if (isRoot) attrPairs.push('xmlns="http://subsonic.org/restapi"');
    const attrStr = attrPairs.length ? " " + attrPairs.join(" ") : "";

    const childParts: string[] = [];
    if (n.single) for (const child of Object.values(n.single)) childParts.push(conv(child));
    if (n.lists) for (const arr of Object.values(n.lists)) for (const child of arr) childParts.push(conv(child));

    const inner = childParts.length ? childParts.join("") : n.text !== undefined ? escapeXML(n.text) : "";
    if (!inner) return `<${n.tag}${attrStr}/>`;
    return `<${n.tag}${attrStr}>${inner}</${n.tag}>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>${conv(root, true)}`;
}

// Subsonic defaults to XML when `f` is omitted; clients that want JSON pass f=json.
export function respond(root: SNode, format: string | null): Response {
  if (format === "json") {
    return new Response(JSON.stringify(toJSON(root)), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return new Response(toXML(root), {
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}
