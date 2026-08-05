-- ========================================
-- The yearly price we quote must equal the yearly price we charge
-- ========================================
-- Found by scripts/sync-stripe-catalogue.mjs, which compares every configured
-- Stripe price against the catalogue row it is supposed to project:
--
--   starter yearly: Stripe charges $90.00,  the catalogue quotes $89.64
--   pro     yearly: Stripe charges $189.00, the catalogue quotes $189.24
--
-- This is the same defect class as the register's F-13 — Stripe and the app
-- telling the customer different things — except it is on the money rather than
-- the copy, which makes it worse. `planCyclePrice` renders
-- "Billed $189.24 once a year" in UpgradeDialog, the customer agrees to that
-- number, and Stripe then charges $189.00. Under-charging by 24¢ is not the
-- risk; quoting a price that is not the price is, and the same arithmetic error
-- would over-charge just as easily on the next pricing change.
--
-- WHICH SIDE IS WRONG
-- -------------------
-- Stripe is right and the seed is wrong. $90 and $189 are round annual prices
-- somebody chose; $89.64 and $189.24 are what you get by seeding the monthly
-- equivalent as a 17%-off monthly figure (9 × 0.83 = 7.47, 19 × 0.83 = 15.77)
-- and multiplying back by twelve. The seed derived the wrong direction: the
-- annual price is the decision, and the monthly equivalent is what you divide
-- out of it, not the other way round.
--
--   $90  / 12 = $7.50 exactly   → saves $18/yr on $108, 16.7%
--   $189 / 12 = $15.75 exactly  → saves $39/yr on $228, 17.1%
--
-- Both still round to the "save ~17%" the billing-period toggle advertises, so
-- no other surface has to change.
--
-- Correcting the seed rather than creating new Stripe prices is deliberate.
-- Stripe prices are immutable, so moving the charge to $89.64 would mean two
-- new price ids, two environment changes across every deployment, and existing
-- annual subscribers left on the old price — all to reach a number nobody
-- chose. Nothing is repriced here: every customer keeps paying exactly what
-- they pay today, and the quote finally matches it.
-- ========================================

UPDATE plans
SET price_yearly_monthly_equivalent = 7.50
WHERE id = 'starter';

UPDATE plans
SET price_yearly_monthly_equivalent = 15.75
WHERE id = 'pro';

-- ========================================
-- Lifetime Pro's description has to survive being read at checkout
-- ========================================
-- `plans.description` is now projected onto the Stripe product by
-- scripts/sync-stripe-catalogue.mjs, so this string is no longer only a card
-- subtitle in the app — it is also what a customer reads on the Stripe page
-- while deciding to spend $199.
--
-- "Pay once, keep every Pro feature forever" is true but says nothing about
-- what Pro includes, and the Stripe copy it replaces did say (while getting the
-- site count wrong: it claimed 3, Pro grants 5). Rather than let the two
-- surfaces carry different amounts of truth, the row now carries all of it.
-- ========================================

UPDATE plans
SET description = 'Pay once, keep every Pro feature forever — 5 websites, AI features, unlimited translations, A/B testing. No recurring billing.'
WHERE id = 'lifetime_pro';
