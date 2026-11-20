import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/check.js";

// M02 G1 — anchor 제목 검사. 통과만 보는 테스트는 anchor 검사가 아예 돌지 않아도 초록이 되므로,
// 대부분 같은 픽스처에 깨져야 하는 대조 링크를 넣고 stdout 전체를 비교한다.

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "md-link-check-anchor-"));
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

/** 줄 배열을 줄바꿈으로 잇고 끝에 줄바꿈을 붙인다. */
function lines(...items: string[]): string {
  return items.join("\n") + "\n";
}

describe("G1 완료조건 1 — 같은 파일 anchor", () => {
  it("## Hello World가 있으면 [x](#hello-world)는 통과한다", () => {
    write("a.md", lines("## Hello World", "[x](#hello-world)"));
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("3번째 줄의 [y](#nope)는 a.md:3: #nope로 나오고 exit 1이다", () => {
    write("a.md", lines("## Hello World", "[x](#hello-world)", "[y](#nope)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:3: #nope\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });
});

describe("G1 완료조건 2 — 다른 파일 anchor", () => {
  it("b.md에 # Intro가 있으면 b.md#intro는 통과하고 b.md#missing은 깨진다", () => {
    write("b.md", lines("# Intro"));
    write("a.md", lines("[x](b.md#intro)", "[x](b.md#missing)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:2: b.md#missing\n");
    expect(result.exitCode).toBe(1);
  });

  it("b.md가 없으면 b.md#intro도 깨진 링크다", () => {
    write("a.md", lines("[x](b.md#intro)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:1: b.md#intro\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("G1 완료조건 3 — slug 변환", () => {
  it("구두점·기호는 지우고 공백 하나마다 -, 한글·_는 남기고, 닫는 #은 뗀다", () => {
    write(
      "a.md",
      lines(
        "## Hello, World!", // 1
        "## A & B", // 2
        "## 한글 제목", // 3
        "## C++ 언어_2", // 4
        "## 제목 ##", // 5
        "[x](#hello-world)", // 6
        "[x](#a--b)", // 7
        "[x](#한글-제목)", // 8
        "[x](#c-언어_2)", // 9
        "[x](#제목)", // 10
        "[x](#a-b)", // 11 — 연속 공백은 합치지 않으므로 대시 하나는 깨진다
        "[x](#제목-)", // 12 — 닫는 # 묶음과 앞뒤 공백을 떼므로 끝 대시는 없다
      ),
    );
    const result = run([root]);
    expect(result.stdout).toBe("a.md:11: #a-b\na.md:12: #제목-\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("G1 완료조건 4 — 중복 제목", () => {
  it("Foo, Foo, Foo-1이면 foo, foo-1, foo-1-1은 통과하고 foo-2는 깨진다", () => {
    write(
      "a.md",
      lines("## Foo", "## Foo", "## Foo-1", "[x](#foo)", "[x](#foo-1)", "[x](#foo-1-1)", "[x](#foo-2)"),
    );
    const result = run([root]);
    expect(result.stdout).toBe("a.md:7: #foo-2\n");
    expect(result.exitCode).toBe(1);
  });

  it("Foo-1, Foo, Foo 순서면 붙인 결과가 이미 있어 다음 숫자로 넘어간다", () => {
    write(
      "a.md",
      lines("## Foo-1", "## Foo", "## Foo", "[x](#foo-1)", "[x](#foo)", "[x](#foo-2)", "[x](#foo-1-1)"),
    );
    const result = run([root]);
    expect(result.stdout).toBe("a.md:7: #foo-1-1\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("G1 완료조건 5 — 밑줄형 제목", () => {
  it("Title + ===와 Sub Title + ---는 #title, #sub-title로 통과한다", () => {
    write("a.md", lines("Title", "===", "", "Sub Title", "---", "", "[x](#title)", "[x](#sub-title)"));
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("빈 줄 바로 뒤의 ---는 제목을 만들지 않는다", () => {
    write("a.md", lines("Title", "", "---", "", "[x](#title)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:5: #title\n");
    expect(result.exitCode).toBe(1);
  });

  it("# 제목·펜스 줄 바로 뒤의 밑줄은 제목을 만들지 않는다", () => {
    write(
      "a.md",
      lines(
        "# Head", // 1
        "---", // 2 — 앞 줄이 # 제목이라 "# Head"는 밑줄형 제목 글자가 아니다
        "```", // 3
        "code", // 4
        "```", // 5
        "===", // 6 — 앞 줄이 펜스 줄이다
        "[x](#head)", // 7
        "[x](#-head)", // 8
        "[x](#code)", // 9
      ),
    );
    const result = run([root]);
    expect(result.stdout).toBe("a.md:8: #-head\na.md:9: #code\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("G1 완료조건 6 — 제목 안 마크다운", () => {
  it("## [Link](x.md) and `code`는 #link-and-code로 통과한다", () => {
    write("x.md", "");
    write("a.md", lines("## [Link](x.md) and `code`", "[x](#link-and-code)", "[x](#linkxmd-and-code)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:3: #linkxmd-and-code\n");
    expect(result.exitCode).toBe(1);
  });

  it("이미지는 alt 글자만 남는다", () => {
    write("logo.png", "png");
    write("a.md", lines("## ![Logo](logo.png) Guide", "[x](#logo-guide)"));
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

describe("G1 완료조건 7 — 펜스 코드 블록 안", () => {
  it("펜스 안의 ## Hidden은 제목이 아니고, 펜스 안의 깨진 링크는 무시된다", () => {
    write(
      "a.md",
      lines(
        "```md", // 1
        "## Hidden", // 2
        "[x](#nope-in-fence)", // 3
        "```", // 4
        "[x](#hidden)", // 5
      ),
    );
    const result = run([root]);
    expect(result.stdout).toBe("a.md:5: #hidden\n");
    expect(result.exitCode).toBe(1);
  });

  it("다른 파일 펜스 안의 제목도 anchor가 아니다", () => {
    write("b.md", lines("~~~", "# Inside", "~~~", "# Outside"));
    write("a.md", lines("[x](b.md#outside)", "[x](b.md#inside)"));
    expect(run([root]).stdout).toBe("a.md:2: b.md#inside\n");
  });
});

describe("G1 완료조건 8 — HTML anchor", () => {
  it('<a name="custom"></a>와 <div id=\'box\'>는 적힌 그대로 anchor가 된다', () => {
    write(
      "a.md",
      lines(
        '<a name="custom"></a>', // 1
        "<div id='box'>", // 2
        "</div>", // 3
        '<span id="Mixed Case">', // 4
        "[x](#custom)", // 5
        "[x](#box)", // 6
        "[x](#Mixed Case)", // 7 — 공백이 있는 대상은 링크 문법이 아니라 추출되지 않는다
        "[x](<#Mixed Case>)", // 8 — slug 변환 없이 적힌 그대로 비교한다
        "[x](#mixed-case)", // 9
      ),
    );
    const result = run([root]);
    expect(result.stdout).toBe("a.md:9: #mixed-case\n");
    expect(result.exitCode).toBe(1);
  });

  it('인라인 코드 안의 `<a name="code">`로는 #code가 통과하지 않는다', () => {
    write("a.md", lines('글 `<a name="code">` 글', "[x](#code)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:2: #code\n");
    expect(result.exitCode).toBe(1);
  });

  it("펜스 코드 블록 안의 HTML anchor도 무시된다", () => {
    write("a.md", lines("```html", '<a id="fenced"></a>', "```", "[x](#fenced)"));
    expect(run([root]).stdout).toBe("a.md:4: #fenced\n");
  });

  it("HTML anchor는 slug 중복 계산에 넣지 않는다", () => {
    write("a.md", lines('<a id="foo"></a>', "## Foo", "[x](#foo)", "[x](#foo-1)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:4: #foo-1\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("G1 완료조건 9 — 퍼센트 인코딩과 대소문자", () => {
  it("퍼센트 인코딩된 한글 anchor는 풀어서 비교하고, 출력에는 적힌 원문을 쓴다", () => {
    write(
      "a.md",
      lines(
        "## 한글 제목",
        "[x](#%ED%95%9C%EA%B8%80-%EC%A0%9C%EB%AA%A9)",
        "[x](#%ED%95%9C%EA%B8%80-%EC%97%86%EC%9D%8C)", // #한글-없음
      ),
    );
    const result = run([root]);
    expect(result.stdout).toBe("a.md:3: #%ED%95%9C%EA%B8%80-%EC%97%86%EC%9D%8C\n");
    expect(result.exitCode).toBe(1);
  });

  it("잘못된 퍼센트 인코딩이면 적힌 그대로 비교한다", () => {
    write("a.md", lines('<a id="100%x"></a>', "[x](#100%x)", "[x](#100%y)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:3: #100%y\n");
    expect(result.exitCode).toBe(1);
  });

  it("#Hello-World(대문자)는 ## Hello World에 대해 깨진 링크다", () => {
    write("a.md", lines("## Hello World", "[x](#Hello-World)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:2: #Hello-World\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("G1 완료조건 10 — 폴더·다른 확장자·빈 anchor", () => {
  it("guides/#x, pic.png#x, a.md#은 경로가 있으면 통과한다", () => {
    mkdir("guides");
    write("pic.png", "png");
    write("a.md", lines("# A", "[x](guides/#x)", "[x](pic.png#x)", "[x](a.md#)", "[x](#)"));
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("경로가 없으면 anchor와 무관하게 깨진다", () => {
    write("a.md", lines("[x](gone/#x)", "[x](gone.png#x)", "[x](gone.md#)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:1: gone/#x\na.md:2: gone.png#x\na.md:3: gone.md#\n");
    expect(result.exitCode).toBe(1);
  });

  it("이름이 정확히 .md로 끝나지 않는 파일의 anchor는 보지 않는다", () => {
    write("notes.markdown", lines("# Notes"));
    write("notes.MD", lines("# Notes"));
    write("a.md", lines("[x](notes.markdown#nope)", "[x](notes.MD#nope)", "[x](b.md#nope)"));
    write("b.md", lines("# B"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:3: b.md#nope\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("G1 완료조건 11 — 쿼리와 anchor", () => {
  it("?v=1#top은 같은 파일의 top 제목으로 검사된다", () => {
    write("a.md", lines("# top", "[x](?v=1#top)"));
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });

    write("b.md", lines("# other", "[x](?v=1#top)"));
    const result = run([root]);
    expect(result.stdout).toBe("b.md:2: ?v=1#top\n");
    expect(result.exitCode).toBe(1);
  });

  it("?tab=1처럼 경로도 anchor도 없는 링크는 건너뛴다", () => {
    write("a.md", lines("[x](?tab=1)", "[x](?v=1#)"));
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

describe("G1 완료조건 12 — 루트 밖·제외 폴더 안의 .md", () => {
  it("node_modules/pkg/doc.md의 # Usage로 node_modules/pkg/doc.md#usage가 통과한다", () => {
    write("node_modules/pkg/doc.md", lines("# Usage"));
    write("a.md", lines("[x](node_modules/pkg/doc.md#usage)", "[x](node_modules/pkg/doc.md#install)"));
    const result = run([root]);
    expect(result.stdout).toBe("a.md:2: node_modules/pkg/doc.md#install\n");
    expect(result.exitCode).toBe(1);
  });

  it("검사 폴더 밖의 .md도 읽어서 anchor를 검사한다", () => {
    write("outside.md", lines("# Outside"));
    write("docs/a.md", lines("[x](../outside.md#outside)", "[x](../outside.md#nope)"));
    const result = run([path.join(root, "docs")]);
    expect(result.stdout).toBe("a.md:2: ../outside.md#nope\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("G1 — 제목 인식 세부", () => {
  it("#은 1~6개, 앞 공백은 0~3칸, # 뒤에는 공백이 있어야 제목이다", () => {
    write(
      "a.md",
      lines(
        "###### Six", // 1
        "####### Seven", // 2
        "   # Three Spaces", // 3
        "    # Four Spaces", // 4
        "#NoSpace", // 5
        "## Tail#", // 6 — 앞에 공백이 없는 #은 닫는 묶음이 아니다
        "[x](#six)", // 7
        "[x](#three-spaces)", // 8
        "[x](#tail)", // 9
        "[x](#-seven)", // 10
        "[x](#four-spaces)", // 11
        "[x](#nospace)", // 12
      ),
    );
    const result = run([root]);
    expect(result.stdout).toBe("a.md:10: #-seven\na.md:11: #four-spaces\na.md:12: #nospace\n");
    expect(result.exitCode).toBe(1);
  });

  it("BOM과 CRLF가 있는 파일도 첫 줄 제목을 읽는다", () => {
    write("b.md", "﻿# First\r\nSecond\r\n---\r\n");
    write("a.md", lines("[x](b.md#first)", "[x](b.md#second)"));
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});
