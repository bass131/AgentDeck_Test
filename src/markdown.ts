/**
 * 링크 추출과 anchor 목록 만들기가 같이 쓰는 마크다운 읽기 규칙이다.
 * 펜스 코드 블록과 인라인 코드를 두 곳에서 똑같이 인식하려고 한곳에 모았다.
 */

/**
 * 한 .md 파일 안에서 찾은 검사 항목 하나다.
 * - link: 인라인 링크·이미지. target은 제목·꺾쇠를 뗀 대상 원문이다.
 * - definition: 참조 정의 `[라벨]: 대상`. target은 제목·꺾쇠를 뗀 대상 원문이다.
 * - reference: 전체형 `[text][ref]`·축약형 `[ref][]`(이미지형 포함). label은 적힌 원문 라벨이다.
 */
export type FoundItem =
  | { line: number; kind: "link"; target: string }
  | { line: number; kind: "definition"; label: string; target: string }
  | { line: number; kind: "reference"; label: string };

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
 * 마크다운 본문에서 인라인 링크·이미지, 참조 정의, 참조를 문서 순서대로 뽑는다.
 * 펜스 코드 블록과 인라인 코드 안은 무시한다. 인라인 코드는 한 줄 안에서만 인식한다.
 * 정의 줄은 줄 전체가 정의이므로 그 줄에서 링크·참조를 따로 찾지 않는다.
 * 한 줄 안에서는 링크 문법이 끝나는 위치 순이고, 겹치면 안쪽이 먼저다.
 */
export function extractItems(text: string): FoundItem[] {
  const items: FoundItem[] = [];
  classifyLines(text).forEach(({ line, kind }, index) => {
    if (kind !== "text") return;
    const lineNumber = index + 1;
    const definition = parseDefinition(line);
    if (definition !== null) {
      items.push({ line: lineNumber, kind: "definition", ...definition });
      return;
    }
    for (const found of scanLine(maskInlineCode(line), line)) {
      items.push(
        found.kind === "link"
          ? { line: lineNumber, kind: "link", target: found.text }
          : { line: lineNumber, kind: "reference", label: found.text },
      );
    }
  });
  return items;
}

/** 라벨 비교용 정규화다. 앞뒤 공백을 떼고, 연속 공백을 하나로 바꾸고, 소문자로 바꾼다. */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

const DEFINITION_LABEL = /^ {0,3}\[/;

/**
 * 줄 하나가 참조 정의 `[라벨]: 대상 "제목"`이면 라벨 원문과 대상 원문을, 아니면 null을 돌려준다.
 * 라벨은 비어 있지 않고 escape 안 된 대괄호가 없어야 한다. `^`로 시작하는 라벨(각주)은 정의가 아니다.
 * `]:` 뒤에 공백이 있어야 하고, 대상이 비면 정의가 아니다. 제목 뒤에는 공백만 올 수 있다.
 */
export function parseDefinition(line: string): { label: string; target: string } | null {
  const lead = DEFINITION_LABEL.exec(line);
  if (lead === null) return null;
  const labelStart = lead[0].length;
  const labelEnd = findLabelEnd(line, labelStart);
  if (labelEnd === -1) return null;
  const label = line.slice(labelStart, labelEnd);
  if (label.trim() === "" || label.startsWith("^")) return null;
  if (line[labelEnd + 1] !== ":") return null;
  const afterColon = labelEnd + 2;
  if (line[afterColon] !== " " && line[afterColon] !== "\t") return null;

  const parsed = readDestinationAndTitle(line, afterColon);
  if (parsed === null || parsed.target === "" || parsed.end !== line.length) return null;
  return { label, target: parsed.target };
}

/**
 * '[' 바로 뒤 start부터 라벨을 닫는 ']' 위치를 찾는다.
 * 백슬래시 escape는 건너뛴다. 그 전에 '['가 나오거나 줄이 끝나면 -1이다.
 */
function findLabelEnd(line: string, start: number): number {
  let i = start;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") return -1;
    if (ch === "]") return i;
    i += 1;
  }
  return -1;
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
 * 한 줄에서 인라인 링크 `[...](대상)`의 대상과 참조 `[...][라벨]`·`[라벨][]`의 라벨을 뽑는다.
 * line은 인라인 코드를 가린 줄이고, original은 가리기 전 줄이다. 둘은 길이가 같다.
 * 구조는 line에서 찾고, 찍을 라벨 원문은 original에서 같은 위치로 자른다.
 *
 * 대괄호 짝을 스택으로 맞추므로 `[![a](x.png)](y.md)`처럼 겹친 경우 둘 다 낸다.
 * 항목을 문법이 끝나는 위치에서 내고 그 뒤로 건너뛰므로, 낸 순서가 곧 끝나는 위치 순이다.
 * 겹치면 안쪽이 먼저 끝나므로 먼저 나온다.
 */
function scanLine(line: string, original: string): { kind: "link" | "reference"; text: string }[] {
  const found: { kind: "link" | "reference"; text: string }[] = [];
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
      const open = openBrackets.pop() as number;
      if (line[i + 1] === "(") {
        const parsed = parseDestination(line, i + 2);
        if (parsed !== null) {
          found.push({ kind: "link", text: parsed.target });
          i = parsed.end;
          continue;
        }
      } else if (line[i + 1] === "[") {
        const reference = readReference(line, original, open, i);
        if (reference !== null) {
          if (reference.label !== null) found.push({ kind: "reference", text: reference.label });
          i = reference.end;
          continue;
        }
      }
    }
    i += 1;
  }
  return found;
}

