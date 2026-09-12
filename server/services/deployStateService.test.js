import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveFleetState } from './deployStateService.js';

describe('deriveFleetState', () => {
  it('is unknown when no live heartbeats', () => {
    const s = deriveFleetState([], 'v2');
    assert.equal(s.deployState, 'unknown');
    assert.equal(s.fleetVersion, 'v2');
    assert.equal(s.podCount, 0);
  });

  it('is stable when every live pod reports the same version', () => {
    const s = deriveFleetState(
      [
        { version: 'v2' },
        { version: 'v2' },
        { version: 'v2' },
      ],
      'v2'
    );
    assert.equal(s.deployState, 'stable');
    assert.equal(s.fleetVersion, 'v2');
    assert.equal(s.podCount, 3);
  });

  it('is deploying when live pods disagree', () => {
    const s = deriveFleetState(
      [
        { version: 'v1' },
        { version: 'v1' },
        { version: 'v2' },
      ],
      'v2'
    );
    assert.equal(s.deployState, 'deploying');
    assert.equal(s.fleetVersion, 'v2');
    assert.equal(s.podCount, 3);
    assert.deepEqual(s.versions.slice().sort(), ['v1', 'v2']);
  });
});
