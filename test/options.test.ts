import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/check.js";
import { excludeMatcher, parseArgs } from "../src/options.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "md-link-check-opt-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** root 기준 상대 경로에 파일을 만든다. 중간 폴더도 만든다. */
function write(rel: string, content = ""): void {
  const full = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** 각 상대 경로에 깨진 링크 하나가 든 파일을 만든다. */
function writeBroken(...rels: string[]): void {
  for (const rel of rels) write(rel, "[x](./missing.md)\n");
}

/** 깨진 링크를 찍은 파일의 상대 경로 목록이다. */
function reported(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(0, line.indexOf(":")));
}

function line(rel: string): string {
  return `${rel}:1: ./missing.md\n`;
}

describe("완료조건 1 — 옵션 없이 실행하면 M02와 같다", () => {
  it("깨진 링크를 한 줄 형식으로 정렬해 찍고 exit 1이다", () => {
    writeBroken("b.md", "a/c.md");
    write("ok.md", "[a](b.md)\n");
    expect(run([root])).toEqual({ stdout: line("a/c.md") + line("b.md"), stderr: "", exitCode: 1 });
  });

  it("고정 제외(node_modules, '.' 폴더)는 그대로다", () => {
    writeBroken("node_modules/a.md", ".git/b.md", "c.md");
    expect(run([root]).stdout).toBe(line("c.md"));
  });
});

describe("완료조건 2 — 이름 패턴은 어느 깊이에서든 걸린다", () => {
  it("--exclude drafts는 drafts/a.md와 docs/drafts/b.md를 빼고 docs/c.md는 검사한다", () => {
    writeBroken("drafts/a.md", "docs/drafts/b.md", "docs/c.md");
    expect(run(["--exclude", "drafts", root])).toEqual({ stdout: line("docs/c.md"), stderr: "", exitCode: 1 });
  });
});

describe("완료조건 3 — '/'가 든 패턴은 루트부터 비교한다", () => {
  it("--exclude docs/old/*.md는 docs/old/a.md만 뺀다", () => {
    writeBroken("docs/old/a.md", "docs/old/sub/b.md", "x/docs/old/c.md");
    expect(reported(run(["--exclude", "docs/old/*.md", root]).stdout)).toEqual([
      "docs/old/sub/b.md",
      "x/docs/old/c.md",
    ]);
  });
});

describe("완료조건 4 — **와 ?", () => {
  it('--exclude "docs/**"는 docs 아래 전부를 뺀다', () => {
    writeBroken("docs/a.md", "docs/x/y/b.md", "c.md", "docsx/d.md");
    expect(reported(run(["--exclude", "docs/**", root]).stdout)).toEqual(["c.md", "docsx/d.md"]);
  });

  it('--exclude "**/tmp.md"는 tmp.md와 a/b/tmp.md를 뺀다', () => {
    writeBroken("tmp.md", "a/b/tmp.md", "a/tmp2.md");
    expect(reported(run(["--exclude", "**/tmp.md", root]).stdout)).toEqual(["a/tmp2.md"]);
  });

  it('--exclude "a?.md"는 ab.md를 빼고 abc.md는 검사한다', () => {
    writeBroken("ab.md", "abc.md");
    expect(reported(run(["--exclude", "a?.md", root]).stdout)).toEqual(["abc.md"]);
  });
});

describe("완료조건 5 — 앞뒤 '/'와 대소문자", () => {
  it("--exclude drafts/는 drafts와 a/drafts를 둘 다 뺀다", () => {
    writeBroken("drafts/x.md", "a/drafts/y.md", "z.md");
    expect(reported(run(["--exclude", "drafts/", root]).stdout)).toEqual(["z.md"]);
  });

  it("--exclude /drafts는 루트의 drafts만 뺀다", () => {
    writeBroken("drafts/x.md", "a/drafts/y.md");
    expect(reported(run(["--exclude", "/drafts", root]).stdout)).toEqual(["a/drafts/y.md"]);
  });

  it("--exclude Drafts는 drafts를 빼지 않는다", () => {
    writeBroken("drafts/x.md");
    expect(reported(run(["--exclude", "Drafts", root]).stdout)).toEqual(["drafts/x.md"]);
  });
});

describe("완료조건 6 — 여러 패턴과 안 걸리는 패턴", () => {
  it("--exclude a.md --exclude=b.md는 두 파일을 다 뺀다", () => {
    writeBroken("a.md", "b.md", "c.md");
    expect(reported(run(["--exclude", "a.md", "--exclude=b.md", root]).stdout)).toEqual(["c.md"]);
  });

  it("--exclude nothing은 결과를 바꾸지 않는다", () => {
    writeBroken("a.md", "d/b.md");
    expect(run(["--exclude", "nothing", root])).toEqual(run([root]));
  });
});