/**
 * textEnd 위치의 ']' 바로 뒤가 '['일 때 전체형 `[text][ref]`나 축약형 `[ref][]`를 읽는다.
 * 두 번째 괄호가 닫히지 않거나 안에 '['가 있으면 참조 문법이 아니라서 null이다.
 * 문법은 맞지만 검사하지 않는 라벨(빈 라벨, `^`로 시작하는 각주)이면 label이 null이다.
 * 이때도 end를 돌려줘서 두 번째 괄호를 단독형 괄호로 다시 읽지 않게 한다.
 */
function readReference(
  line: string,
  original: string,
  textStart: number,
  textEnd: number,
): { label: string | null; end: number } | null {
  const labelStart = textEnd + 2;
  const labelEnd = findLabelEnd(line, labelStart);
  if (labelEnd === -1) return null;
  const end = labelEnd + 1;
  // `[a][b](u)`·`[a][](u)`는 두 번째 괄호가 인라인 링크다. M01처럼 링크로 읽도록 참조로 보지 않는다.
  if (line[end] === "(" && parseDestination(line, end + 1) !== null) return null;

  let label: string;
  if (labelEnd === labelStart) {
    // 축약형: 첫 괄호의 글자가 라벨이다. 라벨에는 escape 안 된 대괄호가 올 수 없다.
    if (findLabelEnd(line, textStart + 1) !== textEnd) return { label: null, end };
    label = original.slice(textStart + 1, textEnd);
  } else {
    label = original.slice(labelStart, labelEnd);
  }
  if (label.trim() === "" || label.startsWith("^")) return { label: null, end };
  return { label, end };
}

/**
 * '(' 바로 뒤 start부터 대상과 선택적 제목, 닫는 ')'를 읽는다.
 * 링크 문법이 아니면 null, 맞으면 대상 원문과 ')' 다음 위치를 돌려준다.
 */
export function parseDestination(line: string, start: number): { target: string; end: number } | null {
  const parsed = readDestinationAndTitle(line, start);
  if (parsed === null || line[parsed.end] !== ")") return null;
  return { target: parsed.target, end: parsed.end + 1 };
}

/**
 * start부터 공백, 대상, 선택적 제목, 뒤 공백을 읽는다. 끝을 무엇이 닫는지는 부르는 쪽이 본다.
 * 인라인 링크는 ')'로, 참조 정의는 줄 끝으로 닫는다.
 * 꺾쇠가 닫히지 않거나, 꺾쇠 없는 대상의 괄호 짝이 안 맞거나, 제목이 닫히지 않으면 null이다.
 * 맞으면 대상 원문과 마지막 공백 다음 위치를 돌려준다.
 */
function readDestinationAndTitle(line: string, start: number): { target: string; end: number } | null {
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
  return { target, end: i };
}

const TITLE_CLOSERS: Record<string, string | undefined> = { '"': '"', "'": "'", "(": ")" };

function skipSpaces(line: string, from: number): number {
  let i = from;
  while (line[i] === " " || line[i] === "\t") i += 1;
  return i;
}
