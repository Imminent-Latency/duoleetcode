globalThis.completionFixtures=[
  {name:'Map members',expected:['get','put'],source:'import java.util.*;\nclass Solution {\n  void run() {\n    Map<String, Integer> map = new HashMap<>();\n    map./*cursor*/\n  }\n}'},
  {name:'Generic return type',expected:['add','get'],source:'import java.util.*;\nclass Solution {\n  void run() {\n    Map<String, List<Integer>> map = new HashMap<>();\n    map.get("a")./*cursor*/\n  }\n}'},
  {name:'PriorityQueue members',expected:['peek','poll'],source:'import java.util.*;\nclass Solution {\n  void run() {\n    PriorityQueue<Integer> queue = new PriorityQueue<>();\n    queue./*cursor*/\n  }\n}'},
  {name:'Custom node fields',expected:['left','val'],source:'class Solution {\n  static class TreeNode { int val; TreeNode left, right; }\n  void run(TreeNode node) {\n    node./*cursor*/\n  }\n}'},
  {name:'String members',expected:['substring','charAt'],source:'class Solution {\n  void run(String text) {\n    text./*cursor*/\n  }\n}'}
];
