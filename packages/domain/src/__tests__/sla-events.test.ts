import { describe, it, expect } from 'vitest';
import { deriveSlaEvents, slaChipLabel, type SlaSnapshot } from '../sla-events';

const snap = (over: Partial<SlaSnapshot> = {}): SlaSnapshot => ({
  dueAt: '2026-06-19T12:00:00Z',
  status: 'on_track',
  firstResponded: false,
  closed: false,
  ...over,
});

describe('deriveSlaEvents', () => {
  it('emits started + first_response_due on first computation', () => {
    const e = deriveSlaEvents(null, snap());
    expect(e.map((x) => x.kind)).toEqual(['started', 'first_response_due']);
    expect(e[0]!.dueAt).toBe('2026-06-19T12:00:00Z');
  });

  it('emits nothing new when nothing changed', () => {
    const prev = snap();
    expect(deriveSlaEvents(prev, snap())).toHaveLength(0);
  });

  it('emits due_recalculated with the previous due time', () => {
    const prev = snap({ dueAt: '2026-06-19T12:00:00Z' });
    const next = snap({ dueAt: '2026-06-19T13:30:00Z' });
    const e = deriveSlaEvents(prev, next);
    expect(e).toEqual([
      {
        kind: 'due_recalculated',
        dueAt: '2026-06-19T13:30:00Z',
        previousDueAt: '2026-06-19T12:00:00Z',
      },
    ]);
  });

  it('emits due_soon then breach as time passes', () => {
    expect(
      deriveSlaEvents(snap({ status: 'on_track' }), snap({ status: 'due_soon' })).map(
        (x) => x.kind,
      ),
    ).toEqual(['due_soon']);
    expect(
      deriveSlaEvents(snap({ status: 'due_soon' }), snap({ status: 'breached' })).map(
        (x) => x.kind,
      ),
    ).toEqual(['breach']);
  });

  it('emits first_response_met when a response lands', () => {
    const e = deriveSlaEvents(
      snap({ status: 'breached' }),
      snap({ status: 'on_track', firstResponded: true }),
    );
    expect(e.map((x) => x.kind).sort()).toEqual(['breach_resolved', 'first_response_met']);
  });

  it('emits paused and resumed across waiting-on changes', () => {
    expect(
      deriveSlaEvents(snap({ status: 'on_track' }), snap({ status: 'paused' })).map((x) => x.kind),
    ).toEqual(['paused']);
    expect(
      deriveSlaEvents(snap({ status: 'paused' }), snap({ status: 'on_track' })).map((x) => x.kind),
    ).toEqual(['resumed']);
  });

  it('emits closed and reopened on lifecycle change (close supersedes churn)', () => {
    expect(
      deriveSlaEvents(snap({ status: 'breached' }), snap({ status: 'breached', closed: true })).map(
        (x) => x.kind,
      ),
    ).toEqual(['closed']);
    const reopened = deriveSlaEvents(snap({ closed: true }), snap({ closed: false }));
    expect(reopened.map((x) => x.kind)).toEqual(['reopened', 'first_response_due']);
  });

  it('does not start SLA on an already-closed conversation', () => {
    expect(deriveSlaEvents(null, snap({ closed: true }))).toHaveLength(0);
  });
});

describe('slaChipLabel', () => {
  it('maps statuses to chip labels', () => {
    expect(slaChipLabel('on_track', true)).toBe('On Track');
    expect(slaChipLabel('due_soon', true)).toBe('Due Soon');
    expect(slaChipLabel('breached', true)).toBe('Breached');
    expect(slaChipLabel('paused', true)).toBe('Paused');
    expect(slaChipLabel('on_track', false)).toBe('Not Applicable');
  });
});
