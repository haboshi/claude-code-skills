# Guide: Distributing and Sharing Your Skill

Creating a skill is only the first step. To maximize its impact, you need to make it discoverable and easy for others to use. This guide covers best practices for packaging, documenting, and distributing your skill.

## Packaging Your Skill

A skill is a self-contained directory. To share it, you simply need to make this directory available.

Use the `package_skill.py` script to package your skill into a distributable `.zip` file:

```bash
python scripts/package_skill.py <path/to/skill-folder>
```

The script validates the skill and creates a ZIP archive maintaining the proper directory structure. The standard method of distribution is via a public Git repository, such as on GitHub.

## Documenting Your Skill for Humans

While `SKILL.md` is for the AI agent, a `README.md` file is for human developers who may want to use or contribute to your skill. **Crucially, the `README.md` file should live in your Git repository but NOT inside the skill directory itself.**

Your `README.md` should include:

-   **What it does:** A clear, concise explanation of the skill's purpose.
-   **How to use it:** Example prompts that trigger the skill.
-   **Configuration:** Any necessary setup, such as required MCPs or environment variables.
-   **How to contribute:** Guidelines for developers who want to improve your skill.

## Structuring a Skill Repository

Here is a recommended structure for a public skill repository on GitHub:

```
my-cool-skill-repo/
├── .github/          # (Optional) GitHub Actions for testing
├── my-cool-skill/    # The skill directory itself
│   ├── SKILL.md
│   ├── scripts/
│   └── references/
├── .gitignore
├── LICENSE
└── README.md         # The human-readable documentation
```

## API-Based Distribution

For enterprise use cases, skills can be managed and distributed via an API. This allows for programmatic control over which skills are available in a given environment.

-   **`/v1/skills` endpoint:** An API endpoint would allow for uploading, listing, and managing skills.
-   **`container.skills` parameter:** When calling the main execution API, you can specify which skills to activate for that specific session, allowing for dynamic, on-the-fly skill loading.

This approach is powerful for multi-tenant systems or for applications that need to dynamically adjust the agent's capabilities based on the user or context.

By following these guidelines, you can ensure your skill is not only effective but also accessible and impactful for a wider audience.
