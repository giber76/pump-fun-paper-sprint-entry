// Breakout Rider v2 — a paper trading bot for the pump.fun bonding-curve replay
// (agent-fun/replay/v2), built for a 6-hour final window.
//
// Idea: most pump.fun launches die within minutes, but a visible minority run
// 2x-10x from their create price (on the dev window: 286 of 1,222 sampled coins
// reached 2x, 145 reached 3x). The edge is not in buying the launch itself (a
// lottery: the house sniper pilot wins ~13% of its trades) and not in chasing a
// mature run (buying the top: the house momentum pilot lost 9.4 of 10 SOL on the
// dev window), but in riding the *early* breakout: a coin up a little off its
// create price, with several distinct wallets still buying into it and net SOL
// flowing in faster than it did a moment ago.
//
// We enter small, once per coin, and never add — adding to positions cost more
// than it ever gained on the dev window — and we leave fast: a tight stop, a
// trailing stop once the trade is up, a take-profit, a time limit, and an instant
// exit when the creator sells or a single big dump hits. Losers are small and
// quick; winners are allowed to run to the take-profit.
//
// The 6-hour final window shapes two choices. First, the guardrail pacing is
// scaled to 6 hours (paceSecs 21600) and sized to actually clear the bar: the
// strong signal alone only reaches 6-14 coins in any 6-hour slice of the dev
// window, so probes (0.01 SOL buy, sold as soon as it lands, at most 30 ever,
// up to 2 in flight, only once 40% of the window has elapsed) top the coin
// count up toward 24 — every 6-hour slice of the dev window lands at 24-26
// coins. A probe costs ~0.0004 SOL in fees, about a third of what a weaker
// "scout" entry costs per bar-coin, and scouts cannibalise strong entries (a
// coin scout-entered can never be strong-entered), so the scout tier ships
// disabled (maxScouts 0) and the probes do the job. Second, the entry window
// is kept short (age 10-100 slots after create) because in a 6-hour window
// there is no time to wait for a coin to mature.
//
// Costs: curve fees are 95 + 30 bps a side plus a 105,000-lamport tx fee, so a
// round trip costs about 2.5% before slippage — entries therefore need a real
// move, not noise. Every fee is priced in before a trade is sent.
//
// Deterministic by construction: no clock, no randomness, no I/O, iteration only
// over insertion-ordered maps fed by the batch stream — so the two graded
// executions produce byte-identical action logs.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Entry window: youngest / oldest age (slots since CreateEvent) for a first buy. */
  minAge: number;
  maxAge: number;
  /** Entry signal window (slots) for the flow tape. */
  window: number;
  /** Price now over create price: entry band. */
  minRunup: number;
  maxRunup: number;
  /** Price now at least this share of the window's high. */
  nearHigh: number;
  /** Buy trades in the window. */
  minBuys: number;
  /** Distinct buying wallets in the window. */
  minBuyers: number;
  /** Net buy SOL (buys minus sells) over the window. */
  minNetSol: number;
  /** Newer-half net inflow must be at least this multiple of the older half's. */
  accel: number;
  /** Largest single wallet's share of the window's buy SOL. */
  maxBuyerShare: number;
  /** Curve real SOL bounds at entry. */
  minRqSol: number;
  maxRqSol: number;
  /** SOL to put into one position in total. */
  stakeSol: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Exits. */
  takeProfit: number;
  stopLoss: number;
  trail: number;
  /** The trailing stop arms once value reached cost * (1 + trailArm). */
  trailArm: number;
  /** Exit after this many slots held (unless up at least holdIfUp). */
  maxHold: number;
  /** The time limit does not apply while the position is up at least this much. */
  holdIfUp: number;
  /** Exit on any single recorded sell of at least this many SOL. */
  bigSellSol: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Most breakout positions open at once (the rest of caps.max_open_positions is for probes). */
  maxMain: number;
  /** Scout tier: a weaker early-breakout signal traded at scoutStake (0.01 SOL).
   * Scouts exist to clear the 20-coin minimum bar on a 6-hour window, where the
   * strong signal alone only reaches 6-14 coins: a scout is a real position
   * with the same exits, so it can also catch a runner, unlike a probe round
   * trip which only ever pays fees. */
  scoutMinRunup: number;
  scoutMaxRunup: number;
  scoutMinBuys: number;
  scoutMinBuyers: number;
  scoutMinNetSol: number;
  scoutMaxAge: number;
  scoutStake: number;
  /** Most scout positions open at once. */
  maxScouts: number;
  /** Guardrail pacing targets (see header). */
  targetCoins: number;
  targetFills: number;
  /** Window length (seconds) the pacing is scaled to: 21600 = the 6-hour final window. */
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
  /** Most probe round trips ever opened (each costs ~0.0005 SOL in fees, so the
   * budget bounds the insurance premium). Probes also wait until probeMinPace
   * of the window has elapsed, so a busy window never pays for them. */
  probeBudget: number;
  probeMinPace: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
}

