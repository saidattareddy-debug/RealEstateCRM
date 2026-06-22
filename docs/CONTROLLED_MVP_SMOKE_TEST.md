# Controlled MVP — 35-Step Hosted Smoke Test

Run against **staging** with role-specific test accounts (server-only credentials). For **every**
step record: required role, preconditions, exact action, expected UI result, expected database
effect, forbidden side effect, and an evidence row (screenshot link · tester · timestamp ·
PASS/FAIL · notes). The automated subset lives in `e2e/tests/smoke.spec.ts`.

Roles: CA = Client Admin · SM = Sales Manager · SA = Sales Agent · MM = Marketing Manager ·
PD = Project Data & Maintenance · V = Viewer · PA = Platform Admin.

| #   | Step                           | Role      | Precondition                | Exact action                               | Expected UI                       | Expected DB effect                            | Forbidden side effect                           |
| --- | ------------------------------ | --------- | --------------------------- | ------------------------------------------ | --------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| 1   | Sign in                        | CA        | Account exists              | Submit valid credentials at `/sign-in`     | Redirect to dashboard             | Session row; audit `auth.login`               | No error leaking whether email exists           |
| 2   | Select tenant                  | CA        | Member of ≥1 tenant         | Pick tenant in switcher                    | Tenant shell loads                | `active_tenant` set in claims                 | Cannot select a tenant not a member of          |
| 3   | Update branding                | CA        | On settings                 | Change name/logo/colour, save              | Branding updates live             | `tenant_branding` updated; audit              | No cross-tenant branding change                 |
| 4   | Invite team member             | CA        | Seats available             | Invite email + role                        | Invite pending shown              | `invitations` row; audit                      | No active membership before acceptance          |
| 5   | Create project                 | PD        | Tenant selected             | Create project + fields                    | Project appears                   | `projects` insert (tenant-scoped); audit      | Not visible to other tenants                    |
| 6   | Add configuration              | PD        | Project exists              | Add unit configuration                     | Config listed                     | `project_configurations` insert               | No write to another project                     |
| 7   | Add inventory                  | PD        | Project exists              | Add a unit                                 | Unit listed/available             | `inventory_units` insert; history             | No price written without provenance             |
| 8   | Import inventory               | PD        | Valid XLSX/CSV              | Upload + map + import                      | Import summary (created/updated)  | Idempotent batch insert; `import_*` rows      | No duplicates on re-run (idempotency)           |
| 9   | Create lead                    | SA        | Tenant selected             | Create lead manually                       | Lead in list                      | `leads` insert; audit                         | Not assigned to another agent silently          |
| 10  | Import leads                   | SM        | Valid file                  | Upload + map + import                      | Import summary                    | Idempotent batch; dedupe candidates flagged   | No duplicate leads on re-run                    |
| 11  | Review duplicate               | SM        | Dedupe candidate exists     | Open dedupe review, merge/keep             | Resolution recorded               | `lead_duplicates` resolved; audit             | No data loss on merge                           |
| 12  | Assign lead                    | SM        | Lead unassigned             | Assign to an eligible agent                | Owner shown                       | `lead_assignments`; assignment history        | Cannot assign to ineligible user                |
| 13  | Change stage                   | SA        | Owns lead                   | Move pipeline stage                        | Stage updates; chip               | `pipeline_stage_history` insert; audit        | No skipping rule-forbidden transitions          |
| 14  | Create task                    | SA        | Owns lead                   | Add task w/ due date                       | Task listed on lead + `/tasks`    | `tasks` insert; audit                         | No task on a lead not visible to actor          |
| 15  | Start website chat             | V→visitor | Widget allowed domain       | Open widget on test page                   | Widget loads; session begins      | `website_sessions` + conversation row         | Widget refuses disallowed origin                |
| 16  | Receive visitor message        | —         | Session open                | Visitor sends message                      | Message in inbox (unread)         | `conversation_messages` inbound; envelope     | **No automatic AI reply delivered**             |
| 17  | Reply manually                 | SA        | Conversation assigned/owned | Type + send agent reply                    | Reply appears; visitor sees it    | Outbound message (human, simulated transport) | No live external send; master switch off        |
| 18  | Transfer conversation          | SM        | Conversation open           | Transfer to another agent                  | New owner shown                   | Transfer history; audit                       | No cross-tenant transfer                        |
| 19  | Apply DNC                      | SA        | Contact exists              | Mark do-not-contact                        | DNC badge                         | `consent`/DNC row; audit                      | No outbound allowed afterwards                  |
| 20  | Search inbox                   | SA        | Conversations exist         | Search text/filter                         | Filtered results                  | Read-only query                               | No rows from another tenant                     |
| 21  | Use canned reply               | SA        | Canned replies exist        | Insert canned reply                        | Composer populated                | Read; (send creates message on send)          | No auto-send                                    |
| 22  | Apply tag                      | SA        | Conversation open           | Add a tag                                  | Tag chip shown                    | `conversation_tags` insert                    | No tag bleed across tenants                     |
| 23  | View advisory score            | SM        | Lead has score              | Open lead scoring panel                    | Score shown **advisory**          | Read; no write                                | Score never auto-applied as official action     |
| 24  | View advisory match            | SM        | Match run exists            | Open matching panel                        | Matches shown **advisory**        | Read; no write                                | No automatic match action                       |
| 25  | Apply & remove override        | SM        | Has permission              | Apply authorized score override, then undo | Override + revert recorded        | Override rows + audit (both)                  | No override without permission                  |
| 26  | Open knowledge admin           | CA        | Knowledge enabled           | Open `/knowledge`                          | Sources list                      | Read                                          | No untrusted doc treated as instruction         |
| 27  | Run AI test lab                | CA        | AI configured (shadow)      | Run a test prompt                          | Draft/grounded output shown       | `ai_*` test rows                              | **AI sends nothing to customers**               |
| 28  | Confirm AI sends nothing       | CA        | After step 27               | Inspect outbox/responder                   | All AI outputs **record-only**    | No delivered/sent AI message                  | No live AI delivery                             |
| 29  | Open integration admin         | CA        | —                           | Open `/settings/integrations`              | Connections list                  | Read                                          | No live provider connect available              |
| 30  | Confirm simulation labels      | CA        | On integration admin        | Inspect each integration                   | Each labelled simulation/disabled | Read                                          | No active provider IO                           |
| 31  | Confirm webhooks disabled      | CA        | On environment status       | Inspect public-webhooks indicator          | Shows **disabled**                | `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=false`   | Webhook endpoints 404/closed                    |
| 32  | Confirm no unsafe creds        | CA        | On integration admin        | Look for credential entry                  | No live-credential entry field    | —                                             | Cannot enter provider secrets in controlled MVP |
| 33  | Confirm no live WhatsApp/email | CA        | On integration admin        | Attempt to enable WA/email                 | Action unavailable/disabled       | —                                             | No live channel activation                      |
| 34  | Export leads                   | SM        | Has export permission       | Export filtered leads                      | File downloads                    | `export` logged (who/what/when)               | No PII beyond permission; export logged         |
| 35  | Review audit log               | CA        | Actions above performed     | Open `/settings/audit-log`                 | Prior actions visible             | Read                                          | No other tenant's audit entries                 |

## Evidence sheet (fill one row per step)

| #   | Screenshot / evidence link | Tester | Timestamp (UTC) | Result (PASS/FAIL) | Notes |
| --- | -------------------------- | ------ | --------------- | ------------------ | ----- |
| 1   |                            |        |                 |                    |       |
| …   |                            |        |                 |                    |       |
| 35  |                            |        |                 |                    |       |

A single FAIL keeps the overall decision at **NO-GO**.
