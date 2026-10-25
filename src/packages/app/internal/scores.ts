import type { RigScoreSummary, Trace } from '../../domain';
import { DEFAULT_RIG, GRAVITY, analyzeRep, isUsable } from '../../signal';

/** Valid drops from which the reading stops being provisional. */
const FIRM_DROPS = 3;
/** The window around the impact in which a gap in the samples spoils a drop, s. */
const IMPACT_WINDOW_S = { before: 0.3, after: 0.6 };
/** A gap shorter than this is ordinary timer jitter, whatever the sample rate. */
const MIN_GAP_S = 0.1;
/** A sample interval this many times the median one is a gap in the sensor stream. */
const GAP_FACTOR = 3;
/** This many equal readings in a row at the top of a peak, above CLIP_MIN_G, look like a clipped sensor. */
const CLIP_RUN = 3;
const CLIP_MIN_G = 1.2;
/** The fall-time height is trusted only within this range of the configured height (fall time is good to ~17%). */
const HEIGHT_RATIO = { min: 0.6, max: 1.6 };
/**
 * Anchors of the hardness scale, as a_peak / v in rad/s (the square root of stiffness over mass). 10 is a very soft
 * surface, 200 a very hard one; the scale is logarithmic between them.
 * shortcut: the anchors are a guess for a first look, not a calibration. Move them once the towel ladder and the
 * plate experiment show where real surfaces fall.
 */
const HARDNESS_ANCHORS = { soft: 10, hard: 200 };
/** Spread (scaled MAD over the median, as a percentage) up to which the drops count as repeatable. */
const REPEATABLE_PCT = { high: 5, medium: 15 };

export interface RigScores {
  /** 0 to 100, relative. Null only when no drop has a usable impact. */
  hardness: number | null;
  /** 0 to 100, from the bounce ratio. Null unless most valid drops show a rebound. */
  springiness: number | null;
  validDrops: number;
  totalDrops: number;
  /** high: five valid drops within 5%; medium: three or more within 15%; provisional: fewer than three valid drops; low: more spread than that, or a possibly clipped peak. */
  confidence: 'high' | 'medium' | 'low' | 'provisional' | 'insufficient';
  /** Scaled MAD of the height-normalised peak over its median, percent. Null with no valid drop. */
  spreadPct: number | null;
  /** Median of the valid drops' peak in g, and of the height-normalised peak in 1/s, as measured. */
  medianPeakG: number | null;
  medianPeakOverV: number | null;
  medianBounceRatio: number | null;
  /** Median drop height from the free-fall time, cm, when any valid drop has one. */
  measuredHeightCm: number | null;
  /** Which height the speed came from: the free-fall time when it agrees with the setup, else the configured one. */
  heightSource: 'measured' | 'configured';
  /** Why drops were excluded and why a score is missing. */
  notes: string[];
  disclaimer: string;
}

export const SCORE_DISCLAIMER =
  'Experimental relative scores, not a calibrated mattress rating. Compare surfaces measured with the same rig and drop height. A verdict ("too hard, too soft, just right") still needs a reference calibration.';

