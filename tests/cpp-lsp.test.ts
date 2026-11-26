import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CppLspServer,
  cppLsp,
  extractLeetCodeCommentedTypes,
  wrapCppForLsp,
} from "../lib/cpp-lsp";
import { shouldOfferSnippets } from "../lib/cpp-snippets";
import { GET, POST } from "../app/api/cpp/lsp/route";

test("extractLeetCodeCommentedTypes extracts commented LeetCode structs without duplicating defined ones", () => {
  const listNodeStarter = `/**
 * Definition for singly-linked list.
 * struct ListNode {
 *     int val;
 *     ListNode *next;
 *     ListNode() : val(0), next(nullptr) {}
 *     ListNode(int x) : val(x), next(nullptr) {}
 *     ListNode(int x, ListNode *next) : val(x), next(next) {}
 * };
 */
class Solution {
public:
    ListNode* reverseList(ListNode* head) {
        return head;
    }
};`;
  const extracted = extractLeetCodeCommentedTypes(listNodeStarter);
  assert.match(extracted, /struct ListNode \{/);
  assert.match(extracted, /ListNode \*next;/);

  const wrapped = wrapCppForLsp(listNodeStarter);
  assert.ok(wrapped.lineOffset > 0);
  assert.equal(
    wrapped.text.split("\n")[wrapped.lineOffset],
    "/**",
  );

  // If ListNode is already defined outside comments, do not extract it again.
  const alreadyDefined = `struct ListNode { int val; };\n` + listNodeStarter;
  assert.equal(extractLeetCodeCommentedTypes(alreadyDefined), "");
});

test("CppLspServer supports C++26 diagnostics, exact line offsets, completion, and hover", async () => {
  const lsp = new CppLspServer();
  try {
    const status = await lsp.prepare();
    assert.equal(status.ready, true);
    assert.equal(status.standard, "c++26");

    const validWithListNode = `/**
 * Definition for singly-linked list.
 * struct ListNode {
 *     int val;
 *     ListNode *next;
 *     ListNode() : val(0), next(nullptr) {}
 * };
 */
class Solution {
public:
    int solve(ListNode* head, vector<int>& nums) {
        ranges::sort(nums);
        unordered_map<int, int> seen;
        seen[0] = head ? head->val : 0;
        return static_cast<int>(nums.size()) + seen[0];
    }
};`;
    const okDiags = await lsp.diagnostics(validWithListNode);
    assert.deepEqual(okDiags, []);

    // Intentional error on line 14 (0-based line 13) after commented ListNode block.
    const invalid = validWithListNode.replace("nums.size()", "nums.siz()");
    const errDiags = await lsp.diagnostics(invalid);
    assert.ok(errDiags.length > 0, "Expected clangd diagnostic for nums.siz()");
    assert.equal(errDiags[0].range.start.line, 14);
    assert.match(errDiags[0].message, /siz/);

    const completionCode = `class Solution {
public:
    int solve(vector<int>& nums) {
        nums.
    }
};`;
    const comp = await lsp.completion(completionCode, { line: 3, character: 13 });
    assert.ok(
      comp.items.some((i) => String(i.label).includes("push_back")),
      "Expected vector<int>::push_back in clangd completions",
    );

    const inspectCode = `class Solution {
public:
    int solve(vector<int>& nums) {
        return static_cast<int>(nums.size());
    }
};`;
    const info = await lsp.inspect(inspectCode, { line: 3, character: 38 });
    assert.ok(info.hover, "Expected hover info for vector::size");
    assert.match(JSON.stringify(info.hover), /size/);

    // Regression: completion() followed by diagnostics() on identical text must resolve
    // immediately from cached publishDiagnostics rather than stalling for 12s.
    const sameCompCode = `class Solution {
public:
    int solve(vector<int>& nums) {
        return static_cast<int>(nums.siz());
    }
};`;
    await lsp.completion(sameCompCode, { line: 3, character: 39 });
    await new Promise((r) => setTimeout(r, 400));
    const t0 = Date.now();
    const cachedDiags = await lsp.diagnostics(sameCompCode);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 2000, `Expected fast diagnostics after completion, took ${elapsed}ms`);
    assert.ok(cachedDiags.some((d) => /siz/.test(d.message)));

    // Quick-fix code action test: pointer '.' -> '->'
    const ptrCode = `class Solution {
public:
    int solve(vector<int>* nums) {
        return static_cast<int>(nums.size());
    }
};`;
    const ptrDiags = await lsp.diagnostics(ptrCode);
    assert.ok(ptrDiags.length > 0);
    const actions = await lsp.codeActions(ptrCode, ptrDiags[0].range, ptrDiags);
    assert.ok(
      actions.some((a: any) => /->/.test(a.title)),
      `Expected '->' quick fix in ${JSON.stringify(actions)}`,
    );
  } finally {
    await lsp.close();
  }
});

test("C++ LSP API rejects foreign origins and invalid methods before running clangd", async () => {
  try {
    const foreignGet = new Request("http://127.0.0.1:4318/api/cpp/lsp", {
      method: "GET",
      headers: {
        host: "127.0.0.1:4318",
        origin: "https://elsewhere.example",
      },
    });
    assert.equal((await GET(foreignGet)).status, 400);

    const foreignPost = new Request("http://127.0.0.1:4318/api/cpp/lsp", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4318",
        origin: "https://elsewhere.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ method: "prepare" }),
    });
    assert.equal((await POST(foreignPost)).status, 400);

    const badMethod = new Request("http://127.0.0.1:4318/api/cpp/lsp", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4318",
        origin: "http://127.0.0.1:4318",
        "content-type": "application/json",
      },
      body: JSON.stringify({ method: "shell" }),
    });
    assert.equal((await POST(badMethod)).status, 400);
  } finally {
    await cppLsp().close();
  }
});

test("shouldOfferSnippets suppresses snippets after ::, ., and -> member/scope operators", () => {
  assert.equal(shouldOfferSnippets("        std::"), false);
  assert.equal(shouldOfferSnippets("        ptr->"), false);
  assert.equal(shouldOfferSnippets("        v."), false);
  assert.equal(shouldOfferSnippets("        "), true);
  assert.equal(shouldOfferSnippets("        sort("), true);
});

test("clangd completion on std::cout omits duplicate std:: and omits #include edits", async () => {
  const server = new CppLspServer();
  try {
    const status = await server.prepare();
    if (!status.ready) return;

    const code = [
      "class Solution {",
      "public:",
      "    void greet() {",
      "        std::cou",
      "    }",
      "};",
      "",
    ].join("\n");

    await server.diagnostics(code);
    const completion = (await server.completion(code, { line: 3, character: 16 })) as {
      items?: Array<{
        label?: string;
        insertText?: string;
        textEdit?: { newText?: string };
        additionalTextEdits?: Array<{ newText?: string }>;
      }>;
    };
    const items = Array.isArray(completion) ? completion : (completion.items ?? []);
    const coutItem = items.find((item) => item.label?.includes("cout"));
    assert.ok(coutItem, "Expected clangd to suggest cout after std::cou");
    assert.equal(coutItem.textEdit?.newText ?? coutItem.insertText, "cout");
    assert.equal(
      (coutItem.additionalTextEdits ?? []).some((e: { newText?: string }) =>
        e.newText?.includes("#include"),
      ),
      false,
    );
  } finally {
    await server.close();
  }
});
