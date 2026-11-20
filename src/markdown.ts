/**
 * 링크 추출과 anchor 목록 만들기가 같이 쓰는 마크다운 읽기 규칙이다.
 * 펜스 코드 블록과 인라인 코드를 두 곳에서 똑같이 인식하려고 한곳에 모았다.
 */

/** 한 .md 파일 안에서 찾은 링크 하나다. */
export interface FoundLink {
  /** 1부터 세는 줄 번호 */
  line: number;
  /** 제목·꺾쇠를 뗀 대상 원문. 출력에 그대로 쓴다. */
  target: string;
}

/**
 * 줄의 종류다.
 * - text: 펜스 코드 블록 밖의 보통 줄
 * - fence: 펜스를 여는 줄이나 닫는 줄
 * - code: 펜스 코드 블록 안의 줄
 */
export type LineKind = "text" | "fence" | "code";

export interface ClassifiedLine {
  line: string;
  kind: LineKind;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** 본문을 줄로 나누고 각 줄이 펜스 코드 블록의 어디에 있는지 표시한다. 맨 앞 BOM은 뗀다. */
export function classifyLines(text: string): ClassifiedLine[] {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const result: ClassifiedLine[] = [];
  let fence: { char: string; length: number } | null = null;

  for (const line of lines) {
    if (fence !== null) {
      const closing = new RegExp(`^ {0,3}(\\${fence.char}{${fence.length},})[ \\t]*$`);
      if (closing.test(line)) {
        fence = null;
        result.push({ line, kind: "fence" });
      } else {
        result.push({ line, kind: "code" });
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open !== null && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = { char: open[1][0], length: open[1].length };
      result.push({ line, kind: "fence" });
      continue;
    }
    result.push({ line, kind: "text" });
  }
  return result;
}

/**
 * 마크다운 본문에서 인라인 링크와 이미지의 대상을 뽑는다.
 * 펜스 코드 블록과 인라인 코드 안은 무시한다. 인라인 코드는 한 줄 안에서만 인식한다.
 */
export function extractLinks(text: string): FoundLink[] {
  const links: FoundLink[] = [];
  classifyLines(text).forEach(({ line, kind }, index) => {
    if (kind !== "text") return;
    for (const target of scanLine(maskInlineCode(line))) {
      links.push({ line: index + 1, target });
    }
  });
  return links;
}

/** 인라인 코드 구간을 같은 길이의 공백으로 바꾼다. 닫히지 않은 백틱은 글자로 둔다. */
export function maskInlineCode(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      out += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== "`") {
      out += ch;
      i += 1;
      continue;
    }
    let runEnd = i;
    while (runEnd < line.length && line[runEnd] === "`") runEnd += 1;
    const runLength = runEnd - i;
    const close = findBacktickRun(line, runEnd, runLength);
    if (close === -1) {
      out += line.slice(i, runEnd);
      i = runEnd;
    } else {
      const end = close + runLength;
      out += " ".repeat(end - i);
      i = end;
    }
  }
  return out;
}

/** from부터 길이가 정확히 length인 백틱 묶음의 시작 위치를 찾는다. 없으면 -1이다. */
export function findBacktickRun(line: string, from: number, length: number): number {
  let i = from;
  while (i < line.length) {
    if (line[i] !== "`") {
      i += 1;
      continue;
    }
    let runEnd = i;
    while (runEnd < line.length && line[runEnd] === "`") runEnd += 1;
    if (runEnd - i === length) return i;
    i = runEnd;
  }
  return -1;
}

/**
 * 한 줄에서 `[...](대상)`의 대상을 나온 순서대로 뽑는다.
 * 대괄호 짝을 스택으로 맞추므로 `[![a](x.png)](y.md)`처럼 겹친 경우 두 대상을 모두 낸다.
 */
function scanLine(line: string): string[] {
  const targets: string[] = [];
  const openBrackets: number[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") {
      openBrackets.push(i);
      i += 1;
      continue;
    }
    if (ch === "]" && openBrackets.length > 0) {
      openBrackets.pop();
      if (line[i + 1] === "(") {
        const parsed = parseDestination(line, i + 2);
        if (parsed !== null) {
          targets.push(parsed.target);
          i = parsed.end;
          continue;
        }
      }
    }
    i += 1;
  }
  return targets;
}

/**
 * '(' 바로 뒤 start부터 대상과 선택적 제목, 닫는 ')'를 읽는다.
 * 링크 문법이 아니면 null, 맞으면 대상 원문과 ')' 다음 위치를 돌려준다.
 */
export function parseDestination(line: string, start: number): { target: string; end: number } | null {
  let i = skipSpaces(line, start);
  let target: string;

  if (line[i] === "<") {
    let j = i + 1;
    while (j < line.length && line[j] !== ">" && line[j] !== "<") {
      j += line[j] === "\\" ? 2 : 1;
    }
    if (line[j] !== ">") return null;
    target = line.slice(i + 1, j);
    i = j + 1;
  } else {
    let j = i;
    let depth = 0;
    while (j < line.length) {
      const c = line[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === " " || c === "\t") break;
      if (c === "(") depth += 1;
      if (c === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      j += 1;
    }
    if (depth !== 0) return null;
    target = line.slice(i, Math.min(j, line.length));
    i = j;
  }

  const afterTarget = i;
  i = skipSpaces(line, i);
  if (i > afterTarget && i < line.length && line[i] !== ")") {
    const closer = TITLE_CLOSERS[line[i]];
    if (closer === undefined) return null;
    let j = i + 1;
    while (j < line.length && line[j] !== closer) {
      j += line[j] === "\\" ? 2 : 1;
    }
    if (j >= line.length) return null;
    i = skipSpaces(line, j + 1);
  }
  if (line[i] !== ")") return null;
  return { target, end: i + 1 };
}

const TITLE_CLOSERS: Record<string, string | undefined> = { '"': '"', "'": "'", "(": ")" };

function skipSpaces(line: string, from: number): number {
  let i = from;
  while (line[i] === " " || line[i] === "\t") i += 1;
  return i;
}
