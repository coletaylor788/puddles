# Rocket Money triage rules

Read this file before triaging. Cole can edit it directly. These rules do not relax the skill's title-month date restriction or grant additional mutation types.

## Active rules

| ID | Merchant and conditions | Action | Source |
|---|---|---|---|
| costco-groceries | Verified Costco purchase in USD, amount <= $200.00 | Existing Groceries category; skip if already correct. | Cole's initial integration instructions |
| costco-review | Verified Costco purchase in USD, amount > $200.00 | Leave category unchanged; ask Cole for manual verification before moving. | Cole's initial integration instructions |
| walmart-groceries | Verified Walmart purchase in USD, amount <= $200.00 | Existing Groceries category; skip if already correct. | Cole's initial integration instructions |
| walmart-review | Verified Walmart purchase in USD, amount > $200.00 | Leave category unchanged; ask Cole for manual verification before moving. | Cole's initial integration instructions |

Exactly $200 qualifies for Groceries. Use verified source amount units and purchase magnitude. Do not apply purchase rules to refunds, infer USD for another currency, guess merchant aliases, or create a category. Ask about unclear matches or conflicting rules.

## Confirmed one-off decisions

Record transaction-specific clarifications here. Do not generalize without Cole's confirmation.

## Pending clarification

Keep unresolved items unchanged. Include only the minimum references needed to ask Cole.

## Change history

Initial rules supplied by Cole. Preserve subsequent user edits during deployment and skill upgrades.