const median = (xs: readonly number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** A gap in the samples around the impact. A gap elsewhere (the hover, the rest) does not touch the measurement. */
function gapInImpactWindow(trace: Trace): boolean {
  const { samples } = trace;
  const dts = samples.slice(1).map((s, i) => s.t - samples[i]!.t);
  if (dts.length === 0) return false;
  const limit = Math.max(GAP_FACTOR * median(dts), MIN_GAP_S);
  const mags = samples.map((s) => Math.hypot(s.ax, s.ay, s.az));
  const peakAt = samples[mags.indexOf(Math.max(...mags))]!.t;
  const from = peakAt - IMPACT_WINDOW_S.before;
  const to = peakAt + IMPACT_WINDOW_S.after;
  return dts.some((dt, i) => dt > limit && samples[i]!.t < to && samples[i + 1]!.t > from);
}

/** A flat top at a high reading: the sensor may have hit its limit, so the real peak may be higher than recorded. Only a warning. */
function looksClipped(trace: Trace): boolean {
  const mags = trace.samples.map((s) => Math.hypot(s.ax, s.ay, s.az));
  const top = Math.max(...mags);
  if (top < CLIP_MIN_G * GRAVITY) return false;
  let run = 0;
  for (const m of mags) {
    run = Math.abs(m - top) < 1e-6 ? run + 1 : 0;
    if (run >= CLIP_RUN) return true;
  }
  return false;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 0 to 100 on a log scale between the anchors. */
const hardnessScore = (omega: number): number =>
  clamp((100 * Math.log(omega / HARDNESS_ANCHORS.soft)) / Math.log(HARDNESS_ANCHORS.hard / HARDNESS_ANCHORS.soft), 0, 100);

/**
 * Turns rig-drop traces into an experimental hardness score and, where a rebound shows, a springiness score.
 *
 * Per drop: the existing `analyzeRep` finds the free fall, the impact and the rebound, and drops that fail its checks
 * are excluded. Drops with a gap in the samples or a clipped peak are excluded too. The speed at impact is
 * v = sqrt(2 g h), with h from the free-fall time (h = g t² / 2) when that agrees with the configured height and
 * the configured height otherwise. The hardness metric is the first-lobe peak over v. The scores are medians over
 * the valid drops, so one bad release moves them little. Nothing is estimated for a missing value: a score the
 * data cannot support is null.
 */
export function scoreRigDrops(traces: readonly Trace[]): RigScores {
  const notes: string[] = [];
  const valid: { omega: number; peakG: number; peakOverV: number; bounce: number; measuredCm?: number; measuredUsed: boolean; clipped: boolean }[] = [];
  let gaps = 0;
  const rejected = new Map<string, number>();

  for (const trace of traces) {
    if (gapInImpactWindow(trace)) {
      gaps += 1;
      continue;
    }
    const rep = analyzeRep(trace);
    if (!rep.ok || !isUsable(rep)) {
      const reason = rep.ok ? (rep.issues[0] ?? 'low quality') : (rep.reasons[0] ?? 'invalid');
      rejected.set(reason, (rejected.get(reason) ?? 0) + 1);
      continue;
    }
    const configuredCm = trace.rig?.dropHeightCm ?? DEFAULT_RIG.dropHeightCm;
    const measuredCm = rep.flightS === undefined ? undefined : (100 * GRAVITY * rep.flightS ** 2) / 2;
    const ratio = measuredCm === undefined ? undefined : measuredCm / configuredCm;
    const measuredUsed = ratio !== undefined && ratio >= HEIGHT_RATIO.min && ratio <= HEIGHT_RATIO.max;
    const heightM = (measuredUsed ? measuredCm! : configuredCm) / 100;
    const speed = Math.sqrt(2 * GRAVITY * heightM);
    valid.push({
      omega: rep.features.peak / speed,
      peakG: rep.features.peak / GRAVITY,
      peakOverV: rep.features.peakOverV,
      bounce: rep.features.bounceRatio,
      measuredUsed,
      clipped: looksClipped(trace),
      ...(measuredCm !== undefined && { measuredCm }),
    });
  }

  if (gaps > 0) notes.push(`${gaps} ${gaps === 1 ? 'drop' : 'drops'} left out: gap in the sensor samples around the impact.`);
  for (const [reason, count] of rejected) notes.push(`${count} ${count === 1 ? 'drop' : 'drops'} left out: ${reason}.`);

  const report: RigScores = {
    hardness: null,
    springiness: null,
    validDrops: valid.length,
    totalDrops: traces.length,
    confidence: 'insufficient',
    spreadPct: null,
    medianPeakG: null,
    medianPeakOverV: null,
    medianBounceRatio: null,
    measuredHeightCm: null,
    heightSource: 'configured',
    notes,
    disclaimer: SCORE_DISCLAIMER,
  };
  if (valid.length === 0) {
    notes.push(traces.length === 0 ? 'No drop was recorded, so there is no score.' : 'No usable impact was detected in any drop, so there is no score.');
    return report;
  }

  const omegas = valid.map((v) => v.omega);
  const centre = median(omegas);
  report.spreadPct = (100 * 1.4826 * median(omegas.map((o) => Math.abs(o - centre)))) / centre;
  report.medianPeakG = median(valid.map((v) => v.peakG));
  report.medianPeakOverV = median(valid.map((v) => v.peakOverV));
  const measured = valid.flatMap((v) => (v.measuredCm === undefined ? [] : [v.measuredCm]));
  if (measured.length > 0) report.measuredHeightCm = median(measured);
  report.heightSource = valid.filter((v) => v.measuredUsed).length * 2 > valid.length ? 'measured' : 'configured';

  report.hardness = Math.round(hardnessScore(centre) * 10) / 10;
  const rebounds = valid.filter((v) => v.bounce > 0);
  if (rebounds.length >= 1 && rebounds.length * 2 >= valid.length) {
    report.medianBounceRatio = median(rebounds.map((v) => v.bounce));
    report.springiness = Math.round(clamp(report.medianBounceRatio, 0, 1) * 1000) / 10;
  } else {
    notes.push('No clear rebound in most drops, so there is no springiness score.');
  }
  const clippedDrops = valid.filter((v) => v.clipped).length;
  if (clippedDrops > 0) notes.push(`${clippedDrops} ${clippedDrops === 1 ? 'drop has' : 'drops have'} a flat peak: the sensor may have clipped it, so the hardness may read low.`);
  if (valid.length < FIRM_DROPS) notes.push(`Only ${valid.length} valid ${valid.length === 1 ? 'drop' : 'drops'}: the scores are provisional until ${FIRM_DROPS} are valid.`);
  report.confidence =
    clippedDrops > 0
      ? 'low'
      : valid.length < FIRM_DROPS
        ? 'provisional'
        : valid.length >= 5 && report.spreadPct <= REPEATABLE_PCT.high
          ? 'high'
          : report.spreadPct <= REPEATABLE_PCT.medium
            ? 'medium'
            : 'low';
  return report;
}

/** Text for the quality line, with the repeatability behind it. */
export function confidenceLine(report: RigScores): string {
  if (report.confidence === 'insufficient') return 'Measurement quality: n/a (no usable drop)';
  const spread = report.spreadPct === null || report.validDrops < 2 ? '' : `, spread ${report.spreadPct.toFixed(1)}%`;
  return `Measurement quality: ${report.confidence} (${report.validDrops} of ${report.totalDrops} drops valid${spread})`;
}

/** The scores and the measurements behind them, in the shape the store keeps. */
export function scoreSummary(report: RigScores): RigScoreSummary {
  return {
    hardness: report.hardness,
    springiness: report.springiness,
    confidence: report.confidence,
    validDrops: report.validDrops,
    totalDrops: report.totalDrops,
    spreadPct: report.spreadPct,
    medianPeakG: report.medianPeakG,
    medianBounceRatio: report.medianBounceRatio,
    measuredHeightCm: report.measuredHeightCm,
    heightSource: report.heightSource,
  };
}

/** One line for a recording's notes, so an exported file carries the scores it produced. */
export function scoreNote(report: RigScores): string {
  const part = (label: string, value: number | null) => `${label} ${value === null ? 'n/a' : value.toFixed(1)}`;
  return `Experimental relative scores (not calibrated): ${part('hardness', report.hardness)}, ${part('springiness', report.springiness)}; ${confidenceLine(report)}.`;
}

/** The score block for a screen. Without a report it is the placeholder shown before anything is recorded. */
export function scoresHtml(report?: RigScores): string {
  if (!report) {
    return `
    <section data-scores aria-label="Experimental scores">
      <p data-hardness-score>Hardness score: -- / 100</p>
      <p data-springiness-score>Springiness score: -- / 100</p>
      <p data-score-quality>Measurement quality: waiting for a recording</p>
      <p data-score-disclaimer>${SCORE_DISCLAIMER}</p>
    </section>`;
  }
  const why = report.notes.length > 0 ? ` (${report.notes[report.notes.length - 1]})` : '';
  const hardness =
    report.hardness === null
      ? `Hardness score: N/A${why}`
      : `Hardness score: ${report.hardness.toFixed(0)} / 100 (higher is firmer)`;
  const springiness =
    report.springiness === null
      ? 'Springiness score: N/A (no clear rebound was detected)'
      : `Springiness score: ${report.springiness.toFixed(0)} / 100 (higher is bouncier)`;
  return `
    <section data-scores aria-label="Experimental scores">
      <p data-hardness-score>${hardness}</p>
      <p data-springiness-score>${report.hardness === null ? 'Springiness score: N/A' : springiness}</p>
      <p data-score-quality>${confidenceLine(report)}</p>
      ${report.notes.length > 0 ? `<ul data-score-notes>${report.notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
      <p data-score-disclaimer>${report.disclaimer}</p>
    </section>`;
}
