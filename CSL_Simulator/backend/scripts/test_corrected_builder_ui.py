"""Browser contract using replayed real C++ output, no extra solver execution."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

repo=Path(__file__).resolve().parents[3]
evidence=max((repo/'build/corrected_builder_regression').glob('*/verification.json'),key=lambda p:p.stat().st_mtime)
record=json.loads(evidence.read_text())
result=next(r for r in record['cases'] if r['extent']=='short' and r['conditions']['rpm']==3400)
prepared=next(r for r in record['cases'] if r['extent']=='inputs')
requests=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page(viewport={'width':1360,'height':1000})
    def response(route):
        path=route.request.url
        if path.endswith('/models'):
            value={'default':'legacy','corrected_available':True,'corrected_builder_available':True,'cases':[]}
        elif path.endswith('/builder'):
            data=route.request.post_data_json;requests.append(data)
            value=prepared if data['extent']=='inputs' else result
        elif path.endswith('/corrected/last'): value=result
        else: value={}
        route.fulfill(status=200,content_type='application/json',body=json.dumps(value),headers={'Access-Control-Allow-Origin':'*'})
    page.route('**/simulate/**',response)
    page.goto('http://localhost:3101')
    page.get_by_role('button',name='Simulation',exact=True).click()
    selector=page.get_by_label('計算モデル')
    assert selector.input_value()=='legacy'
    selector.select_option('corrected')
    page.get_by_label('修正モデルRPM').fill('3400')
    page.get_by_label('修正モデルRO').fill('1')
    page.get_by_role('button',name='入力生成・確認のみ',exact=True).click()
    page.get_by_role('status').wait_for()
    assert requests[-1]['config']['engine']['rpm']==3400
    assert requests[-1]['config']['engine']['throttle_position']==.01
    assert 'intake' in requests[-1]['config'] and 'exhaust' in requests[-1]['config']
    page.get_by_role('button',name='短区間の動作確認（上限60秒）',exact=True).click()
    page.get_by_role('table').wait_for()
    assert page.get_by_role('table').get_by_role('row').count()==7
    assert page.get_by_role('table').get_by_text('未評価',exact=True).count()==6
    assert page.get_by_role('link',name='結果JSONを保存').get_attribute('download')
    page.get_by_role('button',name='修正モデルの前回結果を読む',exact=True).click()
    page.screenshot(path=str(evidence.parent/'ui.png'),full_page=True)
    selector.select_option('legacy')
    assert page.get_by_label('修正モデルRPM').count()==0
    assert not any(r['extent']=='cycles' for r in requests)
    browser.close()
(evidence.parent/'ui_verification.json').write_text(json.dumps({'passed':True,'response_source':str(evidence),
    'http_replay_only':True,'requests':requests},indent=2),encoding='utf-8')
print('PASS: default/switch, edited RPM/RO and full Builder payload, input preparation, null VE, save/reload, legacy return')
