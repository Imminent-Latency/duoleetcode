// Templates complement semantic completion; they are not C++ language syntax.
export function shouldOfferSnippets(linePrefix: string): boolean {
  return !/(?:->|::|\.)\s*$/.test(linePrefix);
}

export const cppSnippets = [
  {
    label: "cout",
    detail: "Print to standard output",
    insertText: "std::cout << ${1} << '\\n';$0",
  },
  {
    label: "cerr",
    detail: "Print to standard error",
    insertText: "std::cerr << ${1} << '\\n';$0",
  },
  {
    label: "println",
    detail: "Formatted print line (C++23/26)",
    insertText: 'std::println("${1:{}}", ${2});$0',
  },
  {
    label: "fori",
    detail: "Indexed for loop",
    insertText: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}",
  },
  {
    label: "fora",
    detail: "Range-based for loop",
    insertText: "for (const auto& ${1:x} : ${2:container}) {\n\t$0\n}",
  },
  {
    label: "all",
    detail: "Iterator range pair",
    insertText: "${1:v}.begin(), ${1:v}.end()$0",
  },
];
