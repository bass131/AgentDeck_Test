import * as fs from "node:fs";
import * as path from "node:path";
import { collectAnchors } from "./anchors.js";
import { extractItems, normalizeLabel } from "./markdown.js";
import { excludeMatcher, parseArgs } from "./options.js";

export { extractItems, type FoundItem } from "./markdown.js";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface BrokenLink {
  relPath: string;
  line: number;
  target: string;
}

const USAGE = [
  "사용법: md-link-check [옵션] <폴더>",
  "",
  "옵션:",
  "  --exclude <패턴>      검사하지 않을 파일·폴더 패턴. 여러 번 줄 수 있다.",
  "  --format <text|json>  출력 형식. 기본은 text.",
  "  -h, --help            이 사용법을 찍는다.",
  "",
].join("\n");

/**
 * CLI 진입 함수다. 인자 배열을 받아 출력과 exit 코드를 돌려준다.
 * 실제 표준 출력·표준 에러에 쓰는 일은 src/cli.ts가 맡는다.
 */
export function run(args: string[]): RunResult {
  const parsed = parseArgs(args);
  if (parsed.kind === "help") return { stdout: USAGE, stderr: "", exitCode: 0 };
  if (parsed.kind === "error") return usageError(parsed.message);

  const root = parsed.folder;
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
  const anchorsOf = cachedAnchorReader();
  for (const file of findMarkdownFiles(root, excludeMatcher(parsed.excludes))) {
    const relPath = path.relative(root, file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "utf8");
    const items = extractItems(text);
    // 같은 파일의 정의만 본다. 정의는 참조보다 뒤에 있어도 된다.
    // 같은 라벨이 여럿이면 먼저 나온 정의가 이기지만, 정의된 참조는 찍지 않고
    // 정의 줄은 각자 검사하므로 어느 정의가 이기는지는 출력에 드러나지 않는다.
    const defined = new Set<string>();
    for (const item of items) {
      if (item.kind === "definition") defined.add(normalizeLabel(item.label));
    }
    for (const item of items) {
      if (item.kind === "reference") {
        if (!defined.has(normalizeLabel(item.label))) {
          broken.push({ relPath, line: item.line, target: `[${item.label}]` });
        }
      } else if (isBroken(item.target, file, anchorsOf)) {
        broken.push({ relPath, line: item.line, target: item.target });
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
 * isExcluded가 루트 기준 `/` 구분 상대경로에 true를 돌려주는 파일·폴더도 건너뛴다.
 */
export function findMarkdownFiles(root: string, isExcluded: (relPath: string) => boolean = () => false): string[] {
  const files: string[] = [];
  const walk = (dir: string, relDir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (isExcluded(rel)) continue;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full, rel);
      } else if (entry.name.endsWith(".md")) {
        if (entry.isFile() || (entry.isSymbolicLink() && isFileTarget(full))) {
          files.push(full);
        }
      }
    }
  };
  walk(root, "");
  return files;
}

function isFileTarget(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 링크 대상을 나눈 결과다. */
export interface ParsedTarget {
  /** 쿼리·anchor를 떼고 퍼센트 인코딩을 푼 경로. 빈 문자열이면 링크가 든 파일 자신이다. */
  lookup: string;
  /** `#` 뒤 전부를 퍼센트 인코딩을 풀어 둔 것. 빈 문자열이면 anchor가 없는 링크다. */
  anchor: string;
}

/** anchor 목록을 읽어 올 함수다. 인자는 절대 경로의 .md 파일이다. */
export type AnchorReader = (file: string) => Set<string>;

/** 파일마다 anchor 목록을 한 번만 만드는 읽기 함수를 만든다. */
export function cachedAnchorReader(): AnchorReader {
  const cache = new Map<string, Set<string>>();
  return (file) => {
    let anchors = cache.get(file);
    if (anchors === undefined) {
      anchors = collectAnchors(fs.readFileSync(file, "utf8"));
      cache.set(file, anchors);
    }
    return anchors;
  };
}

/**
 * 대상 원문이 검사 대상이면서 깨졌을 때 true다. file은 링크가 든 .md 파일의 경로다.
 * 경로가 없으면 깨졌다. 이 판정을 anchor 검사보다 먼저 한다.
 * 경로가 이름이 `.md`로 끝나는 파일이고 anchor가 있으면 그 파일의 anchor 목록에 있어야 한다.
 * 폴더나 다른 확장자 파일에 붙은 anchor는 보지 않는다.
 */
export function isBroken(target: string, file: string, anchorsOf: AnchorReader = cachedAnchorReader()): boolean {
  const parsed = parseTarget(target);
  if (parsed === null) return false;

  let resolved: string;
  if (parsed.lookup === "") {
    resolved = path.resolve(file);
  } else {
    resolved = path.resolve(path.dirname(file), parsed.lookup);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return true;
    }
    if (parsed.anchor === "" || !stat.isFile() || !path.basename(resolved).endsWith(".md")) return false;
  }
  return !anchorsOf(resolved).has(parsed.anchor);
}

/**
 * 대상 원문을 경로와 anchor로 나눈다. 건너뛰는 대상이면 null이다.
 * 건너뛰는 대상: 빈 대상, 스킴이 있는 링크, '/'로 시작하는 절대 경로,
 * 경로도 anchor도 비는 링크(`?tab=1`, `#`).
 * `#` 뒤 전부가 anchor이고, 그 앞을 첫 `?`에서 자른 것이 경로다.
 */
export function parseTarget(target: string): ParsedTarget | null {
  if (target === "") return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return null;
  if (target.startsWith("/")) return null;

  const hash = target.indexOf("#");
  const anchor = hash === -1 ? "" : target.slice(hash + 1);
  const cut = target.search(/[?#]/);
  const rawPath = cut === -1 ? target : target.slice(0, cut);
  if (rawPath === "" && anchor === "") return null;

  const unescaped = rawPath.replace(/\\([!-/:-@[-`{-~])/g, "$1");
  return { lookup: decodeOrRaw(unescaped), anchor: decodeOrRaw(anchor) };
}

/** 퍼센트 인코딩을 푼다. 잘못된 인코딩이면 적힌 그대로 둔다. */
function decodeOrRaw(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
