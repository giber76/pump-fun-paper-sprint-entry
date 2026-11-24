# pump-fun-paper-sprint-entry

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/giber76/pump-fun-paper-sprint-entry/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/giber76/pump-fun-paper-sprint-entry/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

Breakout Rider v2 — a paper-trading bot for pump.fun bonding curves. It rides
early breakouts (a coin up 15–30% off its create price, with several distinct
wallets still buying in and net SOL flowing in faster than before), enters
small once per coin, and leaves fast on a take-profit, a tight stop, a trailing
stop, a creator sell, or a big dump. Guardrail probes top the coin count up
toward 24 so the 20-coin minimum bar clears on a 6-hour window. Paper trading
only — the replay uses market data, never real funds.

Local grade on the dev window (`grade-local --driver process`): **net PnL
+0.0093 SOL**, 88 fills over 41 coins, 44 round trips, max drawdown 0.45%,
guardrails met. See STRATEGY.md for the full notes.

## Run it

```sh
node main.ts
```

The entrypoint is `main.ts` (Node 22); the strategy lives in `strategy.ts`
and the SDK shim is the kit's `sdk/ts/makefun-bot.ts`, vendored byte for byte
in `vendor/`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=giber-way&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
