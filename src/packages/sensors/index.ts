export type { Access, SensorSource } from './internal/source';
export type { MotionEnv } from './internal/device-motion';
export { createDeviceMotionSource } from './internal/device-motion';
export { createReplaySource } from './internal/replay';
export { RecordingFormatError, parseRecording, parseRig, serializeRecording } from './internal/recording';
