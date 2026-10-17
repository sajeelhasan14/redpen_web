# Paddle pre-flight decision (Task 1)

Researched 2026-09-30 from public pages only. No account was created or used.
Quotes are short fragments; the AUP text was read via a fetch tool that summarises pages, so re-check the exact wording in a browser before relying on it.

## 1. Policy findings (pre-sales)

Sources:
- AUP help page: https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle
- AUP (canonical, referenced by the MSA): https://www.paddle.com/support/aup/
- Domain review: https://www.paddle.com/help/start/account-verification/what-is-domain-verification
- MSA: https://www.paddle.com/legal/terms (only links to the AUP; no pre-order text)

Findings:
- Neither the AUP nor the MSA mentions "pre-order", "pre-sale" or "coming soon". Paddle does not prohibit pre-sales by name.
- Closest prohibition, worded as: prohibited where "there is no bona fide software or service sold", with examples "donations, crowdfunding, community access, advertising, and sponsorship".
- Also prohibited: "Physical products or products that require physical delivery".
- Paddle serves "software companies (including B2B SaaS, Consumer Software, and Games)".
- Domain review requires the site to be "live and secured with an SSL certificate (HTTPS)", with pricing, a product description, "Key features or deliverables included with the purchase", plus Terms, Refund Policy and Privacy Policy in the navigation.
- Pricing may be shown as "a screenshot is acceptable if not yet available", which hints at some tolerance for pre-launch sites. It is not an explicit pre-sale permission.

Reading: a pre-sale of a season pass for real software (RedPen Maths) is not prohibited by name. The risk is a reviewer treating an unreleased product as "no bona fide software sold" (crowdfunding-like). Mitigate with a clear deliverables description, a refund policy and a live demo. Paddle support could confirm by email before launch.

## 2. Docs-derived shapes — FROM DOCS — NOT YET VERIFIED BY SANDBOX PROBE

Sources: developer.paddle.com (webhooks/signature-verification, webhooks/transactions/transaction-completed, webhooks/adjustments/adjustment-created, api-reference/customers/get-customer).

- Signature header: `Paddle-Signature: ts=1671552777;h1=<hex>`. `ts` is a unix timestamp and `h1` is a hex HMAC-SHA256.
- Signed payload: `"{ts}:{raw_body}"`, using the exact raw body. The key is the notification destination's endpoint secret. Docs say SDKs enforce a 5-second tolerance on `ts`; apply the same for manual verification (use a wider window if clock skew is a problem).
- `transaction.completed` (`event_type`), with payload data under `data`:
  - transaction id: `data.id` (`txn_...`)
  - `data.customer_id` (`ctm_...`)
  - `data.custom_data`
  - `data.currency_code`
  - grand total: `data.details.totals.grand_total`, a string in minor units
  - `data.status` = "completed"
- Refund events: `adjustment.created` and `adjustment.updated`. Fields: `data.action` ("credit", "refund", "chargeback", "chargeback_warning"), `data.status`, `data.transaction_id`, `data.type` (full/partial).
  - Refunds start as `pending_approval` on live accounts. `adjustment.updated` fires when the status becomes `approved` or `rejected`.
  - So act on `action === "refund" && status === "approved"` from either event.
  - Chargebacks are a separate action value; decide whether to treat them like refunds.
- Customer email: `GET /customers/{customer_id}` on `https://api.paddle.com` (live) or `https://sandbox-api.paddle.com`. Bearer API key with the `customer.read` permission. Response field `email`.

These match the brief's expected values. The docs were read via a summarising fetch, so exact paths still need the sandbox probe.

PROVISIONAL VERDICT: UNCLEAR

Paddle's published policy is silent on pre-orders and pre-sales, and the only nearby language ("no bona fide software or service sold ... crowdfunding") is aimed at donation-style offerings, not paid access to real software. That leans towards PADDLE OK, but the policy alone cannot settle it. Approval is a human domain review, and an unreleased product could be judged on the facts of the site. I therefore hold it at UNCLEAR until the sandbox probe and, ideally, a written confirmation from Paddle support. If Paddle rejects the domain, fall back to Lemon Squeezy.

## 4. Pending (needs sandbox account)

Steps 2-3 of the brief need Mehroz's Paddle sandbox account (`sandbox-vendors.paddle.com`), which does not exist yet:
1. Create the product "Early-bird Season Pass 2027" with a one-off GBP 49.00 price.
2. Create a notification destination pointing at a temporary request-inspector URL, subscribed to `transaction.completed`, `adjustment.created` and `adjustment.updated`.
3. Send one of each event from the webhook simulator. Record the real header format, event strings and JSON paths, and note any difference from section 2.
4. Verify the customer email lookup with a sandbox API key.
5. Delete the temporary destination.
6. Write the final `VERDICT:` line.
