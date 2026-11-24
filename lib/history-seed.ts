// A deliberately small, provenance-labelled import. These are saved coaching
// notes, not events observed by this app, and never increment attempt counts.
export const historySeed = [
  {
    id: "recall-2026-10-29-map",
    skill: "Java Map insertion",
    date: "2026-10-29",
    profile: "Java 8",
    observation:
      "The first response used counts.add(key, value). After teaching Map.put, an immediate replacement exercise was correct.",
    support:
      "Exact API supplied before the successful follow-up. Delayed independent recall was not checked.",
    source: "https://chatgpt.com/space/page_75d0c8a4479081919bda4380e0335909",
    blocks: [
      "1a45e0cd-9d5f-48b6-bed7-7594dbff7372",
      "a0569464-dc1a-404d-b1d4-cec1a531f6c9",
      "c0f055aa-8644-47de-8c9f-e82478bd3018",
    ],
    provenance: "Imported coaching notes",
    durationMs: null,
  },
  {
    id: "recall-2026-10-29-sort",
    skill: "Descending comparator syntax",
    date: "2026-10-29",
    profile: "Java 8",
    observation:
      "The sort/comparator structure was correct in the first response, but Comparator.reversed() was used as a static method. Immediate rehearsal of Comparator.reverseOrder() was correct after teaching.",
    support:
      "Partial initial success, followed by exact-pattern teaching. Later unaided recall remained unchecked.",
    source: "https://chatgpt.com/space/page_75d0c8a4479081919bda4380e0335909",
    blocks: [
      "00c7c6c8-7eaa-4491-ac2c-b5e3683affdb",
      "ab0f0232-6560-4175-86b3-c426dabeb4ea",
      "f4790217-4f2a-4c66-b064-78e60e363ff9",
    ],
    provenance: "Imported coaching notes",
    durationMs: null,
  },
  {
    id: "recall-2026-10-29-range",
    skill: "Outside-range OR conditions",
    date: "2026-10-29",
    profile: "Java 8",
    observation:
      "The first response had correct comparisons and endpoints but joined the invalid-range checks with AND. A different range was handled correctly immediately after an OR explanation.",
    support:
      "Supported transfer, not independent delayed recall. Actual session duration was not measured.",
    source: "https://chatgpt.com/space/page_75d0c8a4479081919bda4380e0335909",
    blocks: [
      "f90b31a3-8f89-4384-9b30-4682ca69948b",
      "f6d04490-d883-4d08-9e1d-3e9d46cc3230",
      "dadbb85b-4056-4ce2-9881-2f47fd7afcc9",
    ],
    provenance: "Imported coaching notes",
    durationMs: null,
  },
];
