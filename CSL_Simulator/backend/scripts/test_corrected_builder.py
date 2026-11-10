"""Finite input/control sweeps and 25us fluid regressions; never a full cycle."""
from pathlib import Path
import csv
import json
import math
import os
import sys
import uuid
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app import main
from app.models import SimConfig, ExhaustLayoutType
from app.simulator.corrected_service import CorrectedService, save, sha

repo=Path(__file__).resolve().parents[3]
service=CorrectedService(repo)
service.home=repo/'build/corrected_builder_regression'/uuid.uuid4().hex
service.home.mkdir(parents=True)
client=TestClient(main.app)
results=[]

def request(config,extent='inputs'):
    response=client.post('/simulate/corrected/builder',json={'config':config.model_dump(mode='json'),'extent':extent,'timeout_s':60})
    assert response.status_code==200,response.text
    r=response.json(); results.append(r)
    assert json.loads((service.home/r['run_id']/'result.json').read_text())==r
    return r

def derived(base, **paths):
    c=base.model_copy(deep=True)
    for key,value in paths.items():
        parts=key.split('__'); item=c
        for k in parts[:-1]: item=getattr(item,k)
        setattr(item,parts[-1],value)
    return c

with patch.dict(os.environ,{k:v for k,v in os.environ.items() if not k.startswith('OPENWAM_')},clear=True), patch.object(main,'corrected_service',service):
    base=SimConfig()
    owner=SimConfig.model_validate_json((repo/'CSL_Simulator/frontend/presets/v14_owner.json').read_text())
    # The entire 720 degree control cycle is checked (2881 angles), no fluid run.
    for rpm,ro in [(1800,.01),(2700,.2),(3400,1),(3900,1),(8000,.5)]:
        request(derived(base,engine__rpm=rpm,engine__throttle_position=ro))
    request(owner)
    for model in ('single','cells','box1d'):
        request(derived(base,intake__plenum_box__model=model))
    for model in ('rail','chain','plenum'):
        request(derived(base,intake__eq_tube__model=model))
    for layout in ('Straight','H-Pipe','X-Pipe','Merge 2-into-1','Split 1-into-2'):
        request(derived(base,exhaust__section1_1__layout=ExhaustLayoutType(layout)))
    # Paired geometry change must change geometry SHA, while RPM/RO changes controls.
    altered=derived(base,engine__rpm=3400,engine__throttle_position=.01,intake__bellmouth__length=210,
                    intake__itb__diameter=54,exhaust__section1_1__length=1500,
                    engine__geometry__bore=89,engine__geometry__stroke=93,environment__ambient_temp=310)
    a=request(base,'short'); b=request(altered,'short'); c=request(owner,'short')
    assert a['input_files']['geometry.txt']!=b['input_files']['geometry.txt']
    assert a['input_files']['controls.txt']!=b['input_files']['controls.txt']
    for r in (a,b,c):
        assert r['status']=='short_check_only' and not r['ivc_all_refreshed']
        assert all(x['ve_oxygen_percent'] is None for x in r['cylinders'])
        assert r['budget_max']<=2e-8 and not r['vehicle_accuracy_confirmed']
        cfg=r['config']; geo=cfg['engine']['geometry']; vd=math.pi*(geo['bore']/1000)**2*(geo['stroke']/1000)/4
        # Independent dry air R from molar masses of O2/N2/Ar, broad rounding tolerance.
        expected=cfg['environment']['ambient_pressure']/(287*cfg['environment']['ambient_temp'])*vd
        assert abs(r['reference_air_mass_kg']/expected-1)<.002
        rows=list(csv.DictReader((service.home/r['run_id']/'out.csv').open()))
        for i,phase in enumerate([0,240,480,120,600,360],1):
            th=math.radians(phase+6*cfg['engine']['rpm']*25e-6); rad=geo['stroke']/2000; rod=geo['rod_length']/1000
            volume=vd/(geo['compression_ratio']-1)+math.pi*(geo['bore']/1000)**2/4*(rad*(1-math.cos(th))+rod-math.sqrt(rod*rod-rad*rad*math.sin(th)**2))
            assert abs(float(rows[-1][f'V{i}'])/volume-1)<1e-12
    repeated=request(base,'short')
    assert repeated['final_sha256']==a['final_sha256'], 'deterministic repeated execution'
    assert client.get('/simulate/corrected/last').json()==repeated
    # Manufactured timing puts one IVC and its burn into 25us. This is a source/event
    # regression, explicitly NOT a physically realistic cam/ignition configuration.
    event=derived(base,engine__vanos_intake_bias=471.9,engine__combustion__start_angle=-599.85,engine__combustion__duration=.2)
    ev=request(event,'short')
    assert any(x['ivc_refreshed'] for x in ev['cylinders']),ev
    assert any(x['ve_oxygen_percent'] is not None for x in ev['cylinders'])
    assert 0 < ev['diagnostics']['burned_fuel_kg'] <= ev['diagnostics']['fuel_delivered_kg']
    last=client.get('/simulate/corrected/last').json()
    for bad in (derived(base,engine__rpm=0),derived(base,engine__throttle_position=1.01),
                derived(base,engine__geometry__rod_length=1),derived(base,fuel__lcv=0),derived(base,engine__cylinders=4)):
        assert client.post('/simulate/corrected/builder',json={'config':bad.model_dump()}).status_code==400
    for extra in ({'model':'legacy'},{'cycles':121},{'extent':'unbounded'},{'timeout_s':14401},{'case_id':'ccycle113'}):
        assert client.post('/simulate/corrected/builder',json={'config':base.model_dump(),**extra}).status_code==422
    request(base)  # inputs only must preserve previous actual result
    assert client.get('/simulate/corrected/last').json()==last

save(service.home/'verification.json',{'passed':True,'cases':results,'no_full_cycle_runs':True,
    'exe_sha256':sha(repo/'build/corrected_ve/Release/corrected_ve_builder.exe')})
print(json.dumps({'passed':True,'evaluations':len(results),'evidence':str(service.home)},indent=2))
