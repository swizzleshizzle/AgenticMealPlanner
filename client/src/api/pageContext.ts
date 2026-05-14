import type { PageContext } from "./chat";

interface LocationLike {
  pathname: string;
}

const PATTERNS: { re: RegExp; key: keyof Omit<PageContext, "path" | "weekStartDate"> }[] = [
  { re: /^\/plans\/(\d+)\/?$/, key: "planId" },
  { re: /^\/meals\/(\d+)\/?$/, key: "mealId" },
];

export function derivePageContext(location: LocationLike): PageContext {
  const ctx: PageContext = { path: location.pathname };
  for (const { re, key } of PATTERNS) {
    const m = location.pathname.match(re);
    if (m) {
      ctx[key] = Number(m[1]);
      break;
    }
  }
  return ctx;
}
