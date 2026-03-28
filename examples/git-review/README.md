# Example: Automated Git Review

> ⚠️ *Requires bract v0.2.0* — this example uses fan-in pipes (multiple
> sources into one agent) and top-level `pipes:` with `transform:` fields,
> which are not yet implemented. Running `bract validate` on it will fail
> until those features land. Tracked in [issue #33](https://github.com/hiloagent/bract/issues/33).

Two specialized agents review a pull request in parallel, then a third
combines their findings into a single review comment.

```
diff-analyzer ──┐
                ├──▶ review-summarizer ──▶ PR comment
style-checker ──┘
```

## What this demonstrates

- Fan-in pipes (two sources → one destination)
- Message transforms (add `source` field before forwarding)
- Different models for different cost/capability tradeoffs
- Agent specialization (each agent does one thing well)

## Usage

### As a git hook

```sh
# .git/hooks/pre-push (or post-receive on the server)
#!/usr/bin/env bash

DIFF=$(git diff origin/main...HEAD)

if [[ -z "$DIFF" ]]; then
  echo "No changes to review."
  exit 0
fi

cd path/to/examples/git-review
bract up --detach

echo "$DIFF" | bract send diff-analyzer
echo "$DIFF" | bract send style-checker

# Wait for the combined review
REVIEW=$(bract read review-summarizer --wait --timeout 120)
echo "$REVIEW"

# Block if score < 6
SCORE=$(echo "$REVIEW" | jq -r '.score // 10' 2>/dev/null || echo 10)
if (( $(echo "$SCORE < 6" | bc -l) )); then
  echo "Review score $SCORE/10 — please address issues before pushing."
  exit 1
fi
```

### Ad-hoc review

```sh
# Review a specific commit
git show HEAD | bract send diff-analyzer
git show HEAD | bract send style-checker

# Wait and read the combined review
bract read review-summarizer --wait
```

### Review output example

```markdown
## Review — Request Changes

**diff-analyzer** found 2 issues. **style-checker** found 1.

### Critical

**Line 47** — SQL injection: user input concatenated directly into query string.
Use parameterized queries.

### Medium

**Line 82** — Missing error handling on `fs.readFile`. Unhandled rejection
will crash the process in production.

### Low (style)

**Line 120-175** — Function `processUserData` is 56 lines. Consider splitting
at the validation/transformation boundary.

**Score: 4/10 — please address critical and medium issues.**
```

## Cost

| Agent             | Model               | Cost per review |
|-------------------|---------------------|-----------------|
| diff-analyzer     | qwen3.5:9b (local)  | ~$0             |
| style-checker     | qwen2.5:3b (local)  | ~$0             |
| review-summarizer | claude-sonnet-4-6   | ~$0.01          |

Heavy analysis on local models, final synthesis on a capable model.
Total cost: fractions of a cent per review.
