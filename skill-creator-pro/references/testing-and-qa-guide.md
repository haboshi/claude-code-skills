# Guide: Testing and Quality Assurance for Skills

A skill is a piece of software. Like any software, it requires rigorous testing to ensure it is reliable, effective, and provides a good user experience. This guide outlines a three-stage testing process recommended by Anthropic.

## The Three Stages of Skill Testing

### Stage 1: Trigger Testing

**Goal:** Ensure the skill activates at the right times and not at the wrong times.

**Process:**
1.  **Create a Test Suite:** Write 10-20 varied user prompts that should (and should not) trigger your skill.
2.  **Positive Cases:** Include prompts with the exact keywords from your `description`, as well as paraphrased versions.
3.  **Negative Cases:** Include prompts that are related but should be handled by a different skill or by the agent's general knowledge.
4.  **Execute and Measure:** Run each prompt in a new session and record whether the skill triggered. Aim for >90% accuracy on your test suite.

**If it fails:** The problem is your `description`. Refine it using the techniques in `advanced-description-writing.md`.

### Stage 2: Functional Testing

**Goal:** Ensure the skill produces the correct and consistent output when it runs.

**Process:**
1.  **Define Success Criteria:** For a given input, what does a successful output look like? Be specific.
2.  **Run Multiple Times:** Execute the same task 3-5 times. The output should be consistent and correct each time.
3.  **Test Edge Cases:** Test with unusual inputs, missing data, or invalid arguments. Does the skill handle them gracefully or fail catastrophically?
4.  **Use Validation Scripts:** For skills that produce structured data or files, use a validation script (like the one in the Iterative Refinement pattern) to programmatically check the output for correctness.

**If it fails:** The problem is in the body of your `SKILL.md` or your associated `scripts/`. The instructions may be ambiguous, or your scripts may have bugs.

### Stage 3: Performance Comparison

**Goal:** Prove that the skill provides a measurable improvement over not using the skill.

**Process:**
1.  **Establish a Baseline:** Perform a complex task that the skill is designed for *without* the skill enabled. Record the following metrics:
    -   Number of user interactions (messages exchanged).
    -   Number of errors or tool failures.
    -   Total time to completion.
    -   Subjective quality of the final output.

2.  **Test With the Skill:** Perform the exact same task with the skill enabled. Record the same metrics.

3.  **Compare:** The skill should result in a significant improvement across the board. For example:

| Metric | Without Skill | With Skill | Improvement |
|:---|:---:|:---:|:---:|
| Interactions | 15 | 3 | 80% ↓ |
| Errors | 3 | 0 | 100% ↓ |
| Time | 25 mins | 5 mins | 80% ↓ |

**If it fails:** The skill is not providing enough value. It may be too simple, or it may not be abstracting the complexity effectively. Consider a different design pattern or adding more domain intelligence.

## Automated Validation

In addition to manual testing, run the structure validator to catch common errors:

```bash
python scripts/quick_validate.py <path/to/skill-folder>
```

This checks for missing or invalid frontmatter, naming conventions, description quality, and referenced file integrity.

Security scanning is covered separately in the main workflow (Step 6: Review Security). The packaging script (`scripts/package_skill.py`) runs both validation and security checks automatically.
