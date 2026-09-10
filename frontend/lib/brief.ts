export interface BriefSection {
  heading: string | null;
  content: string;
}

const HEADING_COLON_INSIDE = /^\*\*(.+?):\*\*\s*/;
const HEADING_COLON_OUTSIDE = /^\*\*(.+?)\*\*:\s*/;

function matchHeading(block: string): { heading: string; rest: string } | null {
  const match = block.match(HEADING_COLON_INSIDE) || block.match(HEADING_COLON_OUTSIDE);
  if (!match) return null;
  return {
    heading: match[1].trim(),
    rest: block.slice(match[0].length).trim(),
  };
}

/** Split a producer brief into labeled sections (`**Heading:** …`). */
export function parseBriefSections(summary: string): BriefSection[] {
  const blocks = (summary || "")
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const sections: BriefSection[] = [];

  for (let i = 0; i < blocks.length; i += 1) {
    const parsed = matchHeading(blocks[i]);
    if (!parsed) {
      sections.push({ heading: null, content: blocks[i] });
      continue;
    }

    let content = parsed.rest;
    if (!content && i + 1 < blocks.length && !matchHeading(blocks[i + 1])) {
      i += 1;
      content = blocks[i];
    }
    sections.push({ heading: parsed.heading, content });
  }

  return sections;
}
