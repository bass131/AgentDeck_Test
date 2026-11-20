import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/check.js";

// M02 G2 — 참조형 링크 검사. "아무것도 찍지 않는다"를 보는 테스트는 기능이 꺼져 있어도 초록이 되므로,
// 같은 픽스처에 찍혀야 하는 대조 항목을 넣고 stdout 전체를 비교한다.

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "md-link-check-ref-"));
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

/** 줄 배열을 줄바꿈으로 잇고 끝에 줄바꿈을 붙인다. */
function lines(...items: string[]): string {
  return items.join("\n") + "\n";
}

describe("G2 완료조건 1 — 정의 대상 검사", () => {
  it("[t][ref]와 [ref]: ./exists.md는 exists.md가 있으면 통과한다", () => {
    write("exists.md");
    write("a.md", lines("[t][ref]", "", "[ref]: ./exists.md"));
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("5번째 줄 정의가 ./missing.md면 참조가 여러 개여도 a.md:5: ./missing.md 한 줄이고 exit 1이다", () => {
    write(
      "a.md",
      lines(
        "[t][ref]", // 1
        "[u][ref] 그리고 [ref][]", // 2
        "", // 3
        "본문", // 4
        "[ref]: ./missing.md", // 5
      ),
    );
    expect(run([root])).toEqual({ stdout: "a.md:5: ./missing.md\n", stderr: "", exitCode: 1 });
  });
});

describe("G2 완료조건 2 — 정의 대상의 anchor 검사", () => {
  it("[r]: b.md#nope는 b.md에 그 제목이 없으면 깨지고, b.md#intro는 통과한다", () => {
    write("b.md", lines("# Intro"));
    write("a.md", lines("[x][r] [y][s]", "[r]: b.md#nope", "[s]: b.md#intro"));
    expect(run([root])).toEqual({ stdout: "a.md:2: b.md#nope\n", stderr: "", exitCode: 1 });
  });

  it("[r]: #top은 같은 파일의 top 제목으로 검사된다", () => {
    write("a.md", lines("# Top", "[x][r] [y][s]", "[r]: #top", "[s]: #bottom"));
    expect(run([root])).toEqual({ stdout: "a.md:4: #bottom\n", stderr: "", exitCode: 1 });
  });
});

describe("G2 완료조건 3 — 쓰이지 않는 정의", () => {
  it("쓰이지 않는 정의도 대상이 깨졌으면 찍힌다", () => {
    write("exists.md");
    write("a.md", lines("본문", "[unused]: ./gone.md", "[fine]: ./exists.md"));
    expect(run([root])).toEqual({ stdout: "a.md:2: ./gone.md\n", stderr: "", exitCode: 1 });
  });

  it("깨진 대상이 없으면 아무것도 찍히지 않는다", () => {
    write("exists.md");
    write("a.md", lines("본문", "[unused]: ./exists.md", "[also]: exists.md#"));
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

describe("G2 완료조건 4 — 정의 대상의 제목과 꺾쇠", () => {
  it('[r]: <b c.md> "제목"은 b c.md가 없으면 b c.md로 찍힌다', () => {
    write("a.md", lines('[r]: <b c.md> "제목"'));
    expect(run([root])).toEqual({ stdout: "a.md:1: b c.md\n", stderr: "", exitCode: 1 });
  });

  it("b c.md가 있으면 큰따옴표·작은따옴표·괄호 제목 모두 통과한다", () => {
    write("b c.md");
    write("a.md", lines('[r]: <b c.md> "제목"', "[s]: <b c.md> '제목'", "[t]: b%20c.md (제목)  "));
    expect(run([root])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("https·절대 경로 정의는 건너뛴다", () => {
    write(
      "a.md",
      lines(
        "[r]: https://example.com/x", // 1
        "[s]: /abs.md", // 2
        "[u]: ./gone.md", // 3 대조
      ),
    );
    expect(run([root])).toEqual({ stdout: "a.md:3: ./gone.md\n", stderr: "", exitCode: 1 });
  });
});

describe("G2 완료조건 5 — 정의 없는 참조", () => {
  it("[t][nope], [nope][], ![alt][nope]는 각각 [nope]로 찍힌다", () => {
    write("a.md", lines("[t][nope]", "[nope][]", "![alt][nope]", "![nope][]"));
    expect(run([root])).toEqual({
      stdout: "a.md:1: [nope]\na.md:2: [nope]\na.md:3: [nope]\na.md:4: [nope]\n",
      stderr: "",
      exitCode: 1,
    });
  });

  it("찍히는 라벨은 적힌 원문 그대로다", () => {
    write("a.md", lines("[t][My  Ref]"));
    expect(run([root])).toEqual({ stdout: "a.md:1: [My  Ref]\n", stderr: "", exitCode: 1 });
  });
});

describe("G2 완료조건 6 — 라벨 비교", () => {
  it("[t][My  Ref]는 뒤에 있는 정의 [my ref]: ./x.md로 해석된다", () => {
    write("x.md");
    write(
      "a.md",
      lines(
        "[t][My  Ref]", // 1
        "[u][Other]", // 2 대조
        "", // 3
        "[my ref]: ./x.md", // 4
      ),
    );
    expect(run([root])).toEqual({ stdout: "a.md:2: [Other]\n", stderr: "", exitCode: 1 });
  });

  it("정의가 참조보다 앞에 있어도 같고, 앞뒤 공백도 무시한다", () => {
    write("x.md");
    write("a.md", lines("[my ref]: ./x.md", "", "[t][ MY REF ] [u][my\tref]", "[v][Other]"));
    expect(run([root])).toEqual({ stdout: "a.md:4: [Other]\n", stderr: "", exitCode: 1 });
  });

  it("같은 라벨 정의가 둘이면 둘 다 각자 검사된다", () => {
    write("a.md", lines("[t][d]", "[d]: ./gone1.md", "[D]: ./gone2.md"));
    expect(run([root])).toEqual({
      stdout: "a.md:2: ./gone1.md\na.md:3: ./gone2.md\n",
      stderr: "",
      exitCode: 1,
    });
  });
});

describe("G2 완료조건 7 — 단독형과 체크박스", () => {
  it("단독형 [nope]과 - [x] 일은 찍지 않는다", () => {
    write(
      "a.md",
      lines(
        "[nope]", // 1
        "- [x] 일", // 2
        "- [ ] 할 일", // 3
        "[t] [nope]", // 4 두 괄호 사이에 공백이 있으면 참조가 아니다
        "[t][nope]", // 5 대조
      ),
    );
    expect(run([root])).toEqual({ stdout: "a.md:5: [nope]\n", stderr: "", exitCode: 1 });
  });
});

describe("G2 정의 형태 — 정의가 아닌 줄", () => {
  it("대상이 빈 [r]:와 [r]: <>는 정의가 아니라서 [r]이 정의 없는 참조로 찍힌다", () => {
    write("a.md", lines("[t][r]", "", "[r]:", "[r]: <>"));
    expect(run([root])).toEqual({ stdout: "a.md:1: [r]\n", stderr: "", exitCode: 1 });
  });

  it("대상 뒤에 제목이 아닌 글자가 오면 정의가 아니다", () => {
    write("a.md", lines("[t][note]", "", "[note]: 이건 그냥 메모"));
    expect(run([root])).toEqual({ stdout: "a.md:1: [note]\n", stderr: "", exitCode: 1 });
  });
});

describe("G2 M01 인라인 링크 유지", () => {
  it("[a][b](./gone.md)와 [a][](./gone.md)는 두 번째 괄호를 인라인 링크로 검사한다", () => {
    write("a.md", lines("[a][b](./gone.md)", "[a][](./gone.md)"));
    expect(run([root])).toEqual({
      stdout: "a.md:1: ./gone.md\na.md:2: ./gone.md\n",
      stderr: "",
      exitCode: 1,
    });
  });
});

describe("G2 완료조건 8 — 각주", () => {
  it("[^1]과 [^1]: 설명은 찍지 않는다", () => {
    write(
      "a.md",
      lines(
        "본문[^1]과 [t][^1]", // 1
        "", // 2
        "[^1]: 설명", // 3
        "[^2]: ./gone.md", // 4 각주라 정의로 검사하지 않는다
        "[c][nope]", // 5 대조
      ),
    );
    expect(run([root])).toEqual({ stdout: "a.md:5: [nope]\n", stderr: "", exitCode: 1 });
  });
});

describe("G2 완료조건 9 — 코드 블록과 인라인 코드", () => {
  it("펜스 코드 블록과 인라인 코드 안의 정의·참조는 무시된다", () => {
    write(
      "a.md",
      lines(
        "```", // 1
        "[r]: ./gone.md", // 2
        "[t][nope]", // 3
        "[fenced]: ./x.md", // 4
        "```", // 5
        "`[t][nope]` 그리고 `[r]: ./gone.md`", // 6
        "`[s]: ./gone.md`", // 7
        "[u][fenced]", // 8 대조: 펜스 안 정의는 정의가 아니다
      ),
    );
    expect(run([root])).toEqual({ stdout: "a.md:8: [fenced]\n", stderr: "", exitCode: 1 });
  });
});

describe("G2 완료조건 10 — 출력 순서", () => {
  it("한 줄에 [a](./gone.md) [b][nope]면 ./gone.md가 먼저다", () => {
    write("a.md", lines("[a](./gone.md) [b][nope]", "[b][nope] [a](./gone.md)"));
    expect(run([root])).toEqual({
      stdout: "a.md:1: ./gone.md\na.md:1: [nope]\na.md:2: [nope]\na.md:2: ./gone.md\n",
      stderr: "",
      exitCode: 1,
    });
  });

  it("겹치면 안쪽이 먼저다", () => {
    write("a.md", lines("[![alt][nope]](./gone.md)", "[![alt](./pic.png)][nope]"));
    expect(run([root])).toEqual({
      stdout: "a.md:1: [nope]\na.md:1: ./gone.md\na.md:2: ./pic.png\na.md:2: [nope]\n",
      stderr: "",
      exitCode: 1,
    });
  });

  it("여러 파일·여러 줄에 섞이면 파일 → 줄 순이다", () => {
    write("b.md", lines("[x][nope]", "[y](./gone.md)", "[z]: ./gone2.md"));
    write("a.md", lines("본문", "[r]: ./gone.md", "[t][nope] [u](./gone.md)"));
    expect(run([root])).toEqual({
      stdout:
        "a.md:2: ./gone.md\na.md:3: [nope]\na.md:3: ./gone.md\n" +
        "b.md:1: [nope]\nb.md:2: ./gone.md\nb.md:3: ./gone2.md\n",
      stderr: "",
      exitCode: 1,
    });
  });
});

describe("G2 의도된 동작 — 알려진 한계", () => {
  it("본문의 arr[0][1]은 정의 없는 참조 [1]로 찍힌다(D25)", () => {
    write("a.md", lines("값은 arr[0][1]이다"));
    expect(run([root])).toEqual({ stdout: "a.md:1: [1]\n", stderr: "", exitCode: 1 });
  });
});
