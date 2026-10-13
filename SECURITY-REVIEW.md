# Security Review

## Scope

- `public/mass_print.html`
- `public/components/report-card.js`
- Public application submission handling in `routes/applications.js`
- User-provided checklist attachment

## Findings

### HIGH: Stored HTML injection in printed report cards

- **Confidence:** 9/10
- **Location:** `public/mass_print.html:2357` (HTML written to the print iframe at `public/mass_print.html:2077`)
- **Related source:** `public/components/report-card.js:129`; `routes/applications.js:411,461`
- **Impact:** Applicant-controlled data, including the applicant's name, is interpolated into report-card HTML without escaping. The generated markup is written to a same-origin, unsandboxed iframe. If staff accepts the application, records grades, and prints the report card, injected script may execute with staff-origin access, potentially exposing session data or making authenticated requests.
- **Additional affected data:** School, grade level, school year, subject names, and other interpolated report-card values may have the same issue.
- **Suggested remediation:** Escape all untrusted values before interpolation, or construct the report-card content using safe DOM text APIs. Consider sandboxing the print iframe where compatible with the print workflow.

## Review notes

The public application flow checks that the name is present but stores it as supplied. Exploitation depends on staff later processing the application and using the report-card print workflow. The provided checklist attachment is informational and contains no separate executable vulnerability.
