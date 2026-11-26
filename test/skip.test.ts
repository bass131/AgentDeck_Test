import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/check.js";

// M04 G1 — 들여쓴 코드 블록과 한 줄 HTML 주석 안의 링크를 링크 추출에서 뺀다.
// "보고되지 않는다"를 보는 테스트는 기능이 꺼져 있어도 초록이 될 수 있으므로,
// 같은 파일에 보고되어야 하는 대조 링크를 넣고 stdout 전체를 비교한다.

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "md-link-check-skip-"));
  write("a.md");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content = ""): void {
  const full = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function lines(...items: string[]): string {
  return items.join("\n") + "\n";
}

/** t.md를 쓰고 run 결과의 stdout을 돌려준다. */
function check(content: string): string {
  write("t.md", content);
  return run([root]).stdout;
}

const CONTROL = "[c](대조.md)";

describe("완료조건 1 — 문서 처음·빈 줄 다음의 들여쓴 줄", () => {
  it("문서 처음의 공백 4칸 들여쓴 줄은 보고되지 않는다", () => {
    expect(check(lines("    [x](없는.md)", "", CONTROL))).toBe("t.md:3: 대조.md\n");
  });

  it("빈 줄 다음의 공백 4칸 들여쓴 줄은 보고되지 않는다", () => {
    expect(check(lines("단락", "", "    [x](없는.md)", "", CONTROL))).toBe("t.md:5: 대조.md\n");
  });

  it("문서 처음과 빈 줄 다음의 탭 하나 들여쓴 줄도 보고되지 않는다", () => {
    expect(check(lines("\t[x](없는.md)", "", "\t[x](없는.md)", "", CONTROL))).toBe("t.md:5: 대조.md\n");
  });

  it("공백·탭만 있는 줄도 빈 줄로 친다", () => {
    expect(check(lines("단락", " \t ", "    [x](없는.md)", "", CONTROL))).toBe("t.md:5: 대조.md\n");
  });

  it("들여쓴 줄의 이미지와 참조도 찾지 않는다", () => {
    expect(check(lines("", "    ![i](없는.png) [t][없음]", "", CONTROL))).toBe("t.md:4: 대조.md\n");
  });
});

describe("완료조건 2 — 이어지는 들여쓴 줄", () => {
  it("빈 줄 다음의 들여쓴 줄들은 사이에 빈 줄이 있어도 보고되지 않고, 그 뒤 들여쓰지 않은 줄은 보고된다", () => {
    const out = check(
      lines(
        "단락", // 1
        "", // 2
        "    [x](없는.md)", // 3
        "    [x](없는.md)", // 4
        "", // 5
        "\t[x](없는.md)", // 6
        "        [x](없는.md)", // 7
        "", // 8
        "[x](없는.md)", // 9
      ),
    );
    expect(out).toBe("t.md:9: 없는.md\n");
  });
});

describe("완료조건 3 — 단락이 이어지는 들여쓴 줄", () => {
  it("단락 줄 바로 다음의 들여쓴 줄은 보고된다", () => {
    expect(check(lines("단락", "    [x](없는.md)"))).toBe("t.md:2: 없는.md\n");
  });

  it("단락에 이어진 들여쓴 줄 다음의 들여쓴 줄도 단락이다", () => {
    expect(check(lines("단락", "    [x](없는.md)", "    [y](없는.md)"))).toBe(
      "t.md:2: 없는.md\nt.md:3: 없는.md\n",
    );
  });
});

describe("완료조건 4 — 목록 안의 들여쓴 줄", () => {
  for (const item of ["- 항목", "1. 항목", "1) 항목", "* 항목", "+ 항목"]) {
    it(`${item}, 빈 줄, 들여쓴 줄에서 마지막 줄은 보고된다`, () => {
      expect(check(lines(item, "", "    [x](없는.md)"))).toBe("t.md:3: 없는.md\n");
    });
  }

  it("목록 항목 뒤 빈 줄이 여럿이고 들여쓴 줄이 이어져도 목록 안이다", () => {
    expect(check(lines("- 항목", "", "    [x](없는.md)", "", "    [y](없는.md)"))).toBe(
      "t.md:3: 없는.md\nt.md:5: 없는.md\n",
    );
  });
});

describe("완료조건 5 — 목록이 끝난 뒤의 들여쓴 줄", () => {
  it("목록, 빈 줄, 단락, 빈 줄, 들여쓴 줄에서 마지막 줄은 보고되지 않는다", () => {
    const out = check(
      lines(
        "- 항목", // 1
        "", // 2
        "단락 " + CONTROL, // 3
        "", // 4
        "    [x](없는.md)", // 5
      ),
    );
    expect(out).toBe("t.md:3: 대조.md\n");
  });

  it("빈 줄 없이 이어진 단락 줄은 목록을 끝내지 않는다", () => {
    expect(check(lines("- 항목", "이어짐", "", "    [x](없는.md)"))).toBe("t.md:4: 없는.md\n");
  });
});

describe("완료조건 6 — 들여쓴 코드 줄의 참조 정의", () => {
  it("들여쓴 코드 줄의 [r]: 없는.md는 보고되지 않고 정의로도 치지 않는다", () => {
    expect(check(lines("[t][r]", "", "    [r]: 없는.md"))).toBe("t.md:1: [r]\n");
  });
});

describe("완료조건 7 — 한 줄 주석 안의 링크", () => {
  it("<!-- [x](없는.md) -->는 보고되지 않는다", () => {
    expect(check(lines("<!-- [x](없는.md) -->", CONTROL))).toBe("t.md:2: 대조.md\n");
  });

  it("앞 <!-- [x](없는.md) --> 뒤 [y](a.md)는 보고되지 않는다", () => {
    expect(check(lines("앞 <!-- [x](없는.md) --> 뒤 [y](a.md)", CONTROL))).toBe("t.md:2: 대조.md\n");
  });

  it("주석 안의 이미지와 참조도 찾지 않는다", () => {
    expect(check(lines("<!-- ![i](없는.png) [t][없음] -->", CONTROL))).toBe("t.md:2: 대조.md\n");
  });
});

describe("완료조건 8 — 한 줄의 주석 여럿", () => {
  it("주석 밖의 y 링크 한 줄만 보고된다", () => {
    expect(check(lines("<!-- [x](없는.md) --> [y](없는.md) <!-- [z](없는.md) -->"))).toBe("t.md:1: 없는.md\n");
  });

  it("주석 둘 사이의 링크는 위치가 그대로라서 같은 대상이 찍힌다", () => {
    expect(check(lines("<!-- a --> [y](y없음.md) <!-- [z](z없음.md) -->"))).toBe("t.md:1: y없음.md\n");
  });
});

describe("완료조건 9 — 주석으로 인식하지 않는 곳", () => {
  it("닫히지 않은 <!-- 뒤의 링크는 보고된다", () => {
    expect(check(lines("<!-- [x](없는.md)"))).toBe("t.md:1: 없는.md\n");
  });

  it("여러 줄 주석 안의 링크는 보고된다", () => {
    expect(check(lines("<!--", "[x](없는.md)", "-->"))).toBe("t.md:2: 없는.md\n");
  });

  it("인라인 코드 안의 <!--·-->는 주석이 아니다", () => {
    expect(check(lines("`<!--` [x](없는.md) `-->`"))).toBe("t.md:1: 없는.md\n");
  });
});

describe("완료조건 10 — anchor 판정은 그대로", () => {
  it("들여쓴 코드 줄의 <a id=\"x\"></a>는 지금처럼 anchor로 센다", () => {
    write("b.md", lines("", "    <a id=\"x\"></a>"));
    expect(check(lines("[t](b.md#x) " + CONTROL))).toBe("t.md:1: 대조.md\n");
  });
});

describe("펜스 코드 블록과의 관계", () => {
  it("펜스 안의 들여쓴 줄은 펜스 규칙만 따르고, 펜스 닫는 줄 바로 다음의 들여쓴 줄은 보고된다", () => {
    expect(check(lines("```", "    [x](없는.md)", "```", "    [y](없는.md)"))).toBe("t.md:4: 없는.md\n");
  });
});
