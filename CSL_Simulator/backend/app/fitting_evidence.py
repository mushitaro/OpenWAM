"""Finite, no-solver readiness and held-out ECU-RF consistency assessment.

Screens are acquisition lower bounds from the recorded plan, not physical-VE accuracy criteria.
One common cell is compared. Visits are not allowed to share rows across fit and holdout.
"""
import math
import struct
from collections import Counter
from .capture_validation import validate_capture


def capture_record(value):
    """Accept native JSON or the collector's JSON export, without guessing old CSV fields."""
    if 'sweep' not in value: return value
    sweep=value['sweep']
    capture=(sweep.get('meta') or {}).get('meta',{}).get('capture')
    if not capture: raise ValueError('Collector export lacks original capture metadata; use native capture JSON')
    rows=sweep.get('samples',[])
    if any('capture_sample' not in row for row in rows):
        raise ValueError('Collector export lacks original capture rows')
    return {'meta':capture,'samples':[row['capture_sample'] for row in rows]}


def _finite(s, names):
    return all(isinstance(s.get(k),(int,float)) and math.isfinite(s[k]) for k in names)


def assess_record(record):
    record=capture_record(record)
    meta, samples = record.get('meta',{}), record.get('samples',[])
    integrity = validate_capture(meta,samples)
    groups=[]; current=[]; reasons=Counter(); previous=None
    for i,s in enumerate(samples):
        reason=None
        needed=['t','rpm','rf','ro','throttle','coolant','iat','ambientPressure','map',
                'evanIst','evanSoll','avanIst','avanSoll']
        if s.get('acquisitionFailed') or not _finite(s,needed): reason='missing_or_failed_channels'
        elif previous is None or not _finite(previous,['t','rpm']): reason='no_previous_sample'
        elif not 0 < s['t']-previous['t'] <= 1: reason='noncontinuous_time'
        elif not 3875 <= s['rpm'] <= 3925 or abs(s['rpm']-previous['rpm'])/(s['t']-previous['t']) > 50: reason='rpm_or_slope'
        elif s['ro'] < 95 or s['throttle'] < 95 or s['coolant'] < 75: reason='load_or_warmup'
        elif abs(s['evanIst']-s['evanSoll'])>1 or abs(s['avanIst']-s['avanSoll'])>1: reason='cam_tracking'
        elif abs(s['evanIst'])>1 or abs(s['avanIst']-41)>1: reason='cam_comparison_point'
        elif s.get('cmdTransient'): reason='command_transient'
        if reason:
            reasons[reason]+=1
            if current: groups.append(current); current=[]
        else: current.append(i)
        previous=s
    if current: groups.append(current)
    visits=[]
    for indices in groups:
        ss=[samples[i] for i in indices]
        duration=ss[-1]['t']-ss[0]['t']
        spans={k:max(s[k] for s in ss)-min(s[k] for s in ss) for k in ['iat','map','rf','ambientPressure']}
        # Record excursions rather than claim that a duration test proves thermal steady state.
        if duration>=5 and len(ss)>=10:
            spans_ms=[max(b['responseEndMs'] for b in s['acquisition']['blocks'])-
                      min(b['requestStartMs'] for b in s['acquisition']['blocks'])
                      for s in ss if s.get('acquisition',{}).get('blocks')]
            visits.append({'indices':indices,'duration_s':duration,'samples':len(ss),'spans':spans,
                           'max_block_transaction_span_ms':max(spans_ms,default=None),
                           'start_s':ss[0]['t'],'end_s':ss[-1]['t']})
    blockers=[]
    if integrity['status']!='evidence_consistent': blockers.append('Missing contemporaneous BIN/raw/block timing (legacy/synthetic data)')
    if len(visits)<3: blockers.append('Need at least three separate 5-second/10-sample visits; holdout must be separate')
    fit=None
    if not blockers:
        # Compare BIN target to recorded RF. This is not a calibrated physical flow target.
        image=bytes.fromhex(meta['calibration']['imageHex'])
        x=struct.unpack_from('>20H',image,0xd2fe)
        y=[v*100/32768 for v in struct.unpack_from('>24H',image,0xd326)]
        values=struct.unpack_from('>480H',image,0xd356)
        if not all(a<b for a,b in zip(x,x[1:])) or not all(a<b for a,b in zip(y,y[1:])):
            blockers.append('BIN RF axes invalid for declared layout')
        elif any(not x[0]<=samples[i]['rpm']<=x[-1] or not y[0]<=samples[i]['ro']<=y[-1]
                 for v in visits for i in v['indices']):
            blockers.append('Candidate visits outside BIN RF axes; no clamped extrapolation accepted')
        else:
            def interpolate(s):
                def segment(axis,v):
                    v=max(axis[0],min(axis[-1],v))
                    k=next((i for i in range(len(axis)-1) if v<=axis[i+1]),len(axis)-2)
                    return k,(v-axis[k])/(axis[k+1]-axis[k])
                i,a=segment(x,s['rpm']); j,b=segment(y,s['ro'])
                row=lambda k: ((1-a)*values[k*20+i]+a*values[k*20+i+1])/10
                return (1-b)*row(j)+b*row(j+1)
            # First visit only fits one scalar; every later visit is held out.
            train=[samples[i] for i in visits[0]['indices']]
            hold=[samples[i] for v in visits[1:] for i in v['indices']]
            denom=sum(interpolate(s)**2 for s in train)
            if denom<=0: blockers.append('Zero RF target; cannot fit scale')
            else:
                scale=sum(interpolate(s)*s['rf'] for s in train)/denom
                def metrics(ss,k):
                    errors=[k*interpolate(s)-s['rf'] for s in ss]
                    return {'samples':len(ss),'bias_pp':sum(errors)/len(errors),'mae_pp':sum(abs(e) for e in errors)/len(errors),
                            'rmse_pp':math.sqrt(sum(e*e for e in errors)/len(errors)),'max_abs_pp':max(map(abs,errors))}
                fit={'scale':scale,'train_visit':0,'holdout_visits':list(range(1,len(visits))),
                     'train':metrics(train,scale),'holdout_unfitted':metrics(hold,1),'holdout_fitted':metrics(hold,scale),
                     'scope':'single-point BIN-target-to-ECU-RF consistency; no solver or physical VE validation',
                     'automatic_acceptance':False}
    return {'status':'insufficient_evidence' if blockers else 'ecu_consistency_computed_review_required',
            'integrity':integrity,'rows':len(samples),'contiguous_candidate_groups':len(groups),
            'longest_candidate_s':max((samples[g[-1]]['t']-samples[g[0]]['t'] for g in groups),default=0),
            'visits':visits,'rejected_reasons':dict(reasons),'blockers':blockers,'fit':fit,
            'physical_ve_accuracy_verified':False,
            'remaining_physical_requirements':['Independent airflow/uncertainty','Physical cam/TDC datum','Matched thermal/boundary conditions'],
            'screen_note':'Initial acquisition screen only; correlated visits, environmental spans and block transaction spans require review. Host transaction times do not prove simultaneous ECU sampling. No accuracy threshold relaxed.'}