describe("완료조건 7 — 제외된 파일을 가리키는 링크", () => {
  it("drafts/x.md에 # Intro가 있으면 통과한다", () => {
    write("ok.md", "[x](drafts/x.md#intro)\n");
    write("drafts/x.md", "# Intro\n");
    expect(run(["--exclude", "drafts", root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("drafts/x.md에 # Intro가 없으면 깨진 링크로 나온다", () => {
    write("ok.md", "[x](drafts/x.md#intro)\n");
    write("drafts/x.md", "# Other\n");
    expect(run(["--exclude", "drafts", root])).toEqual({
      stdout: "ok.md:1: drafts/x.md#intro\n",
      stderr: "",
      exitCode: 1,
    });
  });
});

describe("완료조건 8 — 옵션 위치와 --", () => {
  it("옵션은 폴더 인자 뒤에 와도 된다", () => {
    writeBroken("drafts/a.md", "b.md");
    expect(run([root, "--exclude", "drafts"])).toEqual(run(["--exclude", "drafts", root]));
    expect(reported(run([root, "--exclude=drafts"]).stdout)).toEqual(["b.md"]);
  });

  it("-- 뒤의 -weird는 폴더 인자이고, 없으면 경로 없음 오류다", () => {
    const result = run(["--", "-weird"]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("-weird");
    expect(result.stderr).toContain("경로가 없다");
    expect(result.stderr).not.toContain("모르는 옵션");
    expect(result.exitCode).toBe(2);
  });

  it("-- 뒤의 -weird 폴더가 있으면 검사한다", () => {
    writeBroken("-weird/a.md");
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(run(["--", "-weird"])).toEqual({ stdout: line("a.md"), stderr: "", exitCode: 1 });
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("완료조건 9 — --help와 -h", () => {
  const cases: string[][] = [["--help"], ["-h"], ["--nope", "--help"], ["--format=xml", "-h"]];
  for (const args of cases) {
    it(`${args.join(" ")}는 사용법을 표준 출력에 찍고 exit 0이다`, () => {
      const result = run(args);
      for (const word of ["사용법", "--exclude", "--format", "--help"]) {
        expect(result.stdout).toContain(word);
      }
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  }

  it("폴더 인자가 있어도 검사하지 않고 도움말만 찍는다", () => {
    writeBroken("a.md");
    const result = run([root, "--help"]);
    expect(result.stdout).not.toContain("missing.md");
    expect(result.exitCode).toBe(0);
  });
});

describe("완료조건 10 — 사용 오류는 exit 2", () => {
  const expectUsageError = (args: string[], ...needles: string[]): void => {
    const result = run(args);
    expect(result.stdout).toBe("");
    for (const needle of needles) expect(result.stderr).toContain(needle);
    expect(result.stderr).toContain("사용법");
    expect(result.exitCode).toBe(2);
  };

  it("--nope <폴더>", () => expectUsageError(["--nope", root], "--nope"));
  it("-x <폴더>", () => expectUsageError(["-x", root], "-x"));
  it("<폴더> --exclude", () => expectUsageError([root, "--exclude"], "--exclude"));
  it("<폴더> --format", () => expectUsageError([root, "--format"], "--format"));
  it("--exclude= <폴더>", () => expectUsageError(["--exclude=", root], "--exclude="));
  it("--format= <폴더>", () => expectUsageError(["--format=", root], "--format="));
  it("--format xml <폴더>", () => expectUsageError(["--format", "xml", root], "xml"));
  it("--format=xml <폴더>", () => expectUsageError(["--format=xml", root], "xml"));
  it("--format text --format text <폴더>", () =>
    expectUsageError(["--format", "text", "--format", "text", root], "--format"));
  it("인자 없음", () => expectUsageError([], "폴더 인자가 없다"));
  it("폴더 둘", () => {
    fs.mkdirSync(path.join(root, "other"));
    expectUsageError([root, path.join(root, "other")], root);
  });
  it("폴더가 아닌 경로", () => {
    write("file.md");
    expectUsageError([path.join(root, "file.md")], "file.md");
  });
});

describe("완료조건 11 — --format text", () => {
  it("--format text <폴더>는 옵션 없이 실행한 것과 같다", () => {
    writeBroken("a.md", "b/c.md");
    write("ok.md", "[t][nope]\n");
    expect(run(["--format", "text", root])).toEqual(run([root]));
    expect(run(["--format=text", root])).toEqual(run([root]));
  });
});

describe("parseArgs", () => {
  it("--옵션 값 꼴에서는 -로 시작하는 다음 인자도 값이다", () => {
    expect(parseArgs(["--exclude", "-x", "d"])).toEqual({ kind: "run", folder: "d", excludes: ["-x"], format: "text" });
  });

  it("--format json은 값으로 넘긴다", () => {
    expect(parseArgs(["--format", "json", "d"])).toEqual({ kind: "run", folder: "d", excludes: [], format: "json" });
  });

  it("--는 폴더 인자가 아니다", () => {
    expect(parseArgs(["d", "--"])).toEqual({ kind: "run", folder: "d", excludes: [], format: "text" });
  });
});

describe("excludeMatcher", () => {
  it("정규식 특수 글자와 !, {, }는 보통 글자다", () => {
    const m = excludeMatcher(["a.b", "!x", "{a,b}", "(c)+"]);
    expect(m("a.b")).toBe(true);
    expect(m("axb")).toBe(false);
    expect(m("d/!x")).toBe(true);
    expect(m("{a,b}")).toBe(true);
    expect(m("a")).toBe(false);
    expect(m("(c)+")).toBe(true);
  });

  it("*와 ?는 /를 넘지 않는다", () => {
    const m = excludeMatcher(["a/*", "b/?"]);
    expect(m("a/x")).toBe(true);
    expect(m("a/x/y")).toBe(false);
    expect(m("b/1")).toBe(true);
    expect(m("b/12")).toBe(false);
  });

  it("가운데 **는 폴더 0단계 이상이다", () => {
    const m = excludeMatcher(["a/**/z.md"]);
    expect(m("a/z.md")).toBe(true);
    expect(m("a/b/c/z.md")).toBe(true);
    expect(m("x/a/z.md")).toBe(false);
  });

  it("패턴이 없으면 아무것도 걸리지 않는다", () => {
    expect(excludeMatcher([])("a.md")).toBe(false);
  });
});
