import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/check.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "md-link-check-"));
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

function mkdir(rel: string): void {
  fs.mkdirSync(path.join(root, ...rel.split("/")), { recursive: true });
}

describe("완료조건 1 — 깨진 링크가 없는 폴더", () => {
  it("표준 출력이 비어 있고 exit 0이다", () => {
    write("README.md", "# 제목\n\n[가이드](docs/guide.md)\n![로고](img/logo.png)\n");
    write("docs/guide.md", "[처음으로](../README.md)\n[이웃](./other.md)\n");
    write("docs/other.md", "내용\n");
    write("img/logo.png", "png");

    const result = run([root]);
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("마크다운 파일이 없는 빈 폴더도 exit 0이다", () => {
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

describe("완료조건 2 — 깨진 링크 한 개", () => {
  it("docs/a.md 3번째 줄의 ./missing.md를 정확히 한 줄로 찍고 exit 1이다", () => {
    write("docs/a.md", "# a\n\n[x](./missing.md)\n");

    const result = run([root]);
    expect(result.stdout).toBe("docs/a.md:3: ./missing.md\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });
});

describe("완료조건 3 — anchor와 쿼리", () => {
  it("../b.md#anchor는 b.md가 있으면 통과한다", () => {
    write("sub/a.md", "[b](../b.md#anchor)\n");
    write("b.md", "# b\n");
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("../b.md#anchor는 b.md가 없으면 anchor를 남긴 채 깨진 링크로 나온다", () => {
    write("sub/a.md", "[b](../b.md#anchor)\n");
    const result = run([root]);
    expect(result.stdout).toBe("sub/a.md:1: ../b.md#anchor\n");
    expect(result.exitCode).toBe(1);
  });

  it("../b.md?v=1은 b.md가 있으면 통과한다", () => {
    write("sub/a.md", "[b](../b.md?v=1)\n[c](../b.md?v=1#top)\n");
    write("b.md", "# b\n");
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("../b.md?v=1은 b.md가 없으면 쿼리를 남긴 채 깨진 링크로 나온다", () => {
    write("sub/a.md", "[b](../b.md?v=1)\n");
    const result = run([root]);
    expect(result.stdout).toBe("sub/a.md:1: ../b.md?v=1\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("완료조건 4 — 이미지와 폴더 대상", () => {
  it("![img](./pic.png)는 pic.png가 있으면 통과한다", () => {
    write("a.md", "![img](./pic.png)\n");
    write("pic.png", "png");
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("![img](./pic.png)는 pic.png가 없으면 깨진 링크로 나온다", () => {
    write("a.md", "![img](./pic.png)\n");
    const result = run([root]);
    expect(result.stdout).toBe("a.md:1: ./pic.png\n");
    expect(result.exitCode).toBe(1);
  });

  it("존재하는 폴더를 가리키는 링크는 통과한다", () => {
    write("a.md", "[폴더](./guides)\n[끝 슬래시](guides/)\n");
    mkdir("guides");
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("링크 안에 겹친 이미지는 두 대상을 모두 검사한다", () => {
    write("a.md", "[![배지](badge.svg)](docs/missing.md)\n");
    const result = run([root]);
    expect(result.stdout).toBe("a.md:1: badge.svg\na.md:1: docs/missing.md\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("완료조건 5 — 건너뛰는 대상", () => {
  it("https·mailto·절대 경로·#section 링크는 대상이 없어도 출력되지 않는다", () => {
    write(
      "a.md",
      [
        "[웹](https://example.com/missing.md)",
        "[평문](http://example.com/x)",
        "[메일](mailto:someone@example.com)",
        "[절대](/abs.md)",
        "[절](#section)",
        "[같은 파일 쿼리](?tab=1)",
        "[빈 대상]()",
        "",
      ].join("\n"),
    );
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

describe("완료조건 6 — 코드 블록과 인라인 코드", () => {
  it("펜스 코드 블록과 인라인 코드 안의 깨진 링크는 출력되지 않는다", () => {
    write(
      "a.md",
      [
        "```md", // 1
        "[x](./in-backtick-fence.md)", // 2
        "```", // 3
        "~~~", // 4
        "[x](./in-tilde-fence.md)", // 5
        "```", // 6 — 물결 펜스는 백틱으로 닫히지 않는다
        "[x](./still-in-tilde-fence.md)", // 7
        "~~~~", // 8 — 같은 문자, 더 긴 길이로 닫힌다
        "글 `[x](./in-code.md)` 글 ``[y](./in-double.md) ` 안`` 끝", // 9
        "[x](./after-fence.md)", // 10
        "",
      ].join("\n"),
    );

    const result = run([root]);
    expect(result.stdout).toBe("a.md:10: ./after-fence.md\n");
    expect(result.exitCode).toBe(1);
  });

  it("닫히지 않은 백틱은 코드로 보지 않는다", () => {
    write("a.md", "백틱 ` 하나 [x](./missing.md)\n");
    expect(run([root]).stdout).toBe("a.md:1: ./missing.md\n");
  });
});

describe("완료조건 7 — 제목, 꺾쇠, 퍼센트 인코딩", () => {
  it('[a](b.md "제목")은 b.md가 있으면 통과한다', () => {
    write("x.md", '[a](b.md "제목")\n');
    write("b.md", "");
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it('[a](b.md "제목")은 b.md가 없으면 제목을 뗀 대상으로 나온다', () => {
    write("x.md", "[a](b.md \"제목\")\n[c](b.md 'title')\n");
    expect(run([root]).stdout).toBe("x.md:1: b.md\nx.md:2: b.md\n");
  });

  it("[a](<b c.md>)와 [a](b%20c.md)는 'b c.md'가 있으면 통과한다", () => {
    write("x.md", "[a](<b c.md>)\n[a](b%20c.md)\n");
    write("b c.md", "");
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("[a](<b c.md>)와 [a](b%20c.md)는 'b c.md'가 없으면 적힌 원문으로 나온다", () => {
    write("x.md", "[a](<b c.md>)\n[a](b%20c.md)\n");
    const result = run([root]);
    expect(result.stdout).toBe("x.md:1: b c.md\nx.md:2: b%20c.md\n");
    expect(result.exitCode).toBe(1);
  });

  it("스펙의 출력 예시: 꺾쇠·제목은 떼고 anchor·쿼리·퍼센트 인코딩은 남긴다", () => {
    write("x.md", '[a](<b c.md#x> "t")\n[a](b%20c.md?v=1)\n');
    expect(run([root]).stdout).toBe("x.md:1: b c.md#x\nx.md:2: b%20c.md?v=1\n");
  });
});

describe("완료조건 8 — 탐색 제외 폴더", () => {
  it("node_modules/와 .hidden/ 아래 .md의 깨진 링크는 출력되지 않는다", () => {
    write("node_modules/pkg/README.md", "[x](./missing.md)\n");
    write(".hidden/a.md", "[x](./missing.md)\n");
    write("docs/node_modules/b.md", "[x](./missing.md)\n");
    write("docs/.git/c.md", "[x](./missing.md)\n");
    write("ok.md", "[x](./missing.md)\n");

    const result = run([root]);
    expect(result.stdout).toBe("ok.md:1: ./missing.md\n");
    expect(result.exitCode).toBe(1);
  });

  it("받은 폴더 자체가 '.'으로 시작해도 그 안은 검사한다", () => {
    const hiddenRoot = path.join(root, ".docs");
    fs.mkdirSync(hiddenRoot);
    fs.writeFileSync(path.join(hiddenRoot, "a.md"), "[x](./missing.md)\n");
    expect(run([hiddenRoot]).stdout).toBe("a.md:1: ./missing.md\n");
  });
});

describe("완료조건 9 — 정렬과 경로 구분자", () => {
  it("파일 경로(코드 유닛 순) → 줄 번호 순으로 정렬하고 구분자는 /다", () => {
    write("a.md", [...Array(9).fill(""), "[x](./ten.md)", "[x](./eleven.md)", ""].join("\n"));
    write("B.md", "\n[x](./two.md)\n");
    write("docs/z.md", "[x](./m1.md) [y](./m2.md)\n");
    write("docs/sub/a.md", "[x](../../gone.md)\n");
    write("a.md.md", "\n\n[x](./c.md)\n");

    const result = run([root]);
    expect(result.stdout).toBe(
      [
        "B.md:2: ./two.md", // 대문자 B(0x42)가 소문자 a(0x61)보다 앞선다
        "a.md:10: ./ten.md",
        "a.md:11: ./eleven.md",
        "a.md.md:3: ./c.md",
        "docs/sub/a.md:1: ../../gone.md",
        "docs/z.md:1: ./m1.md", // 한 줄의 여러 링크는 나온 순서대로
        "docs/z.md:1: ./m2.md",
        "",
      ].join("\n"),
    );
    expect(result.stdout).not.toContain("\\");
    expect(result.exitCode).toBe(1);
  });

  it("CRLF 줄바꿈 파일도 줄 번호를 1부터 센다", () => {
    write("a.md", "첫 줄\r\n둘째 줄\r\n[x](./missing.md)\r\n");
    expect(run([root]).stdout).toBe("a.md:3: ./missing.md\n");
  });
});

describe("완료조건 10 — 사용 오류", () => {
  it("폴더 인자가 없으면 표준 에러에 메시지를 찍고 exit 2다", () => {
    const result = run([]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("사용법");
    expect(result.exitCode).toBe(2);
  });

  it("없는 경로면 표준 에러에 메시지를 찍고 exit 2다", () => {
    const missing = path.join(root, "nope");
    const result = run([missing]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(missing);
    expect(result.exitCode).toBe(2);
  });

  it("파일 경로면 표준 에러에 메시지를 찍고 exit 2다", () => {
    write("a.md", "[x](./missing.md)\n");
    const file = path.join(root, "a.md");
    const result = run([file]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("폴더가 아니다");
    expect(result.exitCode).toBe(2);
  });
});
