# {{title}} constitution

No project principles have been adopted. This constitution is a draft (`status: draft`). `concord constitution adopt` sets `status: active` once real clauses exist; that change also adds a Decision memory with an `amends` relation to the adopted clauses.

When adopting real principles, write each clause as an H2 heading that starts with its label and ends with its ID. Each paragraph is a root ordered item whose first paragraph ends with its own ID:

```markdown
## C-001 Writes preserve unknown changes {#c-001}

1. Every write checks the target preimage. {#c-001-1}
```

Clause IDs are `c-` followed by three digits. Paragraph IDs extend the clause ID with lowercase letters, digits and single hyphens. An adopted ID is never renamed or reused. Inserting or reordering paragraphs keeps existing IDs. A general section uses `## General {#general}` and paragraph IDs `general-<name>`. IDs shown in code, comments or indented code are not clauses.

Clause writing:

- Each clause states one cross-feature rule; its heading is the rule itself.
- Each paragraph states one reviewable rule: an obligation, a prohibition or a permission. Normative statements bind even without "must".
- Clauses state constraints, not the mechanism that meets them. Adopted technology, pinned dependencies, trust and resource boundaries are constraints.
- Implementation belongs on architecture pages. Every amendment adds a Decision memory in the same change. The memory has an `amends` relation to each affected clause or paragraph. Its body records the reason, sources and impact. Process belongs in Memory.
- Use present-tense rules; do not describe differences from the past.
- Pages that rely on a rule link its ID next to the sentence, for example `[C-001](../constitution.md#c-001-1)`, instead of writing "paragraph N".
