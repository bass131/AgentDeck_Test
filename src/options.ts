/** 출력 형식이다. */
export type OutputFormat = "text" | "json";

/** 인자 해석 결과다. */
export type ParsedArgs =
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; folder: string; excludes: string[]; format: OutputFormat };

/** 인자 배열을 옵션과 폴더 인자로 해석한다. 도움말 요청이 있으면 오류보다 먼저 돌려준다. */
export function parseArgs(args: string[]): ParsedArgs {
  const folders: string[] = [];
  const excludes: string[] = [];
  let format: OutputFormat | undefined;
  let help = false;
  let error: string | undefined;
  const fail = (message: string): void => {
    if (error === undefined) error = message;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      folders.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-")) {
      folders.push(arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (name !== "--exclude" && name !== "--format") {
      fail(`모르는 옵션이다: ${arg}\n`);
      continue;
    }
    let value: string;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else if (i + 1 < args.length) {
      value = args[++i];
    } else {
      fail(`옵션에 값이 없다: ${arg}\n`);
      continue;
    }
    if (value === "") {
      fail(`옵션에 값이 없다: ${arg}\n`);
      continue;
    }

    if (name === "--exclude") {
      excludes.push(value);
    } else if (format !== undefined) {
      fail(`--format은 한 번만 줄 수 있다: ${arg}\n`);
    } else if (value === "text" || value === "json") {
      format = value;
    } else {
      fail(`--format 값은 text나 json이어야 한다: ${value}\n`);
    }
  }

  if (help) return { kind: "help" };
  if (error !== undefined) return { kind: "error", message: error };
  if (folders.length === 0) return { kind: "error", message: "폴더 인자가 없다.\n" };
  if (folders.length > 1) {
    return { kind: "error", message: `폴더 인자는 하나만 받는다: ${folders.join(" ")}\n` };
  }
  return { kind: "run", folder: folders[0], excludes, format: format ?? "text" };
}

/**
 * 제외 패턴 목록으로 판정 함수를 만든다. 판정 함수는 검사 폴더 기준 `/` 구분 상대경로를 받아
 * 어느 패턴에든 걸리면 true를 돌려준다.
 */
export function excludeMatcher(patterns: string[]): (relPath: string) => boolean {
  const compiled = patterns.map(compilePattern);
  return (relPath) => {
    const name = relPath.slice(relPath.lastIndexOf("/") + 1);
    return compiled.some((p) => p.regex.test(p.nameOnly ? name : relPath));
  };
}

interface CompiledPattern {
  regex: RegExp;
  nameOnly: boolean;
}

function compilePattern(pattern: string): CompiledPattern {
  let body = pattern.replace(/\/+$/, "");
  const anchored = body.startsWith("/");
  if (anchored) body = body.slice(1);
  const nameOnly = !anchored && !body.includes("/");

  const segments = body.split("/");
  let source = "";
  let afterGlobstar = false;
  segments.forEach((segment, i) => {
    const sep = i > 0 && !afterGlobstar ? "/" : "";
    afterGlobstar = false;
    if (segment === "**") {
      if (i === segments.length - 1) {
        source += sep + ".*";
      } else {
        source += sep + "(?:[^/]+/)*";
        afterGlobstar = true;
      }
    } else {
      source += sep + segmentSource(segment);
    }
  });
  return { regex: new RegExp(`^${source}$`, "u"), nameOnly };
}

function segmentSource(segment: string): string {
  let out = "";
  for (const ch of segment) {
    if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
  }
  return out;
}
