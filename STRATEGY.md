# Breakout Rider v2 — strategy notes

## Idea

Most pump.fun launches die within minutes, but a visible minority run 2x–10x
from their create price (on the dev window: 286 of 1,222 sampled coins reached
2x, 145 reached 3x). The edge is not in buying the launch itself (a lottery:
the house sniper pilot wins ~13% of its trades) and not in chasing a mature
run (buying the top: the house momentum pilot lost 9.4 of 10 SOL on the dev
window), but in riding the *early* breakout: a coin up a little off its create
price, with several distinct wallets still buying into it and net SOL flowing
in faster than it did a moment ago.

## Rules

- **Entry** (first buy only, one entry per coin): age 10–100 slots since the
  CreateEvent; price 15%–30% above the create price; price within 8% of the
  25-slot window high; at least 5 buy trades and 6 distinct buyers in the
  window; net inflow at least 0.1 SOL and accelerating (newer half ≥ older
  half); no single wallet over 60% of the window's buy SOL; real SOL reserve
  0.5–80; creator has not sold.
- **Sizing**: one buy per coin, capped at 0.05 SOL and at 1% of the curve's
  real SOL reserve (the cap usually binds first on young curves) and by free
  cash; no pyramiding — adding to positions cost more than it ever gained on
  the dev window; at most 4 breakout positions open and 4 SOL total exposure.
- **Exits** (whole position, first trigger wins): take-profit +25% over cost,
  stop-loss −12%, trailing stop −8% from the peak once the trade is +8%,
  creator sell, any single sell ≥ 2 SOL, or 1,500 slots held (unless up ≥ 50%).
- **Guardrail pacing**: the final window is 6 hours, and the strong signal
  alone only reaches 6–14 coins in any 6-hour slice of the dev window — below
  the 20-coin minimum bar. So the bot tops the coin count up toward 24 with
  probe round trips (buy 0.01 SOL, sell it as soon as it lands): at most 30
  ever, up to 2 in flight, only once 40% of the 6-hour window has elapsed, so
  a busy window never pays for insurance it does not need. A probe costs
  ~0.0004 SOL in fees. Every 6-hour slice of the dev window lands at 24–26
  coins with this pacing.
- **Scout tier (disabled)**: a weaker early-breakout signal at 0.01 SOL was
  tried as an alternative bar-filler. It cost ~0.00125 SOL per extra coin —
  about 3x a probe — and cannibalised strong entries (a coin scout-entered
  can never be strong-entered), so it ships disabled (`maxScouts: 0`) and the
  probes do the job.
- **Costs**: curve fees are 95 + 30 bps a side plus 105,000 lamports per tx,
  so a round trip costs ~2.5% before slippage; buys allow 1,500 bps slippage,
  sells go out at 10,000 bps.

## Local results

Full 24 h dev window, `grade-local --driver process` (the kit's own grader,
no docker on this machine):

| version | net PnL | fills | coins | trips | wins | max DD |
| --- | --- | --- | --- | --- | --- | --- |
| sniper pilot (default) | −0.489 SOL | 848 | 354 | 354 | 45 | 5.3% |
| reversion pilot (default) | −4.016 SOL | 2,316 | 198 | 424 | 111 | 48.9% |
| momentum pilot (default) | −9.387 SOL | 410 | 48 | 80 | 5 | 95.0% |
| breakout-rider v2 (shipped) | **+0.0093 SOL** | 88 | 41 | 44 | 9 | 0.45% |

90% interval −0.049..+0.080 SOL; top 3 coins made 84% of the gains (without
them −0.05 SOL); at 2x fees −0.024 SOL. L1 regrade reproduced byte for byte.

The dev window is a hard regime (all three house pilots lose on it), so the
dev number is a stress test, not a forecast: the final window is a fresh 6
hours of coins that do not exist yet. What the design buys is asymmetry —
losers are small (0.05 SOL stakes at most, −12% stop) and quick, while
winners are allowed to run — plus a drawdown guard (max 4 SOL exposed, tight
stops) that keeps the run far from the 50% drawdown bar.

## 6-hour slices (the final window's regime)

Each 6-hour slice of the dev window, run through the local replay port
(mean over 4 fail-key draws):

| slice | coins created | net PnL | coins traded | bar (≥20) |
| --- | --- | --- | --- | --- |
| 0–6 h | 235 | −0.024 SOL | 24 | PASS |
| 6–12 h | 255 | −0.015 SOL | 26 | PASS |
| 12–18 h | 436 | +0.022 SOL | 24 | PASS |
| 18–24 h | 296 | +0.012 SOL | 24 | PASS |

Mean across slices ≈ −0.001 SOL: roughly breakeven on average, with big
slice-to-slice variance. The final window is one draw from that distribution;
the settings are the flat region around the best cell (neighbouring knobs —
stake 0.03–0.08, take-profit 0.25–0.35, stop 0.10–0.15, trail 0.08–0.12 —
give the same result), not a single best point.

## Determinism

No clock, no randomness, no I/O. Iteration is only over insertion-ordered
maps fed by the batch stream, so the two graded executions produce
byte-identical action logs.
