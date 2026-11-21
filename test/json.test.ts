import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/check.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "md-link-check-json-"));
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

interface JsonItem {
  file: string;
  line: number;
  target: string;
}

/** 한 줄 형식 출력을 JSON 원소 꼴로 바꾼다. */
function fromText(stdout: string): JsonItem[] {
  return stdout
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const m = /^(.*):(\d+): (.*)$/.exec(l);
      if (m === null) throw new Error(`한 줄 형식이 아니다: ${l}`);
      return { file: m[1], line: Number(m[2]), target: m[3] };
    });
}

/** 같은 인자로 text와 json을 각각 돌려 값이 같은지 확인하고 JSON 원소를 돌려준다. */
function expectSameAsText(args: string[]): JsonItem[] {
  const text = run(args);
  const json = run(["--format", "json", ...args]);
  const items = JSON.parse(json.stdout) as JsonItem[];
  expect(items).toEqual(fromText(text.stdout));
  expect(json.stderr).toBe("");
  expect(json.exitCode).toBe(text.exitCode);
  return items;
}

describe("완료조건 1 — 깨진 링크 하나의 JSON 글이 정확히 같다", () => {
  it("docs/a.md 3번째 줄의 ./missing.md를 JSON 배열로 찍고 exit 1이다", () => {
    write("docs/a.md", "# a\n\n[x](./missing.md)\n");
    const expected = JSON.stringify([{ file: "docs/a.md", line: 3, target: "./missing.md" }], null, 2) + "\n";
    expect(run(["--format", "json", root])).toEqual({ stdout: expected, stderr: "", exitCode: 1 });
  });

  it("키 순서는 file, line, target이다", () => {
    write("a.md", "[x](./missing.md)\n");
    const items = JSON.parse(run(["--format", "json", root]).stdout) as JsonItem[];
    expect(Object.keys(items[0])).toEqual(["file", "line", "target"]);
  });
});

describe("완료조건 2 — 원소 순서가 한 줄 형식과 같다", () => {
  it("여러 파일·여러 줄의 깨진 링크가 한 줄 형식의 줄 순서로 나온다", () => {
    write("b.md", "[x](./m1.md)\n\n[y](./m2.md) [z](./m3.md)\n");
    write("a/c.md", "line\n[x](./m4.md)\n");
    write("Z.md", "[x](./m5.md)\n");
    const items = expectSameAsText([root]);
    expect(items.map((i) => `${i.file}:${i.line}:${i.target}`)).toEqual([
      "Z.md:1:./m5.md",
      "a/c.md:2:./m4.md",
      "b.md:1:./m1.md",
      "b.md:3:./m2.md",
      "b.md:3:./m3.md",
    ]);
  });
});

describe("완료조건 3 — target은 한 줄 형식의 원문이다", () => {
  it("정의 없는 참조는 [nope], 깨진 anchor는 b.md#missing으로 나온다", () => {
    write("a.md", "[t][nope]\n[b](b.md#missing)\n");
    write("b.md", "# Title\n");
    const items = expectSameAsText([root]);
    expect(items).toEqual([
      { file: "a.md", line: 1, target: "[nope]" },
      { file: "a.md", line: 2, target: "b.md#missing" },
    ]);
  });
});

describe("완료조건 4 — 깨진 링크가 없으면 []다", () => {
  it("표준 출력이 정확히 []와 줄바꿈이고 exit 0이다", () => {
    write("a.md", "# A\n[b](b.md)\n");
    write("b.md", "");
    expect(run(["--format", "json", root])).toEqual({ stdout: "[]\n", stderr: "", exitCode: 0 });
  });

  it("마크다운 파일이 없는 폴더도 []다", () => {
    expect(run(["--format=json", root])).toEqual({ stdout: "[]\n", stderr: "", exitCode: 0 });
  });
});

describe("완료조건 5 — 한글과 따옴표가 든 경로도 JSON으로 읽힌다", () => {
  it("한글 경로", () => {
    write("문서/가.md", "[x](./없음.md)\n");
    const items = expectSameAsText([root]);
    expect(items).toEqual([{ file: "문서/가.md", line: 1, target: "./없음.md" }]);
  });

  it.skipIf(process.platform === "win32")('" 가 든 경로', () => {
    write('q"uote/a"b.md', '[x](./mi"ss.md)\n');
    const items = expectSameAsText([root]);
    expect(items).toEqual([{ file: 'q"uote/a"b.md', line: 1, target: './mi"ss.md' }]);
  });
});

describe("완료조건 6 — G1 옵션과 함께 쓸 수 있다", () => {
  it("--format json --exclude drafts는 제외된 파일의 깨진 링크를 찍지 않는다", () => {
    write("drafts/a.md", "[x](./missing.md)\n");
    write("docs/drafts/b.md", "[x](./missing.md)\n");
    write("docs/c.md", "[x](./missing.md)\n");
    const expected = JSON.stringify([{ file: "docs/c.md", line: 1, target: "./missing.md" }], null, 2) + "\n";
    const result = { stdout: expected, stderr: "", exitCode: 1 };
    expect(run(["--format", "json", "--exclude", "drafts", root])).toEqual(result);
    expect(run([root, "--exclude=drafts", "--format=json"])).toEqual(result);
  });
});

describe("완료조건 7 — 사용 오류와 도움말", () => {
  it("--format json --nope <폴더>는 표준 출력이 비고 표준 에러에 글이 찍히고 exit 2다", () => {
    const result = run(["--format", "json", "--nope", root]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--nope");
    expect(result.exitCode).toBe(2);
  });

  it("--format json과 경로 없음도 표준 에러에 글로 찍는다", () => {
    const missing = path.join(root, "nowhere");
    const result = run(["--format", "json", missing]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(missing);
    expect(result.exitCode).toBe(2);
  });

  it("--format json --help는 도움말을 찍고 exit 0이다", () => {
    const result = run(["--format", "json", "--help"]);
    expect(result).toEqual(run(["--help"]));
    expect(result.stdout).toContain("사용법");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
