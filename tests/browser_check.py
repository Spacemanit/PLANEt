"""Browser QA for the worldwide dashboard. Uses fixtures, not OpenSky credits."""
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path(__file__).resolve().parent.parent / 'test-results'
OUT.mkdir(exist_ok=True)
BASE = os.environ.get('PLANET_BASE_URL', 'http://127.0.0.1:3000')
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    context = browser.new_context(viewport={'width':1440,'height':1080},device_scale_factor=1,reduced_motion='reduce',accept_downloads=True)
    page = context.new_page()
    errors, requests, model_responses = [], [], []
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('console',lambda message:errors.append(message.text) if message.type=='error' else None)
    page.on('response',lambda response:model_responses.append((response.url,response.status)) if 'plane-' in response.url and '.glb' in response.url else None)
    now = int(time.time())
    rows = [
      ['abcdef','IGO214','India',now,now,77.1,23.1,10500,False,230,133,1.2,None,10550,'2000',False,0,4],
      ['abcdea','UAE508','United Arab Emirates',now,now,12,51,11800,False,255,105,0,None,11850,'2000',False,0,6],
      ['abcdeb','VTJPK','Japan',now-130,now,139,35,0,True,0,None,None,None,None,'2000',False,0,2],
      ['abcdec','UAL321','United States',now,now,-100,38,10000,False,230,90,0,None,None,'2000',False,0,4],
    ]
    def serve(route):
        requests.append(route.request.url)
        assert 'bounds' not in route.request.url, 'The client must request worldwide aircraft'
        route.fulfill(status=200,content_type='application/json',body=json.dumps({'time':now,'states':rows,'fetchedAt':now*1000,'serverTime':now*1000,'source':'live','upstreamStatus':200,'remaining':3900,'authMode':'authenticated','nextPollMs':60000,'retryAt':None,'stale':False,'issue':None}))
    page.route('**/api/aircraft*',serve)
    page.goto(BASE,wait_until='networkidle')
    expect(page.get_by_text('Unpacking our little planet',exact=False)).to_be_hidden(timeout=60000)
    expect(page.get_by_role('button',name='Reload globe',exact=True)).to_be_hidden()
    expect(page.get_by_role('heading',name='Planes everywhere 4')).to_be_visible()
    assert page.locator('canvas').count()==1
    assert page.locator('canvas').get_attribute('data-aircraft-count')=='4'
    assert len(requests)==1
    assert page.get_by_role('button',name='Exploring',exact=False).count()==0
    page.screenshot(path=str(OUT/'worldwide-dashboard.png'),full_page=True)
    # A US aircraft is included even while the globe is facing Europe/Africa.
    expect(page.get_by_role('button',name='UAL321 United States',exact=False)).to_be_visible()
    page.get_by_role('textbox',name='Search aircraft by callsign, country or ICAO24').fill('UAE508')
    expect(page.get_by_role('heading',name='Planes everywhere 1')).to_be_visible()
    page.get_by_role('button',name='Clear search').click()
    page.get_by_role('button',name='Filter aircraft',exact=True).click()
    page.get_by_label('Altitude',exact=True).select_option('high')
    expect(page.get_by_role('heading',name='Planes everywhere 3')).to_be_visible()
    page.get_by_label('Flight state',exact=True).select_option('ground')
    expect(page.get_by_text('A quieter corner of the sky.',exact=True)).to_be_visible()
    page.get_by_role('button',name='Clear filters',exact=True).click()
    page.get_by_role('button',name='Filter aircraft',exact=True).click()
    page.get_by_role('button',name='IGO214 India',exact=False).click()
    expect(page.get_by_role('heading',name='IGO214',exact=True)).to_be_visible()
    expect(page.get_by_text('3D plane ready',exact=True)).to_be_visible(timeout=60000)
    assert page.locator('.aircraft-illustration').count()==0
    expect(page.get_by_text('23.1000',exact=False)).to_be_visible()
    page.screenshot(path=str(OUT/'selected-ss500.png'),full_page=True)
    page.get_by_label('3D plane style',exact=True).select_option('prop')
    expect(page.get_by_text('3D plane ready',exact=True)).to_be_visible(timeout=60000)
    page.screenshot(path=str(OUT/'selected-prop-plane.png'),full_page=True)
    assert len(model_responses)>=2 and all(status==200 for _,status in model_responses)
    page.get_by_role('button',name='Movement',exact=False).click()
    expect(page.get_by_text('A trail starts with two observations.',exact=False)).to_be_visible()
    page.get_by_role('button',name='All aircraft',exact=True).click()
    page.get_by_role('button',name='Open feed status').click()
    expect(page.get_by_text('The feed is current',exact=True)).to_be_visible()
    expect(page.get_by_text('HTTP 200',exact=True)).to_be_visible()
    page.get_by_role('button',name='Close dialog').click()
    page.get_by_role('button',name='Sample mode',exact=True).click()
    expect(page.get_by_role('heading',name='Planes everywhere 192')).to_be_visible()
    page.get_by_role('textbox',name='Search aircraft by callsign, country or ICAO24').fill('IGO214')
    page.get_by_role('button',name='IGO214 India',exact=False).click()
    expect(page.get_by_text('3D plane ready',exact=True)).to_be_visible(timeout=60000)
    page.get_by_role('button',name='Movement',exact=False).click()
    with page.expect_download() as event:
        page.get_by_role('button',name='Download observed movement as CSV').click()
    event.value.save_as(str(OUT/'sample-observations.csv'))
    assert len((OUT/'sample-observations.csv').read_text().splitlines())>2
    page.screenshot(path=str(OUT/'worldwide-movement.png'),full_page=True)
    page.get_by_role('button',name='Pause live updates').click()
    expect(page.get_by_text('Taking a breather',exact=True)).to_be_visible()
    page.get_by_role('button',name='Resume live updates').click()
    page.get_by_role('button',name='All aircraft',exact=True).click()
    page.get_by_role('button',name='Clear search').click()
    page.get_by_role('button',name='Map layers',exact=True).click()
    page.get_by_label('Observed trails',exact=True).uncheck()
    page.get_by_label('Little clouds',exact=True).uncheck()
    page.get_by_role('button',name='Map layers',exact=True).click()
    page.get_by_role('button',name='About PLANEt and data freshness').click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.get_by_role('button',name='Close dialog').click()
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(OUT/'worldwide-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.get_by_role('button',name='Return to live',exact=False).click()
    expect(page.get_by_role('heading',name='Planes everywhere 4')).to_be_visible()
    assert not errors, '\n'.join(errors)
    context.close(); browser.close()
    print('PASS: worldwide data, all markers, both GLB models, removed illustration, search, filters, details, export, feed status, pause, sample isolation, mobile, and browser errors')
