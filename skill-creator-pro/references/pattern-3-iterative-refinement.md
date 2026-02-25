# Design Pattern 3: Iterative Refinement

This pattern is used for tasks where a perfect output is difficult to achieve in a single pass. Instead, it establishes a loop of generating a draft, checking it against quality criteria, and refining it until the desired quality is met.

## When to Use This Pattern

-   **High-Quality Outputs:** When the final output must meet a high standard of quality, correctness, or completeness (e.g., generating complex reports, writing code, or creating detailed documentation).
-   **Complex Generation:** When the generation process is too complex for a single, perfect prompt.
-   **Self-Correction:** When you want the agent to be able to identify and fix its own mistakes.

## Key Implementation Steps

### 1. Separate Generation from Validation

The core of this pattern is a clear separation between the **generation** step and the **validation** step. The workflow should look like a loop:

`Generate Draft -> Validate Draft -> (If issues found) -> Refine Draft -> Re-validate -> ... -> Finalize`

### 2. Use a Script for Deterministic Validation

This is the most important part of the pattern. **Validation should be performed by a script in the `scripts/` directory, not by natural language.** A script provides objective, deterministic, and repeatable quality checks that natural language cannot.

Your validation script (`check_quality.py`, for example) should:
-   Take the draft output as an input.
-   Run a series of checks against it.
-   Output a structured list of errors or a quality score.

```python
# Example: scripts/check_report.py

def check_report(report_content):
    issues = []
    if "Executive Summary" not in report_content:
        issues.append("Missing section: Executive Summary")
    if len(report_content.split()) < 500:
        issues.append("Report is too short. Must be at least 500 words.")
    # ... more checks
    return issues
```

### 3. Define the Loop in `SKILL.md`

Your `SKILL.md` must orchestrate this loop, telling the agent how to use the validation script.

```markdown
### Workflow: Annual Report Generation

1.  **Initial Draft:**
    -   **Action:** Generate the first draft of the annual report based on the provided data. Save the output to `draft_report.md`.

2.  **Quality Check & Refinement Loop:**
    -   **Action:** Run the validation script: `python scripts/check_report.py draft_report.md`.
    -   **Condition:** If the script returns any issues:
        1.  Address each issue identified by the script.
        2.  Overwrite `draft_report.md` with the refined content.
        3.  **Repeat this step** until the script returns no issues.

3.  **Finalization:**
    -   **Action:** Once the validation script passes, rename `draft_report.md` to `final_report.md` and notify the user.
```

## Example Snippet for `SKILL.md`

```markdown
### Workflow: Code Generation and Linting

1.  **Generate Code:**
    -   **Action:** Based on the user's request, generate the Python code and save it to `app.py`.

2.  **Linting and Refinement Loop:**
    -   **Action:** Run the linter script: `python scripts/linter.py app.py`.
    -   **Condition:** If the linter script reports any errors (e.g., style violations, potential bugs):
        1.  Fix the specific lines of code identified by the linter.
        2.  **Repeat this step** until the linter script exits with a status code of 0.

3.  **Final Output:**
    -   **Action:** The code in `app.py` is now considered complete and high-quality.
```

This pattern moves beyond simple prompting and introduces a system of automated quality assurance, enabling the agent to produce significantly more reliable and polished outputs.
