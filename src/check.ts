import * as fs from "node:fs";
import * as path from "node:path";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** 한 .md 파일 안에서 찾은 링크 하나다. */
export interface FoundLink {
  /** 1부터 세는 줄 번호 */
  line: number;
  /** 제목·꺾쇠를 뗀 대상 원문. 출력에 그대로 쓴다. */
  target: string;
}

interface BrokenLink {
  relPath: string;
  line: number;
  target: string;
}

const USAGE = "사용법: md-link-check <폴더>\n";

/**
 * CLI 진입 함수다. 인자 배열을 받아 출력과 exit 코드를 돌려준다.
 * 실제 표준 출력·표준 에러에 쓰는 일은 src/cli.ts가 맡는다.
 */
export function run(args: string[]): RunResult {
  if (args.length !== 1) {
    const reason = args.length === 0 ? "폴더 인자가 없다.\n" : "폴더 인자는 하나만 받는다.\n";
    return usageError(reason);
  }

  const root = args[0];
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    return usageError(`경로가 없다: ${root}\n`);
  }
  if (!stat.isDirectory()) {
    return usageError(`폴더가 아니다: ${root}\n`);
  }

  const broken: BrokenLink[] = [];
  for (const file of findMarkdownFiles(root)) {
    const relPath = path.relative(root, file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "utf8");
    const baseDir = path.dirname(file);
    for (const link of extractLinks(text)) {
      if (isBroken(link.target, baseDir)) {
        broken.push({ relPath, line: link.line, target: link.target });
      }
    }
  }

  // 코드 유닛 순 비교(locale 무관) → 줄 번호. sort는 안정 정렬이라 한 줄 안의 순서는 유지된다.
  broken.sort((a, b) => {
    if (a.relPath !== b.relPath) return a.relPath < b.relPath ? -1 : 1;
    return a.line - b.line;
  });

  const stdout = broken.map((b) => `${b.relPath}:${b.line}: ${b.target}\n`).join("");
  return { stdout, stderr: "", exitCode: broken.length > 0 ? 1 : 0 };
}

function usageError(message: string): RunResult {
  return { stdout: "", stderr: message + USAGE, exitCode: 2 };
}

/**
 * root 아래 .md 파일을 재귀로 모은다. 루트 아래의 node_modules 폴더와
 * '.'으로 시작하는 폴더는 건너뛴다. 루트 자체에는 이 제외를 적용하지 않는다.
 * 심볼릭 링크 폴더는 순환을 피하려고 따라가지 않는다.
 */
export function findMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        if (entry.isFile() || (entry.isSymbolicLink() && isFileTarget(full))) {
          files.push(full);
        }
      }
    }
  };
  walk(root);
  return files;
}

function isFileTarget(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 대상 원문이 검사 대상이면서 실제 경로가 없을 때 true다. */
export function isBroken(target: string, baseDir: string): boolean {
  const lookup = toLookupPath(target);
  if (lookup === null) return false;
  return !fs.existsSync(path.resolve(baseDir, lookup));
}

/**
 * 대상 원문을 찾아볼 경로로 바꾼다. 건너뛰는 대상이면 null이다.
 * 건너뛰는 대상: 스킴이 있는 링크, '/'로 시작하는 절대 경로, '#'으로 시작하는 같은 파일 링크,
 * 쿼리·anchor를 떼면 경로가 비는 링크.
 */
export function toLookupPath(target: string): string | null {
  if (target === "") return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return null;
  if (target.startsWith("/")) return null;
  if (target.startsWith("#")) return null;

  const cut = target.search(/[?#]/);
  const rawPath = cut === -1 ? target : target.slice(0, cut);
  if (rawPath === "") return null;

  const unescaped = rawPath.replace(/\\([!-/:-@[-`{-~])/g, "$1");
  try {
    return decodeURIComponent(unescaped);
  } catch {
    // 잘못된 퍼센트 인코딩은 풀지 않고 적힌 그대로 찾는다.
    return unescaped;
  }
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * 마크다운 본문에서 인라인 링크와 이미지의 대상을 뽑는다.
 * 펜스 코드 블록과 인라인 코드 안은 무시한다. 인라인 코드는 한 줄 안에서만 인식한다.
 */
export function extractLinks(text: string): FoundLink[] {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const links: FoundLink[] = [];
  let fence: { char: string; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence !== null) {
      const closing = new RegExp(`^ {0,3}(\\${fence.char}{${fence.length},})[ \\t]*$`);
      if (closing.test(line)) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open !== null && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = { char: open[1][0], length: open[1].length };
      continue;
    }
    for (const target of scanLine(maskInlineCode(line))) {
      links.push({ line: index + 1, target });
    }
  }
  return links;
}

/** 인라인 코드 구간을 같은 길이의 공백으로 바꾼다. 닫히지 않은 백틱은 글자로 둔다. */
function maskInlineCode(line: string): string {
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
function findBacktickRun(line: string, from: number, length: number): number {
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
function parseDestination(line: string, start: number): { target: string; end: number } | null {
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
