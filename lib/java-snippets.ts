// Templates complement semantic completion; they are not Java language syntax.
export const javaSnippets = [
  {
    label: "sout",
    detail: "Print a line",
    insertText: "System.out.println(${1});$0",
  },
  {
    label: "souf",
    detail: "Formatted output",
    insertText: 'System.out.printf("${1}", ${2});$0',
  },
  {
    label: "serr",
    detail: "Print to standard error",
    insertText: "System.err.println(${1});$0",
  },
  {
    label: "fori",
    detail: "Indexed for loop",
    insertText: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}",
  },
  {
    label: "foreach",
    detail: "Enhanced for loop",
    insertText: "for (${1:int} ${2:value} : ${3:values}) {\n\t$0\n}",
  },
];
