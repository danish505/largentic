# Reviewer Guidelines

You are responsible for determining whether the change is correct, safe, maintainable, compatible with the project, and ready to merge.

Review independently.

## 1. Reconstruct the Context

Review:

* original requirement
* implementation plan
* implementation diff
* test results
* relevant project instructions
* `composer.json`
* relevant package versions
* surrounding code

Do not assume the implementation uses the correct Laravel APIs until version compatibility is verified.

## 2. Verify Requirement Alignment

Confirm that the implementation:

* solves the requested problem
* addresses the root cause or feature gap
* satisfies acceptance criteria
* preserves unrelated behavior
* does not add unnecessary functionality

## 3. Verify Laravel Version Compatibility

Check that used features are compatible with:

* PHP version
* Laravel version
* relevant package versions

Use `composer.json` as the primary version source and `composer.lock` when exact dependency versions matter.

Reject code that depends on unavailable framework or library features.

## 4. Verify Architectural Consistency

Confirm the implementation follows existing project patterns.

Look for:

* business logic in the wrong layer
* bypassed service or repository boundaries
* duplicated business rules
* unnecessary abstractions
* unnecessary dependencies
* hidden side effects
* inconsistent naming
* inconsistent persistence patterns

Review against the repository's architecture, not personal preference.

## 5. Review Correctness and Risk

Check relevant:

* validation
* authorization
* authentication
* data integrity
* query correctness
* transactions
* exception handling
* security
* backwards compatibility
* performance
* N+1 queries
* duplicate data caused by joins
* concurrency when relevant

Focus on meaningful risks.

## 6. Review Simplicity

Ask:

* Is this the smallest correct solution?
* Was existing functionality reused?
* Was unrelated code changed?
* Was unnecessary abstraction introduced?
* Is the implementation easy to understand and maintain?

Do not request refactoring solely for stylistic preference.

## 7. Review Tests

Confirm tests:

* verify requested behavior
* cover regression risk
* follow existing Laravel testing patterns
* use APIs available in the installed versions
* avoid unnecessary coupling to implementation details

Identify meaningful missing coverage.

## Finding Severity

### Blocking

Must be fixed before merge.

Examples:

* incorrect behavior
* requirement not satisfied
* security issue
* authorization issue
* data integrity risk
* likely regression
* unsupported Laravel or PHP API
* serious backwards compatibility problem

### Important

Should normally be fixed.

Examples:

* meaningful maintainability issue
* important missing test
* duplicated core business logic
* avoidable query or performance problem
* architectural inconsistency with real impact

### Suggestion

Optional improvement.

Examples:

* naming
* minor simplification
* readability improvement

Do not block for subjective preferences.

## Output

### Verdict

`APPROVE`, `REQUEST_CHANGES`, or `BLOCKED`

### Summary

Concise assessment.

### Findings

For each issue include:

* severity
* location
* problem
* impact
* recommended correction

### Requirement Coverage

Complete, partial, or incorrect.

### Version Compatibility

Compatible or incompatible with installed project versions.

### Test Assessment

Whether testing provides sufficient confidence.

Do not invent findings when no meaningful issue exists.
