"""No vehicle/solver: exercise actual HTTP persistence and evidence rejection with synthetic DS2."""
from pathlib import Path
import sys, json, copy, struct, hashlib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app import main
from app.capture_validation import validate_capture
from app.calibration_maps import extract_vanos, maps_for_image
from app.fitting_evidence import assess_record

root=Path(__file__).resolve().parents[3]
out=root/'build/capture_contract'
out.mkdir(parents=True, exist_ok=True)
fixture=json.loads((Path(__file__).parent/'fixtures/synthetic_capture.json').read_text())
assert validate_capture(fixture['meta'],fixture['samples'])['status']=='evidence_consistent'
checks=[]
def reject(label, mutate):
    r=copy.deepcopy(fixture); mutate(r)
    try: validate_capture(r['meta'],r['samples'])
    except ValueError: checks.append(label); return
    raise AssertionError(label)
reject('BIN hash',lambda r:r['meta']['calibration'].update(sha256='0'*64))
reject('sample BIN',lambda r:r['samples'][0]['acquisition'].update(calibrationSha256='0'*64))
reject('connection',lambda r:r['samples'][0]['acquisition'].update(connectionId='other'))
reject('clock origin',lambda r:r['samples'][0]['acquisition'].update(timeOriginMs=1))
reject('backwards clock',lambda r:r['samples'][0]['acquisition']['blocks'][1].update(requestStartMs=0))
reject('raw checksum',lambda r:r['samples'][0]['acquisition']['blocks'][0].update(responseHex='1204a000'))
reject('decoded RF tamper',lambda r:r['samples'][0].update(rf=123))
reject('decoder version',lambda r:r['meta'].update(decoder_version=999))
reject('raw omission',lambda r:r['samples'][0]['acquisition'].update(blocks=[]))
reject('duplicate sample',lambda r:r['samples'].insert(1,copy.deepcopy(r['samples'][0])))
assert assess_record(fixture)['fit'] is None
cloud={'sweep':{'meta':{'meta':{'capture':fixture['meta']}},'samples':[{'capture_sample':s} for s in fixture['samples']]}}
assert assess_record(cloud)==assess_record(fixture)
assert assess_record({'meta':{'source':'webserial','decoder_version':2},'samples':[{'t':1,'rpm':3900}]})['status']=='insufficient_evidence'

image=(root/'CSL_Simulator/backend/app/data/uploaded_mss54.bin').read_bytes()
cached=json.loads((root/'CSL_Simulator/backend/app/data/csl_ecu_maps.json').read_text(encoding='utf-8'))
fresh=extract_vanos(image)
assert fresh['kf_evan1_soll']['values'][4][11]==120
assert all(cached[k]['values']==v['values'] for k,v in fresh.items())
wrong=copy.deepcopy(cached); wrong['kf_evan1_soll']['values'][4][11]=130
fixed=maps_for_image(wrong,image)
assert fixed['kf_evan1_soll']['values'][4][11]==120
assert fixed['vanos_provenance']['cache_value_mismatches']==['kf_evan1_soll']

# Three distinct synthetic visits; train RF differs from holdout to expose leakage.
r=copy.deepcopy(fixture); r['samples']=[]
cal=r['meta']['calibration']; cal['imageHex']=image.hex(); cal['sha256']=hashlib.sha256(image).hexdigest()
origin=r['meta']['time_origin_ms']; tick=1000.
for visit,rf in enumerate([110.,120.,120.]):
    for j in range(13):
        s=copy.deepcopy(fixture['samples'][0]); s['t']=visit*12+j*.5
        blocks=s['acquisition']['blocks']; s['acquisition']['calibrationSha256']=cal['sha256']
        for b in blocks:
            b['requestStartMs']=tick; b['responseEndMs']=tick+20; tick+=30
            raw=bytearray.fromhex(b['payloadHex'])
            if b['block']==3:
                struct.pack_into('>H',raw,0,3900); struct.pack_into('>H',raw,8,int(rf*10)); struct.pack_into('>H',raw,20,32768)
                struct.pack_into('>h',raw,27,1000); raw[10]=73; raw[11]=128; raw[19]=150
            if b['block']==35:
                for k,v in [(0,3900),(2,0),(4,0),(6,410),(8,410),(22,32000)]: struct.pack_into('>h',raw,k,v)
            response=bytearray([0x12,len(raw)+4,0xa0])+raw
            checksum=0
            for v in response: checksum^=v
            response.append(checksum); b['responseHex']=response.hex(); b['payloadHex']=raw.hex()
        s.update(rpm=3900,rf=rf,ro=100,throttle=100,coolant=80,iat=25,ambientPressure=950,map=1000,evanIst=0,evanSoll=0,avanIst=41,avanSoll=41)
        r['samples'].append(s); tick+=410
report=assess_record(r)
assert len(report['visits'])==3 and report['fit'] is not None, report
assert report['fit']['train']['rmse_pp']<1e-10
assert abs(report['fit']['holdout_fitted']['rmse_pp']-10)<1e-9
assert not report['physical_ve_accuracy_verified']

# Actual API save/load; test output is isolated, never in production telemetry.
store=out/'http_fixture_store'; store.mkdir(exist_ok=True)
main.TELEMETRY_DIR=str(store)
client=TestClient(main.app)
payload={**fixture,'log_id':'mock_20990101_010101'}
response=client.post('/telemetry/logs',json=payload); assert response.status_code==200,response.text
read=client.get('/telemetry/logs/mock_20990101_010101').json()
assert read['samples']==fixture['samples'] and read['meta']['calibration']==fixture['meta']['calibration']
payload['meta']=copy.deepcopy(payload['meta']); payload['meta']['vin']='CHANGED'
assert client.post('/telemetry/logs',json=payload).status_code==409
result=client.post('/validation/fitting-evidence',json={'log_id':'mock_20990101_010101'})
assert result.status_code==200 and result.json()['fit'] is None,result.text
assert list((store/'assessments').glob('*.json'))
assert client.post('/validation/fitting-evidence',json={'log_id':'../x'}).status_code==400
summary={'rejection_checks':checks,'synthetic_train_rmse_pp':report['fit']['train']['rmse_pp'],
    'synthetic_holdout_rmse_pp':report['fit']['holdout_fitted']['rmse_pp'],
    'api_save_load_and_provenance_conflict':'passed','cached_all_512_values_match_BIN':True,
    'physical_accuracy_test':False,'solver_runs':0}
(out/'backend_regression.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary))
