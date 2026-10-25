import { expect, it } from 'vitest';
import { GRAVITY as TESTKIT_GRAVITY } from '../testkit';
import { GRAVITY } from './internal/constants';

it('signal and the independent testkit generator use the same value of g', () => {
  expect(GRAVITY).toBe(TESTKIT_GRAVITY);
});
