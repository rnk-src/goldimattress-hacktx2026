import './internal/styles.css';

export type { AppDeps } from './internal/app';
export { startApp } from './internal/app';
export { mountProfileScreen } from './internal/profile';
export type { ProfileDeps } from './internal/profile';
export { withRepMetadata } from './internal/metadata';
export { caveatTexts, confidenceText, hardnessText, matchText, springinessText } from './internal/wording';
export { SCORE_DISCLAIMER, confidenceLine, scoreNote, scoreRigDrops, scoreSummary, scoresHtml } from './internal/scores';
export type { RigScores } from './internal/scores';