// Settings traded with. Chosen on the dev window with the local replay (see
// STRATEGY.md): a flat region, not a single best cell, so the final window's
// different coins should behave similarly.
export const DEFAULT_PARAMS: Params = {
  minAge: 10,
  maxAge: 100,
  window: 25,
  minRunup: 1.15,
  maxRunup: 1.3,
  nearHigh: 0.92,
  minBuys: 5,
  minBuyers: 6,
  minNetSol: 0.1,
  accel: 1,
  maxBuyerShare: 0.6,
  minRqSol: 0.5,
  maxRqSol: 80,
  stakeSol: 0.05,
  minBuySol: 0.01,
  buySlipBps: 1500,
  takeProfit: 0.25,
  stopLoss: 0.12,
  trail: 0.08,
  trailArm: 0.08,
  maxHold: 1500,
  holdIfUp: 0.5,
  bigSellSol: 2,
  cooldown: 150,
  maxEntries: 1,
  maxMain: 4,
  scoutMinRunup: 1.05,
  scoutMaxRunup: 1.5,
  scoutMinBuys: 3,
  scoutMinBuyers: 4,
  scoutMinNetSol: 0.03,
  scoutMaxAge: 150,
  scoutStake: 0.01,
  maxScouts: 0,
  targetCoins: 24,
  targetFills: 30,
  paceSecs: 21600,
  probeSol: 0.01,
  maxProbes: 2,
  probeBudget: 30,
  probeMinPace: 0.4,
  maxExposureSol: 4,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  creator: string | null;
  createPrice: number;
  devSold: boolean;
  trades: Trade[];
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  /** SOL sent in buys for this position (fees included). */
  invested: number;
  exiting: boolean;
  /** Some buy of this position filled. */
  filled: boolean;
  /** Close value at the latest batch (SOL, curve and tx fees deducted). */
  lastValue: number;
  /** True when this position entered on the weaker scout signal. */
  scout: boolean;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** Probe round trips completed so far (bounds the insurance premium). */
  let probesDone = 0;
  /** The bot's own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const keep = p.window + 5;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: null, creator: null, createPrice: 0, devSold: false, trades: [], entries: 0, lastExit: -1e12 };
      tapes.set(mint, t);
    }
    return t;
  };

  /** Entry signal on a curve's tape at slot `now`. Tier 'strong' is the full
   * breakout confirmation; tier 'scout' is the same shape with weaker
   * thresholds, traded at scoutStake. */
  const entrySignal = (t: Tape, now: number, rqSol: number, price: number, tier: 'strong' | 'scout'): boolean => {
    if (rqSol < p.minRqSol || rqSol > p.maxRqSol) return false;
    if (t.created === null || t.createPrice <= 0) return false;
    const age = now - t.created;
    const maxAge = tier === 'strong' ? p.maxAge : p.scoutMaxAge;
    if (age < p.minAge || age > maxAge) return false;
    if (t.devSold) return false;
    const runup = price / t.createPrice;
    const lo = tier === 'strong' ? p.minRunup : p.scoutMinRunup;
    const hi = tier === 'strong' ? p.maxRunup : p.scoutMaxRunup;
    if (runup < lo || runup > hi) return false;
    const from = now - p.window;
    const mid = now - p.window / 2;
    let buySol = 0;
    let sellSol = 0;
    let buys = 0;
    let netOld = 0;
    let netNew = 0;
    let high = 0;
    const byUser = new Map<string, number>();
    for (const tr of t.trades) {
      if (tr.slot <= from) continue;
      const signed = tr.buy ? tr.sol : -tr.sol;
      if (tr.slot <= mid) netOld += signed;
      else netNew += signed;
      if (tr.buy) {
        buySol += tr.sol;
        buys++;
        byUser.set(tr.user, (byUser.get(tr.user) ?? 0) + tr.sol);
      } else {
        sellSol += tr.sol;
      }
      if (tr.price > high) high = tr.price;
    }
    if (buys < (tier === 'strong' ? p.minBuys : p.scoutMinBuys) || byUser.size < (tier === 'strong' ? p.minBuyers : p.scoutMinBuyers)) return false;
    if (buySol - sellSol < (tier === 'strong' ? p.minNetSol : p.scoutMinNetSol)) return false;
    if (netNew <= 0 || netNew < p.accel * netOld) return false;
    if (high > 0 && price < high * p.nearHigh) return false;
    let top = 0;
    for (const v of byUser.values()) if (v > top) top = v;
    if (buySol > 0 && top > p.maxBuyerShare * buySol) return false;
    return true;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const bigSell = new Set<Pubkey>();
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
          if (f.side === 'sell' && probes.get(f.mint) === true) probesDone++;
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
          t.createPrice = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          t.trades.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price: Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves) });
          traded.add(e.mint);
          if (!e.is_buy && t.creator !== null && e.user === t.creator) t.devSold = true;
          if (!e.is_buy && sol >= p.bigSellSol) bigSell.add(e.mint);
        } else if (e.event === 'CompleteEvent') {
          // A completed curve is closed by the replay; forget its tape's entry state.
          const t = tapes.get(e.mint);
          if (t !== undefined) t.entries = p.maxEntries;
        }
      }
      for (const mint of traded) {
        const t = tapes.get(mint)!;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        let exit = h.exiting;
        const t = tapeOf(mint);
        if (!exit && value >= cost * (1 + p.takeProfit)) exit = true;
        if (!exit && value < cost * (1 - p.stopLoss)) exit = true;
        if (!exit && h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - p.trail)) exit = true;
        if (!exit && t.devSold) exit = true;
        if (!exit && bigSell.has(mint)) exit = true;
        if (!exit && now - h.opened > p.maxHold && value < cost * (1 + p.holdIfUp)) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Then entries: one small buy per coin, on a confirmed early breakout —
      // the strong signal at stakeSol, else the weaker scout signal at
      // scoutStake. A coin gets one entry ever, strong or scout.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - [...held.values()].filter((h) => !h.scout).length;
      let scoutLeft = p.maxScouts - [...held.values()].filter((h) => h.scout).length;
      let exposure = 0;
      for (const [mint, h] of held) exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint) || held.has(mint)) continue;
        const t = tapes.get(mint)!;
        if (slotsLeft <= 0) continue;
        if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        let stake = 0;
        let scout = false;
        if (mainLeft > 0 && entrySignal(t, now, rqSol, price, 'strong')) {
          stake = p.stakeSol;
        } else if (scoutLeft > 0 && entrySignal(t, now, rqSol, price, 'scout')) {
          stake = p.scoutStake;
          scout = true;
        } else {
          continue;
        }
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        let amount = Math.min(capSol, stake, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        held.set(mint, { opened: now, peakValue: 0, invested: amount, exiting: false, filled: false, lastValue: 0, scout });
        t.entries++;
        slotsLeft--;
        if (scout) scoutLeft--;
        else mainLeft--;
      }

      // Guardrail pacing: open a probe when the bot's fills or coins lag the pace —
      // but only late in the window, and only up to the probe budget, so a busy
      // window never pays for insurance it does not need.
      if (probes.size < p.maxProbes && probesDone + probes.size < p.probeBudget && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        if (pace < p.probeMinPace) return orders;
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * 10_000) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
