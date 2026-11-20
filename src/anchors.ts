import { classifyLines, findBacktickRun, maskInlineCode, parseDestination } from "./markdown.js";

/**
 * .md 본문에서 링크가 가리킬 수 있는 anchor 이름을 모두 모은다.
 * 펜스 코드 블록 밖의 제목에서 만든 slug와 HTML 태그의 id·name 속성값이다.
 * slug는 문서 순서대로 만들어야 중복 번호가 맞으므로 줄을 한 번만 앞에서부터 훑는다.
 */
export function collectAnchors(text: string): Set<string> {
  const anchors = new Set<string>();
  const slugger = new Slugger();
  const lines = classifyLines(text);

  lines.forEach(({ line, kind }, index) => {
    if (kind !== "text") return;

    const atx = atxHeadingText(line);
    if (atx !== null) {
      anchors.add(slugger.slug(headingInlineText(atx)));
    } else if (SETEXT_UNDERLINE.test(line) && index > 0) {
      const prev = lines[index - 1];
      if (prev.kind === "text" && prev.line.trim() !== "" && atxHeadingText(prev.line) === null) {
        anchors.add(slugger.slug(headingInlineText(prev.line.trim())));
      }
    }

    // HTML anchor는 slug 변환 없이 적힌 그대로 넣고, 중복 계산(slugger)에는 넣지 않는다.
    for (const value of htmlAnchors(maskInlineCode(line))) anchors.add(value);
  });
  return anchors;
}

const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t](.*))?$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

/** `#` 제목이면 닫는 `#` 묶음과 앞뒤 공백을 뗀 제목 글자를, 아니면 null을 돌려준다. */
function atxHeadingText(line: string): string | null {
  const match = ATX_HEADING.exec(line);
  if (match === null) return null;
  let content = (match[1] ?? "").replace(/[ \t]+$/, "");
  // 닫는 묶음은 앞에 공백이 있어야 한다. 내용 전체가 `#`이면 그것도 닫는 묶음이다.
  content = /^#+$/.test(content) ? "" : content.replace(/[ \t]+#+$/, "");
  return content.trim();
}

/**
 * 제목 글자 안의 마크다운을 보이는 글자로 바꾼다.
 * 링크 `[t](u)`와 이미지 `![a](u)`는 `t`·`a`만 남기고, 인라인 코드는 백틱만 뗀다.
 * 그 밖의 기호는 그대로 두고 slug 변환에서 지운다.
 */
export function headingInlineText(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") {
      const runEnd = backtickRunEnd(text, i);
      const runLength = runEnd - i;
      const close = findBacktickRun(text, runEnd, runLength);
      if (close === -1) {
        out += text.slice(i, runEnd);
        i = runEnd;
      } else {
        out += text.slice(runEnd, close);
        i = close + runLength;
      }
      continue;
    }
    const isImage = ch === "!" && text[i + 1] === "[";
    if (ch === "[" || isImage) {
      const open = isImage ? i + 1 : i;
      const link = matchLink(text, open);
      if (link !== null) {
        out += headingInlineText(text.slice(open + 1, link.textEnd));
        i = link.end;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * open 위치의 '['에서 시작하는 `[글자](대상)`를 찾는다.
 * 짝이 맞는 ']'를 찾을 때 백슬래시 escape와 인라인 코드 안의 괄호는 세지 않는다.
 */
function matchLink(text: string, open: number): { textEnd: number; end: number } | null {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      const runEnd = backtickRunEnd(text, i);
      const close = findBacktickRun(text, runEnd, runEnd - i);
      i = close === -1 ? runEnd : close + (runEnd - i);
      continue;
    }
    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        if (text[i + 1] !== "(") return null;
        const parsed = parseDestination(text, i + 2);
        return parsed === null ? null : { textEnd: i, end: parsed.end };
      }
    }
    i += 1;
  }
  return null;
}

function backtickRunEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && text[i] === "`") i += 1;
  return i;
}

const HTML_TAG =
  /<[A-Za-z][A-Za-z0-9-]*((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const HTML_ATTRIBUTE = /\s+([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|[^\s"'=<>`]+))?/g;

/** 한 줄의 HTML 여는 태그에서 따옴표로 감싼 id·name 속성값을 뽑는다. */
function htmlAnchors(line: string): string[] {
  const values: string[] = [];
  for (const tag of line.matchAll(HTML_TAG)) {
    for (const attr of tag[1].matchAll(HTML_ATTRIBUTE)) {
      if (attr[1] !== "id" && attr[1] !== "name") continue;
      const value = attr[2] ?? attr[3];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

/**
 * 제목 글자를 GitHub slug로 바꾼다(github-slugger 방식).
 * 소문자로 바꾸고, Unicode 범주 L·M·N과 `_`·`-`·공백 밖의 글자를 지우고, 공백 하나마다 `-` 하나로 바꾼다.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-");
}

/** 문서 하나 안의 slug 중복에 `-1`, `-2`, …를 붙인다. github-slugger의 occurrences 규칙을 따른다. */
export class Slugger {
  private readonly occurrences = new Map<string, number>();

  slug(text: string): string {
    const original = slugify(text);
    let result = original;
    while (this.occurrences.has(result)) {
      const count = (this.occurrences.get(original) ?? 0) + 1;
      this.occurrences.set(original, count);
      result = `${original}-${count}`;
    }
    this.occurrences.set(result, 0);
    return result;
  }
}
